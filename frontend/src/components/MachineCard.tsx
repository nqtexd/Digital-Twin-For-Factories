import { ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import type { FleetItem } from '../types'

const riskLabel = (risk?: string) => risk ? risk[0].toUpperCase() + risk.slice(1) : 'Waiting'

export function MachineCard({ item, selected, onClick }: { item: FleetItem; selected: boolean; onClick: () => void }) {
  const t = item.telemetry
  return (
    <motion.button layout className={`machine-card ${selected ? 'selected' : ''}`} onClick={onClick} whileTap={{ scale: 0.99 }}>
      <div className="machine-card-head">
        <div>
          <span className="eyebrow">{item.machine.line_name}</span>
          <h3>{item.machine.display_name}</h3>
        </div>
        <ChevronRight size={18} aria-hidden="true" />
      </div>
      <div className="machine-status-line">
        <span className={`status-pill risk-${t?.risk_level || 'low'}`}><i />{riskLabel(t?.risk_level)} risk</span>
        <strong>{t ? `${Math.round(t.health_score)}%` : '—'}</strong>
      </div>
      <div className="mini-metrics">
        <div><span>Temp</span><strong>{t ? `${t.temperature_c.toFixed(1)}°C` : '—'}</strong></div>
        <div><span>Vibration</span><strong>{t ? `${t.vibration_rms_velocity_mm_s.toFixed(2)} mm/s` : '—'}</strong></div>
        <div><span>Load</span><strong>{t ? `${Math.round(t.load_pct)}%` : '—'}</strong></div>
      </div>
      {t?.simulation_scenario && (
        <div className="scenario-progress" aria-label={`Simulation progress ${Math.round((t.simulation_progress || 0) * 100)} percent`}>
          <span style={{ width: `${Math.max(3, (t.simulation_progress || 0) * 100)}%` }} />
        </div>
      )}
    </motion.button>
  )
}
