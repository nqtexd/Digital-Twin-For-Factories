from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import SupabaseRepository
from .groq_service import GroqService
from .risk_engine import HybridRiskEngine
from .schemas import BrainConversationRequest, BrainKnowledgeRequest, BrainRequest, FailureRequest, MachineCreateRequest, NoteRequest
from .simulator import MACHINE_TYPE_CATALOG, PlantSimulator, SCENARIOS

settings = get_settings()
repo = SupabaseRepository(settings)
risk_engine = HybridRiskEngine()
groq = GroqService(settings)
simulator = PlantSimulator(repo, risk_engine, settings.simulation_interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.enable_simulator:
        await simulator.start()
    yield
    await simulator.stop()


app = FastAPI(
    title='FlowTwin AI API',
    version='2.0.0',
    description='Simulation-backed digital twin, predictive risk engine, Supabase persistence and Groq explanations.',
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_origin,
        'http://127.0.0.1:5173',
        'http://localhost:5173',
    ],
    allow_origin_regex=r'https://.*\.vercel\.app',
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)



def _local_alerts_from_snapshot(snapshot):
    alerts = []
    for item in snapshot:
        t = item.get('telemetry') or {}
        if t.get('risk_level') in ('high', 'critical'):
            alerts.append({
                'id': f"local-{item['machine']['machine_id']}",
                'machine_id': item['machine']['machine_id'],
                'severity': t['risk_level'],
                'title': f"{item['machine']['display_name']}: elevated risk",
                'description': f"Risk is {round(float(t.get('risk_score', 0))*100)}% in simulation.",
                'risk_score': t.get('risk_score'),
                'acknowledged': False,
                'created_at': t.get('recorded_at'),
            })
    return alerts


@app.get('/api/health')
async def health() -> Dict[str, Any]:
    return {
        'status': 'ok',
        'database': 'connected' if repo.configured else 'demo-memory',
        'groq': 'connected' if groq.configured else 'fallback-explainer',
        'company_memory': 'persistent-rag' if repo.configured else 'session-rag',
        'simulator': simulator.running,
        'risk_model': risk_engine.model_version,
        'disclaimer': 'Predictive scores are calibrated on synthetic failure trajectories until real labelled plant data is supplied.',
    }


@app.get('/api/fleet')
async def fleet():
    if repo.configured:
        try:
            snapshot = await repo.latest_snapshot()
            if snapshot and any(x.get('telemetry') for x in snapshot):
                return snapshot
        except Exception as exc:
            print(f'[api] fleet db fallback: {exc}')
    return simulator.memory_snapshot()


@app.get('/api/machines/{machine_id}/history')
async def machine_history(machine_id: str, limit: int = 120):
    limit = max(10, min(limit, 400))
    if repo.configured:
        try:
            data = await repo.machine_history(machine_id, limit)
            if data:
                return data
            # If no history is found, check if the machine actually exists in Supabase
            machines = await repo.list_machines()
            if any(m.get('machine_id') == machine_id for m in machines):
                return []
        except Exception as exc:
            print(f'[api] history db fallback: {exc}')
    if machine_id not in simulator.states:
        raise HTTPException(404, 'Unknown machine')
    return simulator.memory_history(machine_id, limit)


@app.get('/api/machine-types')
async def machine_types():
    return list(MACHINE_TYPE_CATALOG.values())


@app.post('/api/machines')
async def create_machine(request: MachineCreateRequest):
    try:
        return await simulator.add_machine(
            request.machine_id,
            request.machine_type,
            request.display_name,
            request.line_name,
            request.layout_x,
            request.layout_y,
        )
    except KeyError:
        raise HTTPException(409, 'A machine with this ID already exists')
    except ValueError:
        raise HTTPException(400, 'Unknown machine type')


@app.delete('/api/machines/{machine_id}')
async def delete_machine(machine_id: str):
    try:
        result = await simulator.remove_machine(machine_id)
        return {'ok': True, **result}
    except KeyError:
        raise HTTPException(404, 'Unknown machine')



@app.get('/api/alerts')
async def alerts(limit: int = 30):
    if repo.configured:
        try:
            return await repo.list_alerts(max(1, min(limit, 100)))
        except Exception as exc:
            print(f'[api] alerts db fallback: {exc}')
    return _local_alerts_from_snapshot(simulator.memory_snapshot())


@app.post('/api/alerts/{alert_id}/acknowledge')
async def acknowledge_alert(alert_id: str):
    if not repo.configured:
        return {'ok': True, 'mode': 'demo-memory'}
    try:
        await repo.acknowledge_alert(alert_id)
        return {'ok': True}
    except Exception as exc:
        raise HTTPException(500, f'Could not acknowledge alert: {exc}')


@app.get('/api/simulation/scenarios')
async def scenarios():
    return [{'id': key, 'name': value} for key, value in SCENARIOS.items()]


@app.post('/api/simulation/failure')
async def simulate_failure(request: FailureRequest):
    try:
        result = simulator.inject_failure(request.machine_id, request.scenario, request.speed)
        return {'ok': True, **result}
    except KeyError:
        raise HTTPException(404, 'Unknown machine')
    except ValueError:
        raise HTTPException(400, 'Unknown failure scenario')


