-- FlowTwin AI — hackathon schema
create extension if not exists pgcrypto;

create table if not exists public.machines (
  machine_id text primary key,
  machine_type text not null,
  display_name text not null,
  line_name text not null default 'Line A',
  rated_rpm integer,
  rated_power_kw double precision,
  baseline_temperature_c double precision,
  baseline_vibration_mm_s double precision,
  status text not null default 'running' check (status in ('running','idle','maintenance','offline','warning','critical')),
  simulation_scenario text,
  simulation_progress double precision not null default 0 check (simulation_progress between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.machine_telemetry (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references public.machines(machine_id) on delete cascade,
  machine_type text not null,
  recorded_at timestamptz not null default now(),
  state text not null,
  operation text,
  state_confidence double precision,
  spindle_rpm double precision,
  spindle_rpm_source text,
  spindle_rpm_variation_pct double precision,
  motor_current_a double precision,
  load_pct double precision,
  estimated_power_kw double precision,
  power_estimation_method text,
  power_estimate_confidence double precision,
  temperature_c double precision,
  thermal_sensor_location text,
  temperature_rate_c_per_min double precision,
  vibration_rms_velocity_mm_s double precision,
  vibration_peak_acceleration_g double precision,
  vibration_dominant_frequency_hz double precision,
  vibration_sensor_location text,
  vibration_axis text,
  vibration_sampling_rate_hz integer,
  cycle_id bigint,
  cycle_count_type text,
  cycle_time_s double precision,
  part_count_verified boolean default false,
  runtime_s bigint,
  idle_time_s bigint,
  utilization_pct double precision,
  sensor_health text,
  packet_loss_pct double precision,
  telemetry_latency_ms integer,
  anomaly_score double precision,
  ml_failure_probability double precision,
  physics_risk double precision,
  trend_risk double precision,
  risk_score double precision,
  health_score double precision,
  risk_level text,
  model_version text,
  top_risk_factors jsonb not null default '[]'::jsonb,
  simulation_scenario text,
  simulation_progress double precision,
  alert jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  constraint state_confidence_range check (state_confidence is null or state_confidence between 0 and 1),
  constraint power_confidence_range check (power_estimate_confidence is null or power_estimate_confidence between 0 and 1),
  constraint utilization_range check (utilization_pct is null or utilization_pct between 0 and 100),
  constraint health_score_range check (health_score is null or health_score between 0 and 100),
  constraint anomaly_score_range check (anomaly_score is null or anomaly_score between 0 and 1),
  constraint risk_score_range check (risk_score is null or risk_score between 0 and 1)
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references public.machines(machine_id) on delete cascade,
  severity text not null check (severity in ('info','warning','high','critical')),
  title text not null,
  description text not null,
  risk_score double precision,
  acknowledged boolean not null default false,
  source text not null default 'risk_engine',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create table if not exists public.operator_notes (
  id uuid primary key default gen_random_uuid(),
  machine_id text references public.machines(machine_id) on delete set null,
  input_type text not null check (input_type in ('text','voice')),
  text_content text,
  audio_path text,
  transcript text,
  created_at timestamptz not null default now()
);

create table if not exists public.brain_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New conversation',
  machine_id text references public.machines(machine_id) on delete set null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brain_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.brain_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  machine_id text references public.machines(machine_id) on delete set null,
  context_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Safe upgrades for projects created with the earlier hackathon schema.
alter table public.brain_messages add column if not exists conversation_id uuid references public.brain_conversations(id) on delete cascade;
alter table public.brain_messages add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  source_type text not null default 'company_note',
  machine_id text references public.machines(machine_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_machine_telemetry_machine_time on public.machine_telemetry (machine_id, recorded_at desc);
create index if not exists idx_machine_telemetry_time on public.machine_telemetry (recorded_at desc);
create index if not exists idx_machine_telemetry_risk on public.machine_telemetry (risk_level, recorded_at desc);
create index if not exists idx_alerts_machine_time on public.alerts (machine_id, created_at desc);
create index if not exists idx_alerts_open on public.alerts (acknowledged, created_at desc);
create index if not exists idx_brain_conversations_updated on public.brain_conversations (updated_at desc);
create index if not exists idx_brain_messages_conversation_time on public.brain_messages (conversation_id, created_at);
create index if not exists idx_knowledge_search on public.knowledge_documents using gin (search_vector);
create index if not exists idx_knowledge_machine on public.knowledge_documents (machine_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operator-audio',
  'operator-audio',
  false,
  26214400,
  array['audio/webm','audio/wav','audio/mpeg','audio/mp4','audio/ogg']
)
on conflict (id) do nothing;

alter table public.machines enable row level security;
alter table public.machine_telemetry enable row level security;
alter table public.alerts enable row level security;
alter table public.operator_notes enable row level security;
alter table public.brain_messages enable row level security;
alter table public.brain_conversations enable row level security;
alter table public.knowledge_documents enable row level security;

-- Hackathon dashboard: anon clients can read operational state only.
-- All writes go through the backend with the service-role key.
do $$ begin
  create policy "public read machines" on public.machines for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public read telemetry" on public.machine_telemetry for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public read alerts" on public.alerts for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public read notes" on public.operator_notes for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public read brain" on public.brain_messages for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public read brain conversations" on public.brain_conversations for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public read company knowledge" on public.knowledge_documents for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;

-- Realtime publication. Safe if run more than once.
do $$ begin
  alter publication supabase_realtime add table public.machines;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.machine_telemetry;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.alerts;
exception when duplicate_object then null; end $$;
