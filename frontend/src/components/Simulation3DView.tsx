import { Component, type ReactNode, Suspense, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { Group } from 'three'
import type { Machine, Telemetry } from '../types'
import { LoadedMachineGeometry, MachineGeometryProcedural, resolveStatusColor, type MachineAnimState } from './LoadedMachineGeometry'

// ─── Error boundary ────────────────────────────────────────────────────────
class ThreeErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: unknown) { console.warn('Simulation 3D Model load fallback:', error) }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

// ─── Temperature range config per machine type ─────────────────────────────
const TEMP_LIMITS: Record<string, { min: number; max: number }> = {
  cnc_lathe:        { min: 18, max: 72 },
  cnc_mill:         { min: 18, max: 72 },
  cnc_sat:          { min: 18, max: 72 },
  hydraulic_press:  { min: 20, max: 85 },
  coolant_pump:     { min: 15, max: 65 },
  surface_grinder:  { min: 18, max: 78 },
  default:          { min: 18, max: 80 },
}
const VIBRATION_THRESHOLD_HIGH = 6.5 // mm/s RMS

function buildAnimState(machine: Machine, telemetry: Telemetry): MachineAnimState {
  const limits = TEMP_LIMITS[machine.machine_type] ?? TEMP_LIMITS.default
  const temp = telemetry.temperature_c ?? 0
  const vib  = telemetry.vibration_rms_velocity_mm_s ?? 0
  const active = Boolean(telemetry.simulation_scenario)
  return {
    temperatureAlert: temp > limits.max || temp < limits.min,
    highVibration:    vib > VIBRATION_THRESHOLD_HIGH,
    normalOp:         !active && telemetry.risk_level === 'low',
    simulationActive: active,
    simulationProgress: telemetry.simulation_progress ?? 0,
  }
}

// ─── 3D animated machine ────────────────────────────────────────────────────
function SimulatedMachine({ machine, telemetry }: { machine: Machine; telemetry: Telemetry }) {
  const group = useRef<Group>(null)
  const pulseRef = useRef<THREE.Mesh>(null)

  const animState = buildAnimState(machine, telemetry)
  const active = animState.simulationActive
  const intensity = active ? Math.max(0.25, animState.simulationProgress) : 0.08
  const tone = telemetry.risk_level === 'critical' || telemetry.risk_level === 'high'
    ? '#ff665f'
    : telemetry.risk_level === 'medium' ? '#f5c15e' : '#54e7c0'
  const statusColor = resolveStatusColor(tone, animState)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (group.current) group.current.rotation.y = Math.sin(t * 0.35) * 0.08
    if (pulseRef.current) {
      const pulseSpeed = animState.temperatureAlert ? 8 : animState.highVibration ? 12 : active ? 6 : 2
      pulseRef.current.scale.setScalar(1 + Math.sin(t * pulseSpeed) * intensity * 0.3)
      ;(pulseRef.current.material as THREE.MeshBasicMaterial).color.set(statusColor)
    }
  })

  const type = machine.machine_type
  // Hydraulic press gets bigger targetHeight
  const targetHeight = type === 'hydraulic_press' ? 3.2 : 2.2

  return (
    <group ref={group} position={[0, -0.65, 0]}>
      <ThreeErrorBoundary fallback={<MachineGeometryProcedural type={type} tone={tone} anim={animState} />}>
        <Suspense fallback={<MachineGeometryProcedural type={type} tone={tone} anim={animState} />}>
          <LoadedMachineGeometry type={type} tone={tone} targetHeight={targetHeight} animState={animState} />
        </Suspense>
      </ThreeErrorBoundary>
      {/* Status beacon */}
      <mesh ref={pulseRef} position={[0, targetHeight + 0.45, 0]}>
        <sphereGeometry args={[0.14, 20, 20]} />
        <meshBasicMaterial color={statusColor} />
      </mesh>
      {/* Point light matching status color */}
      <pointLight
        position={[0, targetHeight + 0.2, 1]}
        color={statusColor}
        intensity={active ? 3.5 : 0.8}
        distance={8}
      />
    </group>
  )
}

