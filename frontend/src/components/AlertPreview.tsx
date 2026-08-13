import { ArrowUpRight, BellRing, Check } from 'lucide-react'
import type { AlertItem, FleetItem } from '../types'

export function AlertPreview({ alert, fleet, onView, onAcknowledge }: { alert?: AlertItem; fleet: FleetItem[]; onView: (machineId: string) => void; onAcknowledge: (id: string) => void }) {
  if (!alert) return <section className="panel alert-preview empty-alert"><div className="alert-preview-icon"><Check size={17}/></div><div><span className="eyebrow">Current alert</span><h2>No active alerts</h2><p>The fleet has no unacknowledged threshold events.</p></div></section>
  const machine = fleet.find((item) => item.machine.machine_id === alert.machine_id)
  const factors = machine?.telemetry?.top_risk_factors?.slice(0, 2) || []
  return <section className={`panel alert-preview severity-${alert.severity}`} aria-label={`Current ${alert.severity} alert`}>
    <div className="alert-preview-icon"><BellRing size={18}/></div>
    <div className="alert-preview-copy"><div className="alert-preview-title"><span className="alert-severity">{alert.severity}</span><time>{new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><h2>{alert.title}</h2><p>{alert.description}</p><div className="alert-context"><strong>{machine?.machine.display_name || alert.machine_id}</strong>{alert.risk_score != null && <span>{Math.round(alert.risk_score * 100)}% risk</span>}{factors.map((factor) => <span key={factor.name}>{factor.name}</span>)}</div></div>
    <div className="alert-preview-actions"><button className="secondary-button" onClick={() => onView(alert.machine_id)}>View machine <ArrowUpRight size={14}/></button><button className="icon-text-button" onClick={() => onAcknowledge(alert.id)} disabled={alert.acknowledged}>{alert.acknowledged ? <><Check size={14}/>Acknowledged</> : 'Acknowledge'}</button></div>
  </section>
}
