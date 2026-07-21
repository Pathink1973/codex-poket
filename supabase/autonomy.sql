-- Codex Pocket: fundações para capacidades autónomas
-- Executar DEPOIS de schema.sql no Supabase SQL Editor.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  github_owner text,
  github_repo text,
  github_installation_id bigint,
  default_branch text default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, github_owner, github_repo)
);

alter table public.threads add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.threads add column if not exists parent_thread_id uuid references public.threads(id) on delete set null;
alter table public.threads add column if not exists favorite boolean not null default false;
alter table public.threads add column if not exists archived_at timestamptz;

create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (char_length(content) between 1 and 200000),
  openai_response_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.threads(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  kind text not null check (kind in ('analysis', 'code_change', 'test', 'pull_request')),
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempt_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  action text not null check (action in ('apply_patch', 'run_tests', 'push_branch', 'open_pull_request')),
  summary text not null,
  diff text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.threads(id) on delete set null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6),
  created_at timestamptz not null default now()
);

create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  color text not null default '#dfff33',
  unique (user_id, name)
);

create table if not exists public.thread_labels (
  thread_id uuid not null references public.threads(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (thread_id, label_id)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists projects_user_idx on public.projects(user_id);
create index if not exists messages_thread_created_idx on public.thread_messages(thread_id, created_at);
create index if not exists jobs_user_status_idx on public.jobs(user_id, status, created_at desc);
create index if not exists approvals_user_status_idx on public.approvals(user_id, status, created_at desc);
create index if not exists usage_user_created_idx on public.usage_events(user_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['projects','thread_messages','jobs','approvals','usage_events','labels','thread_labels','push_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['projects','thread_messages','jobs','approvals','usage_events','labels','thread_labels','push_subscriptions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['projects','jobs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
  end loop;
end $$;

drop policy if exists approvals_update_own on public.approvals;
create policy approvals_update_own on public.approvals for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.projects, public.jobs, public.approvals to authenticated;
grant select, insert, delete on public.thread_messages, public.usage_events, public.labels, public.thread_labels, public.push_subscriptions to authenticated;
grant usage, select on sequence public.usage_events_id_seq to authenticated;

revoke all on public.projects, public.thread_messages, public.jobs, public.approvals, public.usage_events, public.labels, public.thread_labels, public.push_subscriptions from anon;
