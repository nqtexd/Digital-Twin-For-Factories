import { useRef, useState } from 'react'
import { Mic, Square, Send } from 'lucide-react'
import { api } from '../lib/api'

export function OperatorInput({ machineId, onDone }: { machineId?: string; onDone: (message: string) => void }) {
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const saveText = async () => {
    if (!text.trim()) return
    setBusy(true)
    try { await api.addTextNote(text.trim(), machineId); setText(''); onDone('Operator note stored in Supabase.') }
    catch (e) { onDone(e instanceof Error ? e.message : 'Could not store note') }
    finally { setBusy(false) }
  }

  const toggleRecording = async () => {
    if (recording && recorderRef.current) { recorderRef.current.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined })
      chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        setRecording(false); setBusy(true)
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        try {
          const result = await api.addVoiceNote(blob, machineId)
          onDone(result.transcript ? `Voice note stored. Transcript: “${result.transcript}”` : `Voice note stored. ${result.transcription_warning || ''}`)
        } catch (e) { onDone(e instanceof Error ? e.message : 'Could not store voice note') }
        finally { setBusy(false) }
      }
      recorder.start(); recorderRef.current = recorder; setRecording(true)
    } catch { onDone('Microphone permission was not available.') }
  }

  return (
    <section className="panel operator-panel">
      <div className="panel-head compact"><div><span className="eyebrow">Operator evidence</span><h2>Log an observation</h2></div></div>
      <p>Text and voice notes are stored with the selected machine context.</p>
      <div className="note-compose">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Bearing noise increased after tool change…" rows={3} aria-label="Operator note" />
        <div className="button-row">
          <button className={`secondary-button ${recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={busy}>{recording ? <><Square size={15}/>Stop</> : <><Mic size={15}/>Voice note</>}</button>
          <button className="primary-button" onClick={saveText} disabled={busy || !text.trim()}><Send size={15}/>Save note</button>
        </div>
      </div>
    </section>
  )
}
