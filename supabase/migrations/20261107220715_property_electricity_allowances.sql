-- Property-level billing caps and new agreement snapshots only.
-- Existing contracts (including signed documents) retain their original terms.
update public.properties
set electricity_cap = case lower(name) when 'clapham' then 800 else 1000 end
where lower(name) in ('fulham','clapham','oaklands park');

create or replace function sakan_private.snapshot_utility_policy()
returns trigger language plpgsql security definer set search_path='' as $$
declare suburb text; allowance integer; policy text;
begin
 select p.name,case lower(p.name) when 'clapham' then 800 when 'fulham' then 1000 when 'oaklands park' then 1000 end
 into suburb,allowance from public.reservations r join public.properties p on p.id=r.property_id where r.id=new.reservation_id;
 if allowance is not null then
  policy := 'Electricity at ' || suburb || ' is included up to $' || to_char(allowance,'FM9,999') || ' per property per three months. Water, gas and internet are included. Any electricity above the allowance is allocated under the agreed billing terms.';
  new.fields := new.fields || jsonb_build_object('utilities',policy,'utility_policy_version',lower(replace(suburb,' ','-')) || '-' || allowance || '-quarter-v1','terms',coalesce(new.fields->>'terms','') || E'\n\n' || suburb || ' utility allowance: ' || policy || ' This electricity allowance takes precedence over general bills-included wording.');
 end if;
 return new;
end $$;
revoke all on function sakan_private.snapshot_utility_policy() from public,anon,authenticated;
