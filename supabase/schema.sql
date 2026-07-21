-- Codex Pocket: esquema inicial e políticas RLS
-- Executar integralmente no Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  prompt text not null check (char_length(prompt) between 1 and 50000),
  output text not null default '',
  error text,
  status text not null default 'running' check (status in ('running', 'completed', 'cancelled', 'failed')),
  reasoning_effort text not null default 'medium' check (reasoning_effort in ('low', 'medium', 'high', 'xhigh')),
  file_count integer not null default 0 check (file_count between 0 and 40),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists threads_user_created_idx on public.threads (user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists threads_set_updated_at on public.threads;
create trigger threads_set_updated_at before update on public.threads
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Cria perfis para utilizadores que já existiam antes deste script.
insert into public.profiles (id, email, display_name)
select id, email, coalesce(raw_user_meta_data ->> 'display_name', split_part(email, '@', 1))
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.threads enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "threads_select_own" on public.threads;
create policy "threads_select_own" on public.threads
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "threads_insert_own" on public.threads;
create policy "threads_insert_own" on public.threads
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "threads_update_own" on public.threads;
create policy "threads_update_own" on public.threads
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "threads_delete_own" on public.threads;
create policy "threads_delete_own" on public.threads
for delete to authenticated using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.threads to authenticated;
revoke all on public.profiles from anon;
revoke all on public.threads from anon;