@app.delete('/api/simulation/{machine_id}')
async def clear_failure(machine_id: str):
    try:
        return {'ok': True, **simulator.clear_failure(machine_id)}
    except KeyError:
        raise HTTPException(404, 'Unknown machine')


@app.post('/api/brain/ask')
async def ask_brain(request: BrainRequest):
    conversation = None
    if request.conversation_id:
        conversation = await repo.get_brain_conversation(request.conversation_id)
        if not conversation:
            raise HTTPException(404, 'Conversation not found')
    if not conversation:
        title = request.question.strip().replace('\n', ' ')[:64]
        conversation = await repo.create_brain_conversation(title, request.machine_id)

    conversation_id = conversation['id']
    machine_id = request.machine_id or conversation.get('machine_id')
    snapshot = await fleet()
    if machine_id:
        snapshot = [x for x in snapshot if x.get('machine', {}).get('machine_id') == machine_id]
    history = await repo.list_brain_messages(conversation_id, 40)
    memories = await repo.search_company_memory(request.question, machine_id, conversation_id, 6)
    context = {
        'source': 'simulated_telemetry' if settings.enable_simulator else 'telemetry',
        'risk_model': risk_engine.model_version,
        'fleet': snapshot,
        'retrieval_count': len(memories),
    }
    await repo.store_brain_message('user', request.question, machine_id, context, conversation_id)
    answer = await asyncio.to_thread(
        groq.explain,
        request.question,
        context,
        history,
        memories,
        conversation.get('summary') or '',
    )
    assistant_message = await repo.store_brain_message(
        'assistant',
        answer,
        machine_id,
        context,
        conversation_id,
        {'sources': memories, 'model': settings.groq_model if groq.configured else 'local-fallback'},
    )
    refreshed_messages = [*history, {'role': 'user', 'content': request.question}, assistant_message]
    if len(refreshed_messages) >= 12 and len(refreshed_messages) % 6 == 0:
        summary = await asyncio.to_thread(groq.summarize_conversation, refreshed_messages)
        await repo.update_brain_conversation(conversation_id, {'summary': summary})
    return {
        'answer': answer,
        'message': assistant_message,
        'conversation_id': conversation_id,
        'model': settings.groq_model if groq.configured else 'local-fallback',
        'sources': memories,
        'context': context,
    }


@app.get('/api/brain/conversations')
async def brain_conversations(limit: int = 50):
    return await repo.list_brain_conversations(max(1, min(limit, 100)))


@app.post('/api/brain/conversations')
async def create_brain_conversation(request: BrainConversationRequest):
    if request.machine_id and request.machine_id not in simulator.states:
        raise HTTPException(404, 'Unknown machine')
    return await repo.create_brain_conversation(request.title, request.machine_id)


@app.get('/api/brain/conversations/{conversation_id}/messages')
async def brain_conversation_messages(conversation_id: str, limit: int = 100):
    if not await repo.get_brain_conversation(conversation_id):
        raise HTTPException(404, 'Conversation not found')
    return await repo.list_brain_messages(conversation_id, max(1, min(limit, 200)))


@app.delete('/api/brain/conversations/{conversation_id}')
async def delete_brain_conversation(conversation_id: str):
    if not await repo.get_brain_conversation(conversation_id):
        raise HTTPException(404, 'Conversation not found')
    await repo.delete_brain_conversation(conversation_id)
    return {'ok': True}


@app.post('/api/brain/knowledge')
async def add_brain_knowledge(request: BrainKnowledgeRequest):
    if request.machine_id and request.machine_id not in simulator.states:
        raise HTTPException(404, 'Unknown machine')
    document = await repo.add_knowledge_document(request.title, request.content, request.machine_id)
    return {'ok': True, 'document': document}


@app.post('/api/notes/text')
async def text_note(request: NoteRequest):
    if request.machine_id and request.machine_id not in simulator.states:
        raise HTTPException(404, 'Unknown machine')
    note = await repo.add_note(request.machine_id, 'text', text_content=request.text)
    return {'ok': True, 'note': note}


@app.post('/api/notes/voice')
async def voice_note(
    audio: UploadFile = File(...),
    machine_id: str | None = Form(default=None),
):
    if machine_id and machine_id not in simulator.states:
        raise HTTPException(404, 'Unknown machine')
    content = await audio.read()
    if not content:
        raise HTTPException(400, 'Empty audio file')
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(413, 'Voice note exceeds the 25 MB demo limit')

    mime = audio.content_type or 'audio/webm'
    filename = audio.filename or 'operator-note.webm'
    audio_path = None
    if repo.configured:
        try:
            audio_path = await repo.upload_audio(machine_id, filename, content, mime)
        except Exception as exc:
            raise HTTPException(500, f'Audio storage failed: {exc}')

    transcript = None
    transcription_error = None
    if groq.configured:
        try:
            transcript = await asyncio.to_thread(groq.transcribe, filename, content, mime)
        except Exception as exc:
            transcription_error = str(exc)
    else:
        transcription_error = 'GROQ_API_KEY is not configured'

    note = await repo.add_note(
        machine_id,
        'voice',
        audio_path=audio_path,
        transcript=transcript,
    )
    return {
        'ok': True,
        'note': note,
        'transcript': transcript,
        'transcription_warning': transcription_error,
    }
