from __future__ import annotations

import asyncio
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

try:
    from supabase import Client, create_client
except ImportError:  # Optional in local fallback mode
    Client = Any  # type: ignore
    create_client = None  # type: ignore

from .config import Settings


class SupabaseRepository:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client: Client | None = None
        if settings.supabase_configured and create_client is not None:
            self.client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        # Supabase's sync client is called through worker threads. Keep all network
        # I/O behind one async lane so Windows is not hit with bursts of parallel
        # non-blocking socket operations from the simulator.
        self._io_lock = asyncio.Lock()
        self._memory_conversations: Dict[str, Dict[str, Any]] = {}
        self._memory_messages: List[Dict[str, Any]] = []
        self._memory_knowledge: List[Dict[str, Any]] = []
        self._brain_storage_failed = False

    @property
    def configured(self) -> bool:
        return self.client is not None

    @staticmethod
    def _is_transient_socket_error(exc: BaseException) -> bool:
        current: BaseException | None = exc
        seen: set[int] = set()
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            if isinstance(current, OSError) and getattr(current, 'winerror', None) in {10035, 10054, 10060}:
                return True
            message = str(current)
            if any(code in message for code in ('WinError 10035', 'WinError 10054', 'WinError 10060')):
                return True
            current = current.__cause__ or current.__context__
        return False

    async def _run(self, fn, retries: int = 4):
        # A single shared persistence lane avoids the five-machine simulator
        # opening/using sockets concurrently on Windows. Transient WSA errors
        # are retried with a short exponential backoff.
        async with self._io_lock:
            for attempt in range(retries):
                try:
                    return await asyncio.to_thread(fn)
                except Exception as exc:
                    if not self._is_transient_socket_error(exc) or attempt == retries - 1:
                        raise
                    await asyncio.sleep(min(1.5, 0.15 * (2 ** attempt)))

    async def seed_machines(self, machines: List[Dict[str, Any]]) -> None:
        if not self.client:
            return
        await self._run(lambda: self.client.table('machines').upsert(machines, on_conflict='machine_id').execute())

    async def update_machine(self, machine_id: str, patch: Dict[str, Any]) -> None:
        if not self.client:
            return
        patch = {**patch, 'updated_at': datetime.now(timezone.utc).isoformat()}
        await self._run(lambda: self.client.table('machines').update(patch).eq('machine_id', machine_id).execute())

    async def delete_machine(self, machine_id: str) -> None:
        if not self.client:
            return
        # Delete telemetry first (FK constraint), then the machine row
        try:
            await self._run(lambda: self.client.table('machine_telemetry').delete().eq('machine_id', machine_id).execute())
        except Exception as exc:
            print(f'[db] delete telemetry warning for {machine_id}: {exc}')
        await self._run(lambda: self.client.table('machines').delete().eq('machine_id', machine_id).execute())


    async def insert_telemetry(self, row: Dict[str, Any]) -> None:
        if not self.client:
            return
        await self._run(lambda: self.client.table('machine_telemetry').insert(row).execute())

    async def insert_alert(self, row: Dict[str, Any]) -> None:
        if not self.client:
            return
        await self._run(lambda: self.client.table('alerts').insert(row).execute())

    async def recent_alert_exists(self, machine_id: str, severity: str, seconds: int = 25) -> bool:
        if not self.client:
            return False
        cutoff = datetime.now(timezone.utc).timestamp() - seconds
        cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
        response = await self._run(
            lambda: self.client.table('alerts')
            .select('id')
            .eq('machine_id', machine_id)
            .eq('severity', severity)
            .gte('created_at', cutoff_iso)
            .limit(1)
            .execute()
        )
        return bool(response.data)

    async def list_machines(self) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        response = await self._run(lambda: self.client.table('machines').select('*').order('machine_id').execute())
        return response.data or []

    async def latest_snapshot(self) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        machines = await self.list_machines()
        out: List[Dict[str, Any]] = []
        for m in machines:
            resp = await self._run(
                lambda machine_id=m['machine_id']: self.client.table('machine_telemetry')
                .select('*')
                .eq('machine_id', machine_id)
                .order('recorded_at', desc=True)
                .limit(1)
                .execute()
            )
            latest = (resp.data or [None])[0]
            out.append({'machine': m, 'telemetry': latest})
        return out

    async def machine_history(self, machine_id: str, limit: int = 120) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        response = await self._run(
            lambda: self.client.table('machine_telemetry')
            .select('*')
            .eq('machine_id', machine_id)
            .order('recorded_at', desc=True)
            .limit(limit)
            .execute()
        )
        return list(reversed(response.data or []))

    async def list_alerts(self, limit: int = 30) -> List[Dict[str, Any]]:
        if not self.client:
            return []
        response = await self._run(
            lambda: self.client.table('alerts').select('*').order('created_at', desc=True).limit(limit).execute()
        )
        return response.data or []

    async def acknowledge_alert(self, alert_id: str) -> None:
        if not self.client:
            return
        await self._run(
            lambda: self.client.table('alerts')
            .update({'acknowledged': True, 'acknowledged_at': datetime.now(timezone.utc).isoformat()})
            .eq('id', alert_id)
            .execute()
        )

    async def add_note(
        self,
        machine_id: Optional[str],
        input_type: str,
        text_content: Optional[str] = None,
        audio_path: Optional[str] = None,
        transcript: Optional[str] = None,
    ) -> Dict[str, Any]:
        row = {
            'machine_id': machine_id,
            'input_type': input_type,
            'text_content': text_content,
            'audio_path': audio_path,
            'transcript': transcript,
        }
        if not self.client:
            return {'id': str(uuid4()), **row, 'created_at': datetime.now(timezone.utc).isoformat()}
        response = await self._run(lambda: self.client.table('operator_notes').insert(row).execute())
        return (response.data or [row])[0]

    async def upload_audio(self, machine_id: Optional[str], filename: str, content: bytes, mime_type: str) -> str:
        if not self.client:
            raise RuntimeError('Supabase is not configured')
        safe_machine = machine_id or 'fleet'
        path = f"{safe_machine}/{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{uuid4().hex[:8]}-{filename}"
        await self._run(
            lambda: self.client.storage.from_('operator-audio').upload(
                path=path,
                file=content,
                file_options={'content-type': mime_type, 'upsert': 'false'},
            )
        )
        return path

    async def create_brain_conversation(self, title: str, machine_id: Optional[str]) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        row = {
            'id': str(uuid4()),
            'title': title.strip() or 'New conversation',
            'machine_id': machine_id,
            'summary': '',
            'created_at': now,
            'updated_at': now,
        }
        if not self.client or self._brain_storage_failed:
            self._memory_conversations[row['id']] = row
            return row
        try:
            response = await self._run(lambda: self.client.table('brain_conversations').insert(row).execute())
            return (response.data or [row])[0]
        except Exception as exc:
            self._brain_storage_failed = True
            print(f'[brain] persistence fallback: {exc}')
            self._memory_conversations[row['id']] = row
            return row

    async def list_brain_conversations(self, limit: int = 50) -> List[Dict[str, Any]]:
        if not self.client or self._brain_storage_failed:
            return sorted(self._memory_conversations.values(), key=lambda x: x['updated_at'], reverse=True)[:limit]
        try:
            response = await self._run(
                lambda: self.client.table('brain_conversations').select('*').order('updated_at', desc=True).limit(limit).execute()
            )
            return response.data or []
        except Exception as exc:
            self._brain_storage_failed = True
            print(f'[brain] history fallback: {exc}')
            return sorted(self._memory_conversations.values(), key=lambda x: x['updated_at'], reverse=True)[:limit]

    async def get_brain_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        if not self.client or self._brain_storage_failed:
            return self._memory_conversations.get(conversation_id)
        response = await self._run(
            lambda: self.client.table('brain_conversations').select('*').eq('id', conversation_id).limit(1).execute()
        )
        return (response.data or [None])[0]

    async def update_brain_conversation(self, conversation_id: str, patch: Dict[str, Any]) -> None:
        patch = {**patch, 'updated_at': datetime.now(timezone.utc).isoformat()}
        if not self.client or self._brain_storage_failed:
            if conversation_id in self._memory_conversations:
                self._memory_conversations[conversation_id] = {**self._memory_conversations[conversation_id], **patch}
            return
        await self._run(lambda: self.client.table('brain_conversations').update(patch).eq('id', conversation_id).execute())

    async def delete_brain_conversation(self, conversation_id: str) -> None:
        if not self.client or self._brain_storage_failed:
            self._memory_conversations.pop(conversation_id, None)
            self._memory_messages = [row for row in self._memory_messages if row.get('conversation_id') != conversation_id]
            return
        await self._run(lambda: self.client.table('brain_conversations').delete().eq('id', conversation_id).execute())

    async def list_brain_messages(self, conversation_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        if not self.client or self._brain_storage_failed:
            rows = [row for row in self._memory_messages if row.get('conversation_id') == conversation_id]
            return rows[-limit:]
        response = await self._run(
            lambda: self.client.table('brain_messages')
            .select('*')
            .eq('conversation_id', conversation_id)
            .order('created_at')
            .limit(limit)
            .execute()
        )
        return response.data or []

    async def store_brain_message(
        self,
        role: str,
        content: str,
        machine_id: Optional[str],
        context_snapshot: Dict[str, Any],
        conversation_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        row = {
            'id': str(uuid4()),
            'role': role,
            'content': content,
            'machine_id': machine_id,
            'context_snapshot': context_snapshot,
            'conversation_id': conversation_id,
            'metadata': metadata or {},
            'created_at': datetime.now(timezone.utc).isoformat(),
        }
        if not self.client or self._brain_storage_failed:
            self._memory_messages.append(row)
            if conversation_id:
                await self.update_brain_conversation(conversation_id, {})
            return row
        response = await self._run(lambda: self.client.table('brain_messages').insert(row).execute())
        if conversation_id:
            await self.update_brain_conversation(conversation_id, {})
        return (response.data or [row])[0]

    async def add_knowledge_document(
        self,
        title: str,
        content: str,
        machine_id: Optional[str] = None,
        source_type: str = 'company_note',
    ) -> Dict[str, Any]:
        row = {
            'id': str(uuid4()),
            'title': title.strip(),
            'content': content.strip(),
            'machine_id': machine_id,
            'source_type': source_type,
            'metadata': {},
            'created_at': datetime.now(timezone.utc).isoformat(),
        }
        if not self.client or self._brain_storage_failed:
            self._memory_knowledge.append(row)
            return row
        response = await self._run(lambda: self.client.table('knowledge_documents').insert(row).execute())
        return (response.data or [row])[0]

    @staticmethod
    def _memory_score(query: str, document: str, machine_id: Optional[str], row_machine_id: Optional[str]) -> float:
        tokens = re.findall(r'[a-z0-9_-]{2,}', query.lower())
        doc_tokens = re.findall(r'[a-z0-9_-]{2,}', document.lower())
        if not tokens or not doc_tokens:
            return 0.0
        query_counts, doc_counts = Counter(tokens), Counter(doc_tokens)
        overlap = sum(min(query_counts[token], doc_counts[token]) for token in query_counts)
        coverage = overlap / max(1, sum(query_counts.values()))
        phrase_bonus = 0.35 if query.lower().strip() in document.lower() else 0.0
        machine_bonus = 0.18 if machine_id and row_machine_id == machine_id else 0.0
        return round(coverage + phrase_bonus + machine_bonus, 4)

    async def search_company_memory(
        self,
        query: str,
        machine_id: Optional[str] = None,
        exclude_conversation_id: Optional[str] = None,
        limit: int = 6,
    ) -> List[Dict[str, Any]]:
        candidates: List[Dict[str, Any]] = []
        if not self.client or self._brain_storage_failed:
            candidates.extend({**row, 'source_type': row.get('source_type', 'company_note')} for row in self._memory_knowledge)
            candidates.extend({
                **row,
                'title': 'Past company conversation',
                'source_type': 'conversation',
            } for row in self._memory_messages if row.get('role') in ('user', 'assistant') and row.get('conversation_id') != exclude_conversation_id)
        else:
            knowledge = await self._run(
                lambda: self.client.table('knowledge_documents').select('*').order('created_at', desc=True).limit(160).execute()
            )
            notes = await self._run(
                lambda: self.client.table('operator_notes').select('*').order('created_at', desc=True).limit(120).execute()
            )
            past = await self._run(
                lambda: self.client.table('brain_messages').select('id,conversation_id,role,content,machine_id,created_at').order('created_at', desc=True).limit(160).execute()
            )
            alerts = await self._run(
                lambda: self.client.table('alerts').select('id,title,description,machine_id,severity,created_at').order('created_at', desc=True).limit(80).execute()
            )
            candidates.extend(knowledge.data or [])
            candidates.extend({
                **row,
                'title': 'Operator observation',
                'content': row.get('text_content') or row.get('transcript') or '',
                'source_type': 'operator_note',
            } for row in (notes.data or []))
            candidates.extend({
                **row,
                'title': 'Past company conversation',
                'source_type': 'conversation',
            } for row in (past.data or []) if row.get('conversation_id') != exclude_conversation_id)
            candidates.extend({
                **row,
                'content': f"{row.get('title', '')}. {row.get('description', '')}",
                'source_type': 'alert',
            } for row in (alerts.data or []))

        ranked: List[Dict[str, Any]] = []
        for row in candidates:
            content = str(row.get('content') or '')
            if not content.strip():
                continue
            score = self._memory_score(query, f"{row.get('title', '')} {content}", machine_id, row.get('machine_id'))
            if score <= 0:
                continue
            ranked.append({
                'id': row.get('id'),
                'title': row.get('title') or 'Company memory',
                'source_type': row.get('source_type') or 'company_note',
                'machine_id': row.get('machine_id'),
                'excerpt': content[:420],
                'score': score,
                'created_at': row.get('created_at'),
            })
        ranked.sort(key=lambda row: (row['score'], row.get('created_at') or ''), reverse=True)
        return ranked[:limit]
