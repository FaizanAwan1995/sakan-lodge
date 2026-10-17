-- Restrict all tenant, finance and audit tables to the two Sakan Lodge staff accounts.
-- IMPORTANT: Review against live Auth users before applying. This migration is not applied automatically.
-- A verified email alone is insufficient: authorization uses auth.uid() against an explicit allowlist.
create table if not exists public.staff_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.staff_access enable row level security;
revoke all on public.staff_access from anon, authenticated;
-- Seed from the intended existing staff identities. If either account is missing, verify
-- both user IDs in Supabase Auth before applying this migration.
insert into public.staff_access(user_id)
select id from auth.users
where lower(email) in ('faizanasif117@gmail.com', 'danish.mihm@gmail.com')
  and email_confirmed_at is not null
on conflict (user_id) do nothing;

do $ begin
  if (select count(*) from public.staff_access) <> 2 then
    raise exception 'Expected exactly two verified staff accounts. Review staff_access before changing RLS.';
  end if;
end $;

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
