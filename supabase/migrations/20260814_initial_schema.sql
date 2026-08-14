-- FlowTwin initial Supabase schema
-- Run this file in the Supabase SQL Editor, or deploy it with `supabase db push`.

create extension if not exists pgcrypto;

create table if not exists public.machines (
  machine_id text primary key check (machine_id ~ '^[A-Z0-9][A-Z0-9-]*$'),
  machine_type text not null,
  display_name text not null,
  line_name text not null,
  rated_rpm integer,
  rated_power_kw numeric(10,2),
  baseline_temperature_c numeric(8,3),
  baseline_vibration_mm_s numeric(8,4),
  status text not null default 'running',
  simulation_scenario text,
  simulation_progress numeric(5,4) not null default 0 check (simulation_progress between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.machine_telemetry (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references public.machines(machine_id) on delete cascade,
  recorded_at timestamptz not null default now(),
  state text not null,
  operation text,
  state_confidence numeric(5,4),
  spindle_rpm numeric(12,3),
  spindle_rpm_source text,
  spindle_rpm_variation_pct numeric(8,4),
  motor_current_a numeric(10,4),
  load_pct numeric(8,4),
  estimated_power_kw numeric(10,4),
  power_estimation_method text,
  power_estimate_confidence numeric(5,4),
  temperature_c numeric(8,4),
  thermal_sensor_location text,
  temperature_rate_c_per_min numeric(10,5),
  vibration_rms_velocity_mm_s numeric(10,5),
  vibration_peak_acceleration_g numeric(10,5),
  vibration_dominant_frequency_hz numeric(10,4),
  vibration_sensor_location text,
  vibration_axis text,
  vibration_sampling_rate_hz integer,
  cycle_id bigint,
  cycle_count_type text,
  cycle_time_s numeric(10,4),
  part_count_verified boolean not null default false,
  runtime_s numeric(14,3),
  idle_time_s numeric(14,3),
  utilization_pct numeric(8,4),
  sensor_health text,
  packet_loss_pct numeric(8,4),
  telemetry_latency_ms integer,
  anomaly_score numeric(7,6),
  ml_failure_probability numeric(7,6),
  physics_risk numeric(7,6),
  trend_risk numeric(7,6),
  risk_score numeric(7,6),
  health_score numeric(7,3),
  risk_level text,
  model_version text,
  top_risk_factors jsonb not null default '[]'::jsonb,
  simulation_scenario text,
  simulation_progress numeric(5,4),
  alert jsonb,
  raw_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references public.machines(machine_id) on delete cascade,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  title text not null,
  description text not null,
  risk_score numeric(7,6),
  source text,
  metadata jsonb not null default '{}'::jsonb,
  acknowledged boolean not null default false,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.operator_notes (
  id uuid primary key default gen_random_uuid(),
  machine_id text references public.machines(machine_id) on delete set null,
  input_type text not null check (input_type in ('text', 'voice')),
  text_content text,
  audio_path text,
  transcript text,
  created_at timestamptz not null default now(),
  check (text_content is not null or audio_path is not null or transcript is not null)
);

create table if not exists public.brain_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  machine_id text references public.machines(machine_id) on delete set null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brain_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.brain_conversations(id) on delete cascade,
  machine_id text references public.machines(machine_id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  context_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Upgrade projects that already have the original Company Brain tables.
alter table public.brain_messages add column if not exists conversation_id uuid;
alter table public.brain_messages add column if not exists machine_id text;
alter table public.brain_messages add column if not exists context_snapshot jsonb not null default '{}'::jsonb;
alter table public.brain_messages add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.brain_messages add column if not exists created_at timestamptz not null default now();
alter table public.brain_messages drop constraint if exists brain_messages_conversation_id_fkey;
alter table public.brain_messages add constraint brain_messages_conversation_id_fkey foreign key (conversation_id) references public.brain_conversations(id) on delete cascade;
alter table public.brain_messages drop constraint if exists brain_messages_machine_id_fkey;
alter table public.brain_messages add constraint brain_messages_machine_id_fkey foreign key (machine_id) references public.machines(machine_id) on delete set null;

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  machine_id text references public.machines(machine_id) on delete set null,
  source_type text not null default 'company_note',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists machine_telemetry_machine_recorded_idx on public.machine_telemetry (machine_id, recorded_at desc);
create index if not exists machine_telemetry_risk_idx on public.machine_telemetry (risk_score desc, recorded_at desc);
create index if not exists alerts_open_created_idx on public.alerts (acknowledged, created_at desc);
create index if not exists operator_notes_machine_created_idx on public.operator_notes (machine_id, created_at desc);
create index if not exists brain_messages_conversation_created_idx on public.brain_messages (conversation_id, created_at);
create index if not exists knowledge_documents_machine_created_idx on public.knowledge_documents (machine_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists machines_set_updated_at on public.machines;
create trigger machines_set_updated_at before update on public.machines for each row execute function public.set_updated_at();
drop trigger if exists brain_conversations_set_updated_at on public.brain_conversations;
create trigger brain_conversations_set_updated_at before update on public.brain_conversations for each row execute function public.set_updated_at();

-- The backend uses the service-role key. Keep browser clients locked down by default.
alter table public.machines enable row level security;
alter table public.machine_telemetry enable row level security;
alter table public.alerts enable row level security;
alter table public.operator_notes enable row level security;
alter table public.brain_conversations enable row level security;
alter table public.brain_messages enable row level security;
alter table public.knowledge_documents enable row level security;

insert into storage.buckets (id, name, public) values ('operator-audio', 'operator-audio', false)
on conflict (id) do nothing;
