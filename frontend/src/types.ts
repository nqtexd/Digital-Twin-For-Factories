export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ThemeMode = 'dark' | 'light'
export type MotionMode = 'full' | 'reduced'
export type FactoryViewMode = '2d' | '3d'
export type NavigationSection = 'overview' | 'factory' | 'incidents' | 'brain'
export type InspectorState = { kind: 'machine' | 'incident' | 'knowledge'; id: string } | null

export interface RiskFactor {
  name: string
  contribution: number
  percent: number
}

export interface Machine {
  machine_id: string
  machine_type: string
  display_name: string
  line_name: string
  rated_rpm?: number
  rated_power_kw?: number
  status: string
  simulation_scenario?: string | null
  simulation_progress?: number
  metadata?: {
    operation?: string
    description?: string
    expected_cycle_time_s?: number
    layout_x?: number
    layout_y?: number
  }
}

export interface MachineTypePreset {
  machine_type: string
  label: string
  description: string
  operation: string
  rated_rpm: number
  rated_power_kw: number
  base_temp: number
  base_vibration: number
  expected_cycle: number
}

export interface MachineCreateInput {
  machine_id: string
  machine_type: string
  display_name: string
  line_name: string
  layout_x: number
  layout_y: number
}

export interface Telemetry {
  id?: string
  machine_id: string
  recorded_at: string
  state: string
  operation: string
  spindle_rpm: number
  spindle_rpm_variation_pct: number
  motor_current_a: number
  load_pct: number
  estimated_power_kw: number
  temperature_c: number
  temperature_rate_c_per_min: number
  vibration_rms_velocity_mm_s: number
  vibration_peak_acceleration_g: number
  cycle_id: number
  cycle_time_s: number
  utilization_pct: number
  packet_loss_pct: number
  telemetry_latency_ms: number
  anomaly_score: number
  ml_failure_probability: number
  physics_risk: number
  trend_risk: number
  risk_score: number
  health_score: number
  risk_level: RiskLevel
  model_version: string
  top_risk_factors: RiskFactor[]
  simulation_scenario?: string | null
  simulation_progress?: number
}

export interface FleetItem {
  machine: Machine
  telemetry: Telemetry | null
}

export interface HealthStatus {
  status: string
  database: string
  groq: string
  simulator: boolean
  risk_model: string
  disclaimer: string
  company_memory?: string
}

export interface BrainSource {
  id?: string
  title: string
  source_type: 'company_note' | 'operator_note' | 'conversation' | 'alert' | string
  machine_id?: string | null
  excerpt: string
  score: number
  created_at?: string
}

export interface BrainMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  machine_id?: string | null
  metadata?: { sources?: BrainSource[]; model?: string }
  created_at: string
}

export interface BrainConversation {
  id: string
  title: string
  machine_id?: string | null
  summary?: string
  created_at: string
  updated_at: string
}

export interface AlertItem {
  id: string
  machine_id: string
  severity: string
  title: string
  description: string
  risk_score?: number
  acknowledged: boolean
  created_at: string
}
