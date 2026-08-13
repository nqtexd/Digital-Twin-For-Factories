import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import { BookOpen, BrainCircuit, Database, FileText, MessageSquare, Plus, Send, Sparkles, Trash2, Wrench, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import type { BrainConversation, BrainMessage, BrainSource, FleetItem } from '../types'
import { KnowledgeGraph } from './KnowledgeGraph'

const suggestions = [
  'Which asset needs attention first, and what evidence supports that?',
  'Create a safe implementation guide for the highest-risk machine.',
  'Summarize today’s risks and assign the next maintenance actions.',
]

const guideSections = new Set(['ASSESSMENT', 'SAFETY PREREQUISITES', 'IMPLEMENTATION STEPS', 'VERIFICATION', 'ESCALATE WHEN'])
function BrainAnswer({ content }: { content: string }) {
  const lines = content.split('\n')
  return <div className="message-content structured-answer">{lines.map((line,index) => {
    const clean = line.trim(), isSection = guideSections.has(clean.replace(/[:#*]/g,'').trim().toUpperCase()), isStep = /^\d+\.\s/.test(clean)
    if (!clean) return <span className="answer-space" key={index}/>
    if (isSection) return <strong className="answer-section" key={index}>{clean.replace(/[:#*]/g,'')}</strong>
    return <span className={isStep?'answer-step':'answer-line'} key={index}>{clean}</span>
  })}</div>
}

const sourceLabel = (source: BrainSource) => ({
  operator_note: 'Operator note',
  conversation: 'Past conversation',
  alert: 'Alert history',
  company_note: 'Company knowledge',
}[source.source_type] || 'Company memory')

export function DigitalBrain({ fleet }: { fleet: FleetItem[] }) {
  const [conversations, setConversations] = useState<BrainConversation[]>([])
  const [activeId, setActiveId] = useState('')
  const [messages, setMessages] = useState<BrainMessage[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [machineId, setMachineId] = useState('')
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [knowledgeTitle, setKnowledgeTitle] = useState('')
  const [knowledgeContent, setKnowledgeContent] = useState('')
  const [knowledgeBusy, setKnowledgeBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const refreshConversations = async (preferredId?: string) => {
    const rows = await api.brainConversations()
    setConversations(rows)
    const next = preferredId || activeId || rows[0]?.id || ''
    if (next && next !== activeId) setActiveId(next)
    return rows
  }

  useEffect(() => {
    refreshConversations().catch(() => setNotice('History is temporarily unavailable. New messages can still be sent.')).finally(() => setLoadingHistory(false))
  }, [])

  useEffect(() => {
    if (!activeId) { setMessages([]); return }
    setLoadingHistory(true)
    api.brainMessages(activeId).then(setMessages).catch(() => setNotice('Could not load this conversation.')).finally(() => setLoadingHistory(false))
  }, [activeId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages, busy])

  const newConversation = () => {
    setActiveId('')
    setMessages([])
    setQuestion('')
    setMachineId('')
  }

  const deleteConversation = async (id: string) => {
    await api.deleteBrainConversation(id)
    const remaining = conversations.filter((item) => item.id !== id)
    setConversations(remaining)
    if (activeId === id) { setActiveId(remaining[0]?.id || ''); setMessages([]) }
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = question.trim()
    if (!text || busy) return
    const optimistic: BrainMessage = { id: `pending-${Date.now()}`, conversation_id: activeId, role: 'user', content: text, machine_id: machineId || null, created_at: new Date().toISOString() }
    setMessages((current) => [...current, optimistic])
    setQuestion('')
    setBusy(true)
    setNotice('')
    try {
      const result = await api.askBrain(text, machineId || undefined, activeId || undefined)
      setActiveId(result.conversation_id)
      setMessages((current) => [...current, result.message])
      await refreshConversations(result.conversation_id)
    } catch (error) {
      const content = error instanceof Error ? error.message : 'Company Brain request failed.'
      setMessages((current) => [...current, { id: `error-${Date.now()}`, conversation_id: activeId, role: 'assistant', content, created_at: new Date().toISOString(), metadata: { sources: [] } }])
    } finally { setBusy(false) }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
  }

  const saveKnowledge = async () => {
    if (!knowledgeTitle.trim() || !knowledgeContent.trim()) return
    setKnowledgeBusy(true)
    try {
      await api.addBrainKnowledge(knowledgeTitle.trim(), knowledgeContent.trim(), machineId || undefined)
      setKnowledgeTitle(''); setKnowledgeContent(''); setKnowledgeOpen(false); setNotice('Company knowledge saved and available for retrieval.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save company knowledge.') }
    finally { setKnowledgeBusy(false) }
  }

  const activeConversation = conversations.find((item) => item.id === activeId)
  const latestSources = [...messages].reverse().find((message) => message.metadata?.sources?.length)?.metadata?.sources || []
  const focusedMachine = fleet.find((item) => item.machine.machine_id === machineId)
  const activeSuggestions = focusedMachine ? [
    `Build a safe, evidence-backed implementation guide to diagnose and fix ${focusedMachine.machine.display_name}.`,
    `What parts, tools, safety prerequisites, and qualified roles are needed for ${focusedMachine.machine.display_name}?`,
    `How should we verify ${focusedMachine.machine.display_name} after the repair?`,
  ] : suggestions

  return (
    <div className="brain-page company-brain-page">
      <div className="company-brain-heading">
        <div><span className="eyebrow">Retrieval-augmented company intelligence</span><h1>Company Brain</h1><div className="brain-heading-row"><p>Ask the plant, recall operational history, and turn team knowledge into shared decisions.</p><span className="memory-status"><i/>Memory connected <b>{conversations.length} conversation{conversations.length===1?'':'s'}</b></span></div></div>
      </div>

      <div className="company-brain-shell panel">
        <aside className="brain-history" aria-label="Conversation history">
          <div className="brain-history-head"><div><MessageSquare size={14}/><strong>History</strong></div><button onClick={newConversation} aria-label="New conversation"><Plus size={15}/></button></div>
          <button className="new-brain-chat" onClick={newConversation}><Plus size={14}/>New conversation</button>
          <div className="conversation-list">
            {loadingHistory && !conversations.length ? <div className="history-skeleton"><i/><i/><i/></div> : conversations.length ? conversations.map((conversation) => (
              <motion.div layout key={conversation.id} role="button" tabIndex={0} className={conversation.id === activeId ? 'active' : ''} onClick={() => setActiveId(conversation.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setActiveId(conversation.id) }}>
                <MessageSquare size={12}/><span><strong>{conversation.title}</strong><small>{conversation.machine_id || 'Entire fleet'} · {new Date(conversation.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></span>
                <i className="conversation-active"/>
                <button className="delete-chat" onClick={(event) => { event.stopPropagation(); deleteConversation(conversation.id) }} aria-label={`Delete ${conversation.title}`}><Trash2 size={11}/></button>
              </motion.div>
            )) : <div className="history-empty"><MessageSquare size={18}/><span>Your conversations will appear here.</span></div>}
          </div>
          <button className="teach-brain-button" onClick={() => setKnowledgeOpen(true)}><BookOpen size={14}/><span><strong>Teach Company Brain</strong><small>Add a procedure or plant fact</small></span></button>
        </aside>

        <section className="brain-chat" aria-label="Company Brain chat">
          <header className="brain-chat-head">
            <div><div className="mini-brain"><BrainCircuit size={17}/><i/></div><span><strong>{activeConversation?.title || 'New intelligence session'}</strong><small>Grounded in telemetry and company memory</small></span></div>
            <select value={machineId || activeConversation?.machine_id || ''} onChange={(event) => setMachineId(event.target.value)} aria-label="Machine context"><option value="">Entire fleet</option>{fleet.map((item) => <option key={item.machine.machine_id} value={item.machine.machine_id}>{item.machine.display_name}</option>)}</select>
          </header>

          <div className="brain-message-stream" aria-live="polite">
            {!messages.length && !loadingHistory ? <div className="brain-welcome">
              <div className="welcome-knowledge-graph"><KnowledgeGraph fleet={fleet} conversations={conversations} messages={messages}/></div>
              <div><span className="eyebrow">Plant knowledge</span><h2>Search what the operation already knows.</h2><p>Current telemetry, past conversations, operator evidence, alerts, and verified procedures stay connected and traceable.</p></div>
              <div className="brain-suggestions">{activeSuggestions.map((suggestion,index) => <button key={suggestion} onClick={() => setQuestion(suggestion)}>{index===0?<Wrench size={13}/>:<Sparkles size={12}/>}<span>{suggestion}</span></button>)}</div>
            </div> : loadingHistory ? <div className="message-loading"><i/><i/><i/></div> : messages.map((message) => (
              <motion.article key={message.id} className={`brain-message ${message.role}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="message-avatar">{message.role === 'assistant' ? <BrainCircuit size={15}/> : <span>You</span>}</div>
                <div className="message-body"><div className="message-meta"><strong>{message.role === 'assistant' ? 'Company Brain' : 'You'}</strong><time>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><BrainAnswer content={message.content}/>
                  {!!message.metadata?.sources?.length && <div className="message-sources"><span>Memory used</span><div>{message.metadata.sources.map((source, index) => <div className="source-chip" key={`${source.id}-${index}`} title={source.excerpt}><FileText size={10}/><span>{sourceLabel(source)}</span><b>{Math.round(source.score * 100)}%</b></div>)}</div></div>}
                </div>
              </motion.article>
            ))}
            {busy && <motion.div className="brain-message assistant thinking-message" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><div className="message-avatar"><BrainCircuit size={15}/></div><div className="message-body"><div className="message-meta"><strong>Company Brain</strong><span>Retrieving and reasoning</span></div><div className="thinking-line"><i/><i/><i/></div></div></motion.div>}
            <div ref={endRef}/>
          </div>

          <form className="brain-composer" onSubmit={submit}>
            <div className="composer-context"><Database size={11}/><span>{machineId ? `Repair guidance for ${focusedMachine?.machine.display_name}` : 'Searching across company evidence'}</span><i>Evidence plan</i></div>
            <div><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={onComposerKeyDown} rows={2} placeholder="Ask about risks, history, procedures, or what the team has learned…" aria-label="Message Company Brain"/><button className="brain-send" disabled={busy || !question.trim()} aria-label="Send message"><Send size={16}/></button></div>
            <small>Enter to send · Shift + Enter for a new line · Answers distinguish evidence from inference</small>
          </form>
        </section>

        <aside className="brain-context-rail">
          <KnowledgeGraph fleet={fleet} conversations={conversations} messages={messages}/>
          <div className="context-rail-section"><span className="eyebrow">Active memory</span>{latestSources.length ? latestSources.slice(0, 4).map((source, index) => <div className="rail-source" key={`${source.id}-${index}`}><div><FileText size={11}/></div><span><strong>{source.title}</strong><small>{sourceLabel(source)} · {Math.round(source.score * 100)}% match</small></span></div>) : <p>Relevant company memories will appear here as you ask questions.</p>}</div>
        </aside>
      </div>

      <AnimatePresence>{knowledgeOpen && <motion.div className="knowledge-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setKnowledgeOpen(false)}><motion.section className="knowledge-modal panel" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="knowledge-title"><div className="knowledge-modal-head"><div><span className="eyebrow">Durable company memory</span><h2 id="knowledge-title">Teach Company Brain</h2></div><button onClick={() => setKnowledgeOpen(false)} aria-label="Close"><X size={17}/></button></div><p>Add a verified procedure, machine fact, maintenance lesson, or operating rule. It becomes searchable evidence in future answers.</p><label>Knowledge title<input value={knowledgeTitle} onChange={(event) => setKnowledgeTitle(event.target.value)} placeholder="e.g. Lathe bearing inspection procedure"/></label><label>Company knowledge<textarea value={knowledgeContent} onChange={(event) => setKnowledgeContent(event.target.value)} rows={8} placeholder="Write the verified fact or procedure, including when it applies and who owns it…"/></label><div className="knowledge-actions"><button className="secondary-button" onClick={() => setKnowledgeOpen(false)}>Cancel</button><button className="primary-button" onClick={saveKnowledge} disabled={knowledgeBusy || !knowledgeTitle.trim() || !knowledgeContent.trim()}>{knowledgeBusy ? 'Indexing…' : <><BookOpen size={14}/>Save to memory</>}</button></div></motion.section></motion.div>}</AnimatePresence>
      <AnimatePresence>{notice && <motion.div className="brain-notice" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={() => setNotice('')}>{notice}</motion.div>}</AnimatePresence>
    </div>
  )
}
