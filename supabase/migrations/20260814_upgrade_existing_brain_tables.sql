-- Run this FIRST in the Supabase SQL Editor for an existing FlowTwin database.
-- It is safe to run more than once.

alter table public.brain_messages
  add column if not exists conversation_id uuid null;

alter table public.brain_messages
  add column if not exists machine_id text null;

alter table public.brain_messages
  add column if not exists context_snapshot jsonb not null default '{}'::jsonb;

alter table public.brain_messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.brain_messages
  add column if not exists created_at timestamptz not null default now();

-- Add relations only when their target tables already exist.
do $$
begin
  if to_regclass('public.brain_conversations') is not null
     and not exists (select 1 from pg_constraint where conname = 'brain_messages_conversation_id_fkey') then
    alter table public.brain_messages
      add constraint brain_messages_conversation_id_fkey
      foreign key (conversation_id) references public.brain_conversations(id) on delete cascade;
  end if;

  if to_regclass('public.machines') is not null
     and not exists (select 1 from pg_constraint where conname = 'brain_messages_machine_id_fkey') then
    alter table public.brain_messages
      add constraint brain_messages_machine_id_fkey
      foreign key (machine_id) references public.machines(machine_id) on delete set null;
  end if;
end $$;

create index if not exists brain_messages_conversation_created_idx
  on public.brain_messages (conversation_id, created_at);
