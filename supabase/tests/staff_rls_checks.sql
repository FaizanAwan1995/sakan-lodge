-- Run AFTER the staff-access migration on a disposable/staging database.
-- These assertions are read-only and must not modify tenant data.
do $$
declare
  table_name text;
  policy_count integer;
  staff_count integer;
begin
  select count(*) into staff_count from public.staff_access;
  if staff_count <> 2 then
    raise exception 'Expected exactly two staff entries, got %', staff_count;
  end if;

  foreach table_name in array array['properties','rooms','people','charges','payments','expenses','maintenance','audit'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', table_name)::regclass) then
      raise exception 'RLS is disabled for %', table_name;
    end if;
    select count(*) into policy_count from pg_policies
    where schemaname = 'public' and tablename = table_name
      and (qual is null or qual not like '%is_sakan_staff%');
    if policy_count <> 0 then
      raise exception 'Unexpected permissive policy on %', table_name;
    end if;
  end loop;
end $$;
