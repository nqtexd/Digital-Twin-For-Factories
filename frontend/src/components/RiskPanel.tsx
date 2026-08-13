import { Info } from 'lucide-react'
import type { Telemetry } from '../types'

const rows = [
  ['ML failure probability', 'ml_failure_probability'],
  ['Anomaly detector', 'anomaly_score'],
  ['Physics limits', 'physics_risk'],
  ['Short-term trend', 'trend_risk'],
] as const

export function RiskPanel({ telemetry }: { telemetry: Telemetry }) {
  return (
    <section className="panel risk-panel">
      <div className="panel-head compact">
        <div><span className="eyebrow">Hybrid model</span><h2>Risk reasoning</h2></div>
        <span className="model-tag" title="Trained on synthetic failure trajectories until real plant data is supplied"><Info size={13} /> simulation-calibrated</span>
      </div>
      <div className="risk-score-row">
        <div className={`risk-orb risk-${telemetry.risk_level}`}><strong>{Math.round(telemetry.risk_score * 100)}</strong><span>risk</span></div>
        <div className="risk-copy"><strong>{telemetry.risk_level.toUpperCase()}</strong><span>Health score {Math.round(telemetry.health_score)} / 100</span><small>{telemetry.model_version}</small></div>
      </div>
      <div className="factor-bars">
        {rows.map(([label, key]) => {
          const value = Number(telemetry[key] || 0)
          return <div className="factor-row" key={key}><div><span>{label}</span><strong>{Math.round(value * 100)}%</strong></div><div className="bar"><span style={{ width: `${value * 100}%` }} /></div></div>
        })}
      </div>
      <div className="top-factors">
        <span className="eyebrow">Leading contributors</span>
        <div>{telemetry.top_risk_factors?.slice(0, 4).map((f) => <span className="factor-chip" key={f.name}>{f.name} <b>{Math.round(f.percent)}%</b></span>)}</div>
      </div>
    </section>
  )
}
