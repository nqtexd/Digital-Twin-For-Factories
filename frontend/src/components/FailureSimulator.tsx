import { useEffect, useState } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { api } from '../lib/api'
import type { Machine, Telemetry } from '../types'
import { Simulation3DView } from './Simulation3DView'

export function FailureSimulator({ machine, telemetry, onDone }: { machine: Machine; telemetry: Telemetry; onDone: (message: string) => void }) {
  const [scenarios, setScenarios] = useState<{ id: string; name: string }[]>([])
  const [scenario, setScenario] = useState('bearing_fault')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.scenarios().then(setScenarios).catch(() => undefined) }, [])

  const run = async () => {
    setBusy(true)
    try { await api.injectFailure(machine.machine_id, scenario); onDone('Failure simulation started. Watch the underlying signals degrade in real time.') }
    catch (e) { onDone(e instanceof Error ? e.message : 'Could not start simulation') }
    finally { setBusy(false) }
  }
  const reset = async () => {
    setBusy(true)
    try { await api.clearFailure(machine.machine_id); onDone('Machine returned to baseline simulation.') }
    catch (e) { onDone(e instanceof Error ? e.message : 'Could not reset machine') }
    finally { setBusy(false) }
  }

  return (
    <section className="panel simulator-panel">
      <div className="panel-head compact"><div><span className="eyebrow">Demo control</span><h2>Failure simulation</h2></div><TriangleAlert size={18} aria-hidden="true" /></div>
      <p>Inject a gradual fault and inspect its live 3D response. Telemetry, risk scoring and alerts react to the changed signals.</p>
      <Simulation3DView machine={machine} telemetry={telemetry}/>
      <label className="field-label" htmlFor="scenario">Failure mode</label>
      <select id="scenario" value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={busy}>
        {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {telemetry.simulation_scenario && <div className="active-simulation"><div><span>Active scenario</span><strong>{telemetry.simulation_scenario.replaceAll('_', ' ')}</strong></div><b>{Math.round((telemetry.simulation_progress || 0) * 100)}%</b></div>}
      <div className="button-row">
        <button className="primary-button" onClick={run} disabled={busy}>{busy ? 'Working…' : 'Run simulation'}</button>
        <button className="secondary-button" onClick={reset} disabled={busy || !telemetry.simulation_scenario}><RotateCcw size={15} />Restore baseline</button>
      </div>
    </section>
  )
}