// ─── Scenario metadata ───────────────────────────────────────────────────────
const SCENARIO_INFO: Record<string, { icon: string; title: string; what: string; why: string; effect: string }> = {
  bearing_wear:      { icon: '⚙️', title: 'Bearing Wear',        what: 'Simulating progressive bearing degradation inside the spindle.',   why: 'Worn bearings increase friction, cause heat spikes and high-frequency vibration.',                  effect: 'Vibration RMS rises · Temperature climbs · RPM variation increases' },
  thermal_runaway:   { icon: '🌡️', title: 'Thermal Runaway',     what: 'Coolant flow reduced to 0%, heat builds inside the motor housing.', why: 'Without cooling, motor temperature exceeds safe limits causing winding damage or shutdown.',        effect: 'Temperature alert (red) · Load spikes · Health drops rapidly' },
  voltage_fluctuation:{ icon:'⚡', title: 'Voltage Fluctuation',  what: 'Mains supply varies ±15%, starving the servo drives of stable power.',why: 'Unstable voltage causes erratic servo torque, position errors and overheating of drive modules.',   effect: 'Motor current spikes · RPM variation · Increased packet loss' },
  tool_breakage:     { icon: '🔧', title: 'Tool Breakage',        what: 'Cutting tool fractures mid-cycle, load drops suddenly to zero.',   why: 'A broken tool causes the spindle to spin unloaded, then jam on re-engagement.',                   effect: 'Load drops to 0 → spikes · Vibration peak increases · Cycle time extends' },
  coolant_failure:   { icon: '💧', title: 'Coolant Failure',      what: 'Coolant pump stops supplying fluid to the cutting zone.',          why: 'Dry cutting generates extreme heat at the tool-workpiece interface, damaging both.',                effect: 'Temperature rises rapidly · Tool wear accelerates · Surface finish degrades' },
  spindle_imbalance: { icon: '🔄', title: 'Spindle Imbalance',    what: 'Mass imbalance in the rotating spindle assembly.',                 why: 'Imbalance creates centrifugal forces that grow with RPM, damaging bearings and machine structure.',  effect: 'High vibration at 1× RPM frequency · Structure resonance · Bearing damage' },
  default:           { icon: '🔬', title: 'Simulation Running',   what: 'A failure mode is being injected into the digital twin.',          why: 'Testing how the machine responds to fault conditions without real-world risk.',                     effect: 'See telemetry panels for live sensor reactions' },
}

function getScenarioInfo(scenario: string | null | undefined) {
  if (!scenario) return null
  return SCENARIO_INFO[scenario] ?? SCENARIO_INFO.default
}

