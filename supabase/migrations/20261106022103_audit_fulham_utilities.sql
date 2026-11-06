-- New agreement snapshots only: existing signed documents retain their terms.
update public.properties set electricity_cap=1000 where lower(name)='fulham';
create function sakan_private.snapshot_utility_policy() returns trigger language plpgsql security definer set search_path='' as $$
declare policy text;
begin
 if exists(select 1 from public.reservations r join public.properties p on p.id=r.property_id where r.id=new.reservation_id and lower(p.name)='fulham') then
  policy := 'Electricity at Fulham is included up to $1,000 per property per three months. Water, gas and internet are included. Any electricity above the allowance is allocated under the agreed billing terms.';
  new.fields := new.fields || jsonb_build_object('utilities',policy,'utility_policy_version','fulham-1000-quarter-v1','terms',coalesce(new.fields->>'terms','') || E'\n\nFulham utility allowance: ' || policy || ' This electricity allowance takes precedence over general bills-included wording.');
 end if;
 return new;
end $$;
revoke all on function sakan_private.snapshot_utility_policy() from public,anon,authenticated;
create trigger snapshot_utility_policy before insert on public.contracts for each row execute function sakan_private.snapshot_utility_policy();
