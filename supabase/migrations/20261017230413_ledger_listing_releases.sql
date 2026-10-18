-- Public inventory is an explicit release of a checked-out ledger space.
-- Existing residents, agreed rates, financial records and signed agreements are unchanged.
begin;

create table public.room_listing_releases (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.rooms(id),
 checkout_person_id uuid not null references public.people(id),
 checkout_date date not null,
 released_by uuid not null,
 released_at timestamptz not null default now(),
 consumed_by_person_id uuid references public.people(id),
 consumed_at timestamptz,
 revoked_at timestamptz,
 revoked_by uuid
);
create index room_release_inventory on public.room_listing_releases(room_id)
 where consumed_at is null and revoked_at is null;
alter table public.room_listing_releases enable row level security;
revoke all on public.room_listing_releases from public,anon,authenticated,service_role;
grant select on public.room_listing_releases to authenticated;
create policy staff_release_read on public.room_listing_releases for select to authenticated using(public.is_sakan_staff());

create function sakan_private.released_count(p_room uuid) returns integer
 language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.room_listing_releases l join public.people p on p.id=l.checkout_person_id
 where l.room_id=p_room and l.revoked_at is null and l.consumed_at is null
 and p.room_id=l.room_id and p.end_date=l.checkout_date
 and l.checkout_date<=(now() at time zone 'Australia/Adelaide')::date
$$;

-- Holds/confirmations use released spaces until check-in consumes the release.
-- Physical inventory remains the final limit, including maintenance blocks.
create function sakan_private.released_spaces(p_room uuid,p_start date,p_end date) returns integer
 language sql volatile security definer set search_path='' as $$
 with allocations as (
  select arrival_date s,departure_date e,spaces_requested n from public.reservations
  where room_id=p_room and (status='confirmed' or (status='held' and hold_expires_at>now()))
  and arrival_date<p_end and departure_date>p_start
 ), points as(select p_start d union select s from allocations where s>p_start and s<p_end),
 peak as(select coalesce(max((select coalesce(sum(n),0) from allocations where s<=points.d and e>points.d)),0) used from points)
 select least(greatest(0,sakan_private.free_spaces(p_room,p_start,p_end)),
  greatest(0,sakan_private.released_count(p_room)-peak.used)::integer) from peak
$$;