// ─── HUD telemetry bar ────────────────────────────────────────────────────
function TelemetryBar({ label, value, unit, min, max, warn, danger, color }: {
  label: string; value: number; unit: string
  min: number; max: number; warn: number; danger: number; color: string
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  const isWarn = value >= warn
  const isDanger = value >= danger
  const barColor = isDanger ? '#ff3d3d' : isWarn ? '#f5a623' : color
  return (
    <div className="sim3d-telebar">
      <div className="sim3d-telebar-header">
        <span className="sim3d-telebar-label">{label}</span>
        <span className="sim3d-telebar-value" style={{ color: barColor }}>
          {value.toFixed(1)}<span className="sim3d-telebar-unit">{unit}</span>
        </span>
      </div>
      <div className="sim3d-telebar-track">
        <div className="sim3d-telebar-fill" style={{ width: `${pct}%`, background: barColor }} />
        {/* Warn threshold marker */}
        <div className="sim3d-telebar-marker" style={{ left: `${Math.min(100, ((warn - min) / (max - min)) * 100)}%` }} />
      </div>
    </div>
  )
}

// ─── Status legend pill ───────────────────────────────────────────────────
function StatusLegend({ animState }: { animState: MachineAnimState }) {
  if (animState.temperatureAlert) return (
    <div className="sim3d-status-pill sim3d-status-red">
      <span className="sim3d-status-dot" />🌡️ Temperature Out of Range — Machine glows red
    </div>
  )
  if (animState.highVibration) return (
    <div className="sim3d-status-pill sim3d-status-amber">
      <span className="sim3d-status-dot" />📳 High Vibration Detected — Machine shaking fast
    </div>
  )
  if (animState.normalOp) return (
    <div className="sim3d-status-pill sim3d-status-green">
      <span className="sim3d-status-dot" />✅ Normal Operation — All systems within limits
    </div>
  )
  if (animState.simulationActive) return (
    <div className="sim3d-status-pill sim3d-status-amber">
      <span className="sim3d-status-dot sim3d-dot-pulse" />⚠️ Fault Scenario Active — {Math.round(animState.simulationProgress * 100)}% progression
    </div>
  )
  return (
    <div className="sim3d-status-pill sim3d-status-default">
      <span className="sim3d-status-dot" />🔵 Monitoring — No active faults
    </div>
  )
}

// ─── Progress timeline ────────────────────────────────────────────────────
function ProgressTimeline({ progress, active }: { progress: number; active: boolean }) {
  if (!active) return null
  const stages = [
    { label: 'Fault Seed', pct: 0 },
    { label: 'Early Signs', pct: 0.25 },
    { label: 'Detectable', pct: 0.5 },
    { label: 'Significant', pct: 0.75 },
    { label: 'Critical', pct: 1.0 },
  ]
  return (
    <div className="sim3d-timeline">
      <div className="sim3d-timeline-label">Fault Progression</div>
      <div className="sim3d-timeline-track">
        <div className="sim3d-timeline-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        {stages.map((s) => (
          <div
            key={s.label}
            className={`sim3d-timeline-stage ${progress >= s.pct ? 'reached' : ''}`}
            style={{ left: `${s.pct * 100}%` }}
            title={s.label}
          />
        ))}
      </div>
      <div className="sim3d-timeline-stages">
        {stages.map((s) => (
          <span key={s.label} className={`sim3d-stage-label ${progress >= s.pct ? 'reached' : ''}`}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Main export ────────────────────────────────────────────────────────────
export function Simulation3DView({ machine, telemetry }: { machine: Machine; telemetry: Telemetry }) {
  const active = Boolean(telemetry.simulation_scenario)
  const animState = buildAnimState(machine, telemetry)
  const scenarioInfo = getScenarioInfo(telemetry.simulation_scenario)

  const limits = TEMP_LIMITS[machine.machine_type] ?? TEMP_LIMITS.default

  // Tick counter for live "pulse" feel on telemetry numbers
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 1200)
    return () => clearInterval(id)
  }, [])
  void tick

  return (
    <div className={`simulation-3d ${active ? 'active' : ''}`}>
      {/* ── 3D Canvas ─────────────────────────────────── */}
      <div className="sim3d-canvas-wrapper">
        <Canvas
          style={{ width: '100%', height: '100%', display: 'block' }}
          dpr={[1, 1.5]}
          camera={{ position: [4.5, 3.1, 5.4], fov: 42 }}
        >
          <color attach="background" args={['#0b171b']} />
          <ambientLight intensity={1.1} />
          <hemisphereLight args={['#b8f1f2', '#071014', 1.5]} />
          <directionalLight position={[3, 5, 4]} intensity={2.5} />
          <mesh position={[0, -0.82, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[10, 10]} />
            <meshStandardMaterial color="#10242a" metalness={0.2} roughness={0.82} />
          </mesh>
          <gridHelper args={[10, 14, '#365059', '#193239']} position={[0, -0.8, 0]} />
          <SimulatedMachine machine={machine} telemetry={telemetry} />
          <OrbitControls enablePan={false} minDistance={4} maxDistance={9} maxPolarAngle={Math.PI / 2.05} />
        </Canvas>

        {/* Orbit hint */}
        <div className="sim3d-orbit-hint">🖱️ Drag to rotate · Scroll to zoom</div>

        {/* Status badge overlay on canvas */}
        <div className="sim3d-canvas-badge">
          {active ? (
            <span className="sim3d-badge sim3d-badge-active">▶ Scenario Playing</span>
          ) : (
            <span className="sim3d-badge sim3d-badge-live">● Live Baseline</span>
          )}
        </div>
      </div>

      {/* ── Info / Telemetry Panel ─────────────────────── */}
      <div className="sim3d-info-panel">

        {/* Machine title */}
        <div className="sim3d-machine-title">
          <strong>{machine.display_name}</strong>
          <span className="sim3d-machine-type">{machine.machine_type.replaceAll('_', ' ')}</span>
        </div>

        {/* Status legend */}
        <StatusLegend animState={animState} />

        {/* Color guide */}
        <div className="sim3d-color-guide">
          <div className="sim3d-color-item"><span className="sim3d-color-dot" style={{ background: '#22dd88' }} />Green = Normal</div>
          <div className="sim3d-color-item"><span className="sim3d-color-dot" style={{ background: '#ff3d3d' }} />Red = Temperature Alert</div>
          <div className="sim3d-color-item"><span className="sim3d-color-dot" style={{ background: '#f5a623' }} />Amber = High Vibration</div>
        </div>

        {/* Live telemetry bars */}
        <div className="sim3d-section-label">📊 Live Sensor Readings</div>
        <TelemetryBar
          label="Temperature"
          value={telemetry.temperature_c}
          unit="°C"
          min={0} max={120}
          warn={limits.max * 0.8}
          danger={limits.max}
          color="#54e7c0"
        />
        <TelemetryBar
          label="Vibration RMS"
          value={telemetry.vibration_rms_velocity_mm_s}
          unit=" mm/s"
          min={0} max={20}
          warn={VIBRATION_THRESHOLD_HIGH * 0.7}
          danger={VIBRATION_THRESHOLD_HIGH}
          color="#54e7c0"
        />
        <TelemetryBar
          label="Health Score"
          value={telemetry.health_score}
          unit="%"
          min={0} max={100}
          warn={50}
          danger={30}
          color="#54e7c0"
        />
        <TelemetryBar
          label="Load"
          value={telemetry.load_pct}
          unit="%"
          min={0} max={100}
          warn={85}
          danger={95}
          color="#54e7c0"
        />

        {/* Progress timeline */}
        <ProgressTimeline progress={telemetry.simulation_progress ?? 0} active={active} />

        {/* Scenario explanation card */}
        {active && scenarioInfo && (
          <div className="sim3d-scenario-card">
            <div className="sim3d-scenario-header">
              <span className="sim3d-scenario-icon">{scenarioInfo.icon}</span>
              <div>
                <div className="sim3d-scenario-title">Scenario: {scenarioInfo.title}</div>
                <div className="sim3d-scenario-progress">{Math.round((telemetry.simulation_progress ?? 0) * 100)}% fault progression</div>
              </div>
            </div>
            <div className="sim3d-scenario-section">
              <div className="sim3d-scenario-section-label">🔍 What's happening</div>
              <p>{scenarioInfo.what}</p>
            </div>
            <div className="sim3d-scenario-section">
              <div className="sim3d-scenario-section-label">⚠️ Why it matters</div>
              <p>{scenarioInfo.why}</p>
            </div>
            <div className="sim3d-scenario-section">
              <div className="sim3d-scenario-section-label">📈 Observable effects</div>
              <p className="sim3d-scenario-effects">{scenarioInfo.effect}</p>
            </div>
          </div>
        )}

        {/* Baseline state description */}
        {!active && (
          <div className="sim3d-baseline-card">
            <div className="sim3d-baseline-header">📡 Digital Twin — Live Baseline</div>
            <p>
              This 3D view mirrors the real machine in real-time. The model's colour, glow and
              motion reflect actual sensor readings — <strong style={{color:'#22dd88'}}>green</strong> when
              all metrics are within limits, <strong style={{color:'#ff3d3d'}}>red</strong> if temperature
              exceeds {limits.max}°C, and <strong style={{color:'#f5a623'}}>amber + fast shake</strong> when
              vibration exceeds {VIBRATION_THRESHOLD_HIGH} mm/s RMS.
            </p>
            <p>
              Use the <em>Failure Simulator</em> panel to inject a fault scenario and watch how
              sensor readings respond in real-time across all views.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
