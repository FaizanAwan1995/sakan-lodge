-- Restrict all tenant, finance and audit tables to the two Sakan Lodge staff accounts.
-- IMPORTANT: Review against live Auth users before applying. This migration is not applied automatically.
-- A verified email alone is insufficient: authorization uses auth.uid() against an explicit allowlist.
create table if not exists public.staff_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.staff_access enable row level security;
revoke all on public.staff_access from anon, authenticated;
-- Provision the two verified staff Auth user IDs through a trusted administrative
-- operation before applying this migration. Personal email addresses are not
-- authorization constants in application source.

do $$ begin
  if (select count(*) from public.staff_access) <> 2 then
    raise exception 'Expected exactly two verified staff accounts. Review staff_access before changing RLS.';
  end if;
end $$;

create or replace function public.is_sakan_staff() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_access s where s.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_sakan_staff() from public, anon;
grant execute on function public.is_sakan_staff() to authenticated;

do $$
declare t text; p record;
begin
  foreach t in array array['properties','rooms','people','charges','payments','expenses','maintenance','audit'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    if t = 'audit' then
      execute format('create policy staff_read on public.%I for select to authenticated using ((select public.is_sakan_staff()))', t);
    else
      execute format('create policy staff_access on public.%I for all to authenticated using ((select public.is_sakan_staff())) with check ((select public.is_sakan_staff()))', t);
    end if;
  end loop;
end $$;
