import type { AlertItem, BrainConversation, BrainMessage, BrainSource, FleetItem, HealthStatus, MachineCreateInput, MachineTypePreset, Telemetry } from '../types'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Request failed (${response.status})`)
  }
  return response.json()
}

export const api = {
  health: () => request<HealthStatus>('/api/health'),
  fleet: () => request<FleetItem[]>('/api/fleet'),
  alerts: () => request<AlertItem[]>('/api/alerts'),
  history: (machineId: string, limit = 120) => request<Telemetry[]>(`/api/machines/${machineId}/history?limit=${limit}`),
  machineTypes: () => request<MachineTypePreset[]>('/api/machine-types'),
  createMachine: (machine: MachineCreateInput) => request<FleetItem>('/api/machines', { method: 'POST', body: JSON.stringify(machine) }),
  deleteMachine: (machineId: string) => request<{ ok: boolean }>(`/api/machines/${machineId}`, { method: 'DELETE' }),
  scenarios: () => request<{ id: string; name: string }[]>('/api/simulation/scenarios'),
  injectFailure: (machine_id: string, scenario: string, speed = 0.025) =>
    request('/api/simulation/failure', { method: 'POST', body: JSON.stringify({ machine_id, scenario, speed }) }),
  clearFailure: (machineId: string) => request(`/api/simulation/${machineId}`, { method: 'DELETE' }),
  brainConversations: () => request<BrainConversation[]>('/api/brain/conversations'),
  createBrainConversation: (title = 'New conversation', machine_id?: string) =>
    request<BrainConversation>('/api/brain/conversations', { method: 'POST', body: JSON.stringify({ title, machine_id: machine_id || null }) }),
  brainMessages: (conversationId: string) => request<BrainMessage[]>(`/api/brain/conversations/${conversationId}/messages`),
  deleteBrainConversation: (conversationId: string) => request(`/api/brain/conversations/${conversationId}`, { method: 'DELETE' }),
  addBrainKnowledge: (title: string, content: string, machine_id?: string) =>
    request('/api/brain/knowledge', { method: 'POST', body: JSON.stringify({ title, content, machine_id: machine_id || null }) }),
  askBrain: (question: string, machine_id?: string, conversation_id?: string) =>
    request<{ answer: string; model: string; conversation_id: string; message: BrainMessage; sources: BrainSource[] }>('/api/brain/ask', {
      method: 'POST',
      body: JSON.stringify({ question, machine_id: machine_id || null, conversation_id: conversation_id || null }),
    }),
  addTextNote: (text: string, machine_id?: string) =>
    request('/api/notes/text', { method: 'POST', body: JSON.stringify({ text, machine_id: machine_id || null }) }),
  addVoiceNote: async (blob: Blob, machineId?: string) => {
    const form = new FormData()
    form.append('audio', blob, 'operator-note.webm')
    if (machineId) form.append('machine_id', machineId)
    return request<{ transcript?: string; transcription_warning?: string }>('/api/notes/voice', { method: 'POST', body: form })
  },
  acknowledgeAlert: (alertId: string) => request(`/api/alerts/${alertId}/acknowledge`, { method: 'POST' }),
}