create function sakan_private.release_listing(p_person uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare resident public.people; rid uuid; previous public.room_listing_releases; release_id uuid; today date:=(now() at time zone 'Australia/Adelaide')::date; vacancies integer;
begin
 perform sakan_private.require_staff();
 select room_id into rid from public.people where id=p_person;
 if rid is null then raise exception 'Checked-out resident must have a ledger room'; end if;
 perform id from public.rooms where id=rid for update;
 select * into resident from public.people where id=p_person;
 if resident.room_id is distinct from rid then raise exception 'Resident changed. Reload before releasing' using errcode='40001'; end if;
 if resident.end_date is null or resident.end_date>today then raise exception 'Record an actual checkout before releasing this space'; end if;
 select * into previous from public.room_listing_releases where checkout_person_id=p_person and checkout_date=resident.end_date and revoked_at is null order by released_at desc limit 1;
 if found then
  if previous.consumed_at is not null then raise exception 'This checkout space has already been used by a new resident'; end if;
  return jsonb_build_object('id',previous.id,'status','released_for_review');
 end if;
 if not exists(select 1 from public.room_profiles where room_id=rid) then raise exception 'Save a draft room profile before releasing this space'; end if;
 -- A release cannot create more public spaces than physically vacant beds.
 -- Reservation holds already belong to existing released inventory.
 select capacity-(select count(*) from public.people p where p.room_id=rid and p.start_date<=today and (p.end_date is null or p.end_date>today))
  into vacancies from public.rooms where id=rid;
 if vacancies<=sakan_private.released_count(rid) then raise exception 'No additional vacant ledger space to release' using errcode='23P01'; end if;
 insert into public.room_listing_releases(room_id,checkout_person_id,checkout_date,released_by)
 values(rid,p_person,resident.end_date,auth.uid()) returning id into release_id;
 -- Release is not publication: cleaning/readiness and fresh approval still follow.
 update public.room_profiles set ready=false,published=false,approved_at=null,approved_by=null,revision=revision+1 where room_id=rid;
 insert into public.audit("by",action) values(auth.uid()::text,'released checked-out ledger space for listing review '||release_id);
 return jsonb_build_object('id',release_id,'status','released_for_review');
end $$;
create function public.release_room_listing(p_person uuid) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.release_listing(p_person)$$;
revoke all on function public.release_room_listing(uuid),sakan_private.release_listing(uuid) from public,anon,authenticated,service_role;
grant execute on function public.release_room_listing(uuid),sakan_private.release_listing(uuid) to authenticated;

create function sakan_private.withdraw_listing_release(p_release uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 perform sakan_private.require_staff();
 select room_id into rid from public.room_listing_releases where id=p_release;
 if rid is null then raise exception 'Release not found'; end if;
 perform id from public.rooms where id=rid for update;
 update public.room_listing_releases set revoked_at=now(),revoked_by=auth.uid() where id=p_release and revoked_at is null and consumed_at is null;
 if not found then raise exception 'Release was already withdrawn or used'; end if;
 insert into public.audit("by",action) values(auth.uid()::text,'withdrew public ledger release '||p_release);
end $$;
create function public.withdraw_room_listing_release(p_release uuid) returns void language sql security invoker set search_path='' as $$select sakan_private.withdraw_listing_release(p_release)$$;
revoke all on function public.withdraw_room_listing_release(uuid),sakan_private.withdraw_listing_release(uuid) from public,anon,authenticated,service_role;
grant execute on function public.withdraw_room_listing_release(uuid),sakan_private.withdraw_listing_release(uuid) to authenticated;

create function sakan_private.track_listing_release() returns trigger
 language plpgsql security definer set search_path='' as $$
declare release_id uuid; today date:=(now() at time zone 'Australia/Adelaide')::date;
begin
 if tg_op='UPDATE' then
  if (new.room_id,new.start_date,new.end_date) is distinct from (old.room_id,old.start_date,old.end_date) then
   update public.room_listing_releases set revoked_at=now(),revoked_by=auth.uid()
    where checkout_person_id=new.id and consumed_at is null and revoked_at is null;
  end if;
  -- Editing contact/rent data or a departure does not consume another release.
  if new.room_id is not distinct from old.room_id and not coalesce(old.end_date<=today and (new.end_date is null or new.end_date>today),false) then return new; end if;
 end if;
 if new.room_id is null or new.end_date<=today then return new; end if;
 select l.id into release_id from public.room_listing_releases l join public.people p on p.id=l.checkout_person_id
  where l.room_id=new.room_id and l.consumed_at is null and l.revoked_at is null and p.room_id=l.room_id and p.end_date=l.checkout_date and l.checkout_date<=today
  order by l.released_at,l.id limit 1 for update of l;
 if found then
  update public.room_listing_releases set consumed_by_person_id=new.id,consumed_at=now() where id=release_id;
 end if;
 return new;
end $$;
create trigger ledger_listing_release after insert or update on public.people for each row execute function sakan_private.track_listing_release();

create function sakan_private.revoke_reconfigured_releases() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if (new.capacity,new.property_id) is distinct from (old.capacity,old.property_id) then
  update public.room_listing_releases set revoked_at=now(),revoked_by=auth.uid() where room_id=new.id and consumed_at is null and revoked_at is null;
 end if;
 return new;
end $$;
create trigger reconfigured_listing_releases after update of capacity,property_id on public.rooms for each row execute function sakan_private.revoke_reconfigured_releases();

create function sakan_private.guard_released_publication() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if new.published and (not new.ready or sakan_private.released_count(new.room_id)=0) then
  raise exception 'Release a checked-out space from the ledger and verify readiness before approving publication';
 end if;
 return new;
end $$;
create trigger released_listing_approval before insert or update on public.room_profiles for each row execute function sakan_private.guard_released_publication();

create or replace function sakan_private.catalog() returns jsonb language sql stable security definer set search_path='' as $$
 with eligible as (
  select r.*,rp.slug,rp.title,rp.description,rp.photos,rp.amenities,rp.ready
  from public.rooms r join public.room_profiles rp on rp.room_id=r.id join public.property_profiles pp on pp.property_id=r.property_id
  where rp.published and rp.approved_at is not null and rp.ready and pp.published and pp.approved_at is not null
  and sakan_private.released_spaces(r.id,(now() at time zone 'Australia/Adelaide')::date,(now() at time zone 'Australia/Adelaide')::date+1)>0
 ) select jsonb_build_object('properties',coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.property_id,'slug',p.slug,'name',p.public_name,'suburb',p.suburb,'description',p.description,'photos',p.photos,'amenities',p.amenities
 ) order by p.suburb,p.slug) from public.property_profiles p where p.published and p.approved_at is not null and exists(select 1 from eligible e where e.property_id=p.property_id)),'[]'::jsonb),
 'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'property_id',r.property_id,'slug',r.slug,'title',r.title,'description',r.description,'photos',r.photos,'amenities',r.amenities,'capacity',r.capacity,'offer_type',case when r.capacity=1 then 'private' else 'shared' end,'ready',r.ready)
 order by r.sort,r.slug) from eligible r),'[]'::jsonb));
$$;

create or replace function sakan_private.availability(p_room uuid,p_arrival date,p_departure date) returns jsonb language plpgsql security definer set search_path='' as $$
declare cap integer; free integer; short boolean;
begin
 if p_arrival is null or p_departure is null or p_departure<=p_arrival then raise exception 'Invalid stay dates'; end if;
 select r.capacity into cap from public.rooms r join public.room_profiles rp on rp.room_id=r.id join public.property_profiles pp on pp.property_id=r.property_id
 where r.id=p_room and rp.published and rp.approved_at is not null and rp.ready and pp.published and pp.approved_at is not null
 and sakan_private.released_count(r.id)>0;
 if not found then raise exception 'Listing unavailable' using errcode='P0002'; end if;
 short:=p_departure<(p_arrival+interval '2 months')::date;
 if cap>1 and short then raise exception 'Shared rooms require at least two calendar months'; end if;
 free:=sakan_private.released_spaces(p_room,p_arrival,p_departure);
 return jsonb_build_object('spaces',free,'offer_type',case when cap=1 then 'private' else 'shared' end,'stay_type',case when short then 'short' else 'long' end,'weekly_rate',case when cap>1 then 185 when short then 300 else 255 end,'requests_enabled',(select requests_enabled from public.booking_settings where id));
end $$;

-- Triggers and internal helpers are not client-callable API endpoints.
revoke all on function sakan_private.released_count(uuid),sakan_private.released_spaces(uuid,date,date),sakan_private.track_listing_release(),sakan_private.revoke_reconfigured_releases(),sakan_private.guard_released_publication() from public,anon,authenticated,service_role;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.room_listing_releases;
 end if;
end$$;
commit;
