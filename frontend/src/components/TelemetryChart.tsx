import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Telemetry } from '../types'

const metrics = {
  risk_score: { label: 'Risk', format: (v: number) => `${Math.round(v * 100)}%` },
  temperature_c: { label: 'Temperature', format: (v: number) => `${v.toFixed(1)}°C` },
  vibration_rms_velocity_mm_s: { label: 'Vibration', format: (v: number) => `${v.toFixed(2)} mm/s` },
  load_pct: { label: 'Load', format: (v: number) => `${Math.round(v)}%` },
} as const

type MetricKey = keyof typeof metrics

export function TelemetryChart({ history }: { history: Telemetry[] }) {
  const [metric, setMetric] = useState<MetricKey>('risk_score')
  const rows = useMemo(() => history.slice(-80).map((r) => ({ ...r, time: new Date(r.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })), [history])
  return (
    <section className="panel chart-panel">
      <div className="panel-head">
        <div><span className="eyebrow">Live trend</span><h2>{metrics[metric].label}</h2></div>
        <div className="segmented" role="group" aria-label="Chart metric">
          {(Object.keys(metrics) as MetricKey[]).map((key) => <button key={key} className={key === metric ? 'active' : ''} onClick={() => setMetric(key)}>{metrics[key].label}</button>)}
        </div>
      </div>
      <div className="chart-wrap">
        {rows.length < 2 ? <div className="empty-state">Collecting telemetry…</div> : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={34} />
              <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--panel-strong)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }} formatter={(value) => metrics[metric].format(Number(value))} labelStyle={{ color: 'var(--muted)' }} />
              <Line type="monotone" dataKey={metric} stroke="var(--accent)" strokeWidth={2.4} dot={false} activeDot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--panel)', strokeWidth: 3 }} isAnimationActive animationDuration={500} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}
