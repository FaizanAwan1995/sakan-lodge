-- Capacity edits synchronise approved listings instead of withdrawing them.
create or replace function sakan_private.guard_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare free integer; suburb text;
begin
 if new.capacity<1 then raise exception 'Capacity must be positive'; end if;
 if new.property_id<>old.property_id then
  if exists(select 1 from public.people where room_id=new.id) or exists(select 1 from public.reservations where room_id=new.id) then raise exception 'A room with resident or reservation history cannot move property'; end if;
  update public.room_profiles set published=false,ready=false,approved_by=null,approved_at=null,revision=revision+1 where room_id=new.id;
 end if;
 if new.capacity<>old.capacity then
  free:=sakan_private.free_spaces(new.id,(now() at time zone 'Australia/Adelaide')::date,'infinity'::date);
  if old.capacity-free>new.capacity then raise exception 'Capacity is below existing allocations'; end if;
  if exists(select 1 from public.reservations where room_id=new.id and status in ('held','confirmed') and departure_date>(now() at time zone 'Australia/Adelaide')::date) then
   raise exception 'Resolve future holds and confirmations before changing capacity';
  end if;
  -- Approved rooms remain approved; inventory and pricing read rooms.capacity.
  -- Keep manually hidden/not-ready profiles hidden and preserve custom content.
  select pp.suburb into suburb from public.property_profiles pp where pp.property_id=new.property_id;
  update public.room_profiles set
   offer_type=case when new.capacity=1 then 'private' else 'shared' end,
   title=regexp_replace(title, ' · (Private|Shared) Room$', case when new.capacity=1 then ' · Private Room' else ' · Shared Room' end),
   description=case
    when description = case when old.capacity=1
     then 'Private room for one person in '||suburb||'. Long-term rent is $255 per week; short-term rent is $300 per week.'
     else 'Shared room in '||suburb||' with capacity for '||old.capacity||' people. Rent is $185 per person per week, long-term only.' end
     ||' Exactly two calendar months qualifies as long-term. Electricity, water, gas and internet are included without additional charges.'
    then case when new.capacity=1
     then 'Private room for one person in '||suburb||'. Long-term rent is $255 per week; short-term rent is $300 per week.'
     else 'Shared room in '||suburb||' with capacity for '||new.capacity||' people. Rent is $185 per person per week, long-term only.' end
     ||' Exactly two calendar months qualifies as long-term. Electricity, water, gas and internet are included without additional charges.'
    else description end,
   revision=revision+1 where room_id=new.id;
 end if;
 return new;
end $$;

revoke all on function sakan_private.guard_capacity() from public,anon,authenticated,service_role;
