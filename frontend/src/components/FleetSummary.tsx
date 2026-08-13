import { Activity, AlertTriangle, HeartPulse, ShieldAlert } from 'lucide-react'

interface FleetMetrics { avgHealth: number; avgUtil: number; risky: number; maxRisk: number }

export function FleetSummary({ metrics }: { metrics: FleetMetrics }) {
  const cards = [
    { label: 'Fleet health', value: `${Math.round(metrics.avgHealth)}`, suffix: '/100', note: 'Hybrid predictive score', icon: HeartPulse, tone: 'good' },
    { label: 'Utilization', value: `${Math.round(metrics.avgUtil)}%`, note: 'Average fleet utilization', icon: Activity, tone: 'neutral' },
    { label: 'Machines requiring attention', value: `${metrics.risky}`, note: 'High or critical risk', icon: AlertTriangle, tone: metrics.risky ? 'warning' : 'good' },
    { label: 'Peak failure risk', value: `${Math.round(metrics.maxRisk * 100)}%`, note: 'Highest current machine risk', icon: ShieldAlert, tone: metrics.maxRisk >= .65 ? 'danger' : metrics.maxRisk >= .35 ? 'warning' : 'neutral' },
  ]
  return <section className="fleet-summary" aria-label="Fleet summary">{cards.map(({ label, value, suffix, note, icon: Icon, tone }) => <article className={`fleet-metric tone-${tone}`} key={label}><div className="fleet-metric-icon"><Icon size={17}/></div><div><span>{label}</span><strong>{value}{suffix && <small>{suffix}</small>}</strong><p>{note}</p></div></article>)}</section>
}
