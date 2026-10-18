-- Additive migration: no existing resident, rate, payment or charge is rewritten.
-- All new privileged implementations live outside the exposed public schema.
begin;
create schema if not exists sakan_private;
revoke all on schema sakan_private from public;
grant usage on schema sakan_private to anon, authenticated, service_role;
alter default privileges in schema sakan_private revoke execute on functions from public;

create table public.booking_settings (
 id boolean primary key default true check (id), requests_enabled boolean not null default false
);
insert into public.booking_settings(id,requests_enabled) values(true,false);
alter table public.booking_settings enable row level security;
create policy staff_settings on public.booking_settings for all to authenticated using(public.is_sakan_staff()) with check(public.is_sakan_staff());
grant select,update on public.booking_settings to authenticated;

alter table public.reservations add column revision integer not null default 1,
 add column request_key uuid unique, add column hold_expires_at timestamptz,
 add column checked_in_person_id uuid references public.people(id);
alter table public.reservations add constraint reservation_status check(status in ('pending','review','held','confirmed','checked_in','cancelled','archived')),
 add constraint reservation_dates check(departure_date > arrival_date),
 add constraint reservation_spaces check(spaces_requested between 1 and 20);
alter table public.property_profiles add column approved_by uuid, add column approved_at timestamptz, add column revision integer not null default 1;
alter table public.room_profiles add column approved_by uuid, add column approved_at timestamptz, add column revision integer not null default 1;
alter table public.contracts add column signed_at timestamptz, add column signed_document_path text,
 add column reservation_revision integer, add column signed_by text;
alter table public.notification_outbox add column message_id text, add column updated_at timestamptz not null default now();
create index reservation_inventory on public.reservations(room_id,arrival_date,departure_date) where status in ('held','confirmed');
create index room_block_dates on public.room_blocks(room_id,starts_on,ends_on);
create index people_inventory on public.people(room_id,start_date,end_date);
create unique index property_public_path on public.property_profiles(lower(suburb),slug);
-- Room slugs unique within a property, checked with room lock and property lock in profile save.

create function sakan_private.require_staff() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_sakan_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
end $$;

-- Minimum free spaces across ALL nights of a requested [arrival,departure) interval.
-- Boundaries avoid under-selling sequential non-overlapping allocations.
create function sakan_private.free_spaces(p_room uuid,p_start date,p_end date,p_exclude_res uuid default null,p_exclude_person uuid default null,p_exclude_block uuid default null)
returns integer language sql volatile security definer set search_path='' as $$
 with allocations as (
  select p.start_date s,coalesce(p.end_date,'infinity'::date) e,1::bigint n from public.people p
   where p.room_id=p_room and p.id is distinct from p_exclude_person
  union all
  select r.arrival_date,coalesce(r.departure_date,'infinity'::date),r.spaces_requested from public.reservations r
   where r.room_id=p_room and r.id is distinct from p_exclude_res and
    (r.status='confirmed' or (r.status='held' and r.hold_expires_at>now()))
  union all
  select b.starts_on,b.ends_on,b.spaces from public.room_blocks b where b.room_id=p_room and b.id is distinct from p_exclude_block
 ), relevant as(select * from allocations where s<p_end and e>p_start),
 points as(select p_start d union select s from relevant where s>p_start and s<p_end),
 peak as(select coalesce(max((select coalesce(sum(n),0) from relevant where s<=points.d and e>points.d)),0) used from points)
 select (r.capacity-peak.used)::integer from public.rooms r cross join peak where r.id=p_room
$$;

create function sakan_private.guard_inventory() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid; oldrid uuid; s date; e date; n integer; free integer; cap integer; pid uuid;
begin
 rid:=new.room_id;
 if tg_op='UPDATE' then oldrid:=old.room_id; end if;
 -- Lock old and new inventory in stable order. These locks are shared by every writer.
 perform id from public.rooms where id in (rid,oldrid) order by id for update;
 if rid is null then
  if tg_table_name='reservations' then raise exception 'Room is required'; end if;
  return new;
 end if;
 select capacity,property_id into cap,pid from public.rooms where id=rid;
 if tg_table_name='people' then
  if tg_op='UPDATE' and (new.room_id,new.property_id,new.start_date,new.end_date) is not distinct from (old.room_id,old.property_id,old.start_date,old.end_date) then return new; end if;
  s:=new.start_date; e:=coalesce(new.end_date,'infinity'::date); n:=1;
  if new.property_id<>pid then raise exception 'Room does not belong to property'; end if;
  free:=sakan_private.free_spaces(rid,s,e,null,new.id);
 elsif tg_table_name='room_blocks' then
  s:=new.starts_on; e:=new.ends_on; n:=new.spaces;
  free:=sakan_private.free_spaces(rid,s,e,null,null,new.id);
 else
  s:=new.arrival_date; e:=new.departure_date; n:=new.spaces_requested;
  if new.property_id<>pid then raise exception 'Room does not belong to property'; end if;
  if e is null or e<=s or n not between 1 and cap then raise exception 'Invalid reservation dates or spaces'; end if;
  new.offer_type:=case when cap=1 then 'private' else 'shared' end;
  new.stay_type:=case when e < (s+interval '2 months')::date then 'short' else 'long' end;
  if cap>1 and new.stay_type='short' then raise exception 'Shared rooms require at least two calendar months'; end if;
  new.weekly_rate:=case when cap>1 then 185 when new.stay_type='short' then 300 else 255 end;
  if new.status not in ('held','confirmed') then return new; end if;
  if new.status='held' and (new.hold_expires_at is null or new.hold_expires_at<=now()) then raise exception 'Hold expiry must be in the future'; end if;
  free:=sakan_private.free_spaces(rid,s,e,new.id);
 end if;
 if s is null or e<=s or n<1 or n>cap then raise exception 'Invalid allocation'; end if;
 if free<n then raise exception 'Room has insufficient availability' using errcode='23P01'; end if;
 return new;
end $$;
create trigger reservation_inventory before insert or update on public.reservations for each row execute function sakan_private.guard_inventory();
create trigger resident_inventory before insert or update on public.people for each row execute function sakan_private.guard_inventory();
create trigger audit_room_blocks after insert or update or delete on public.room_blocks for each row execute function public.log_change();
create trigger block_inventory before insert or update on public.room_blocks for each row execute function sakan_private.guard_inventory();

create function sakan_private.guard_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare free integer;
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
  -- Capacity changes always withdraw approval; no stale private/shared advertisement.
  update public.room_profiles set published=false,ready=false,offer_type=case when new.capacity=1 then 'private' else 'shared' end,approved_by=null,approved_at=null,revision=revision+1 where room_id=new.id;
 end if;
 return new;
end $$;
create trigger room_capacity_guard before update of capacity,property_id on public.rooms for each row execute function sakan_private.guard_capacity();

create function sakan_private.catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('properties',coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.property_id,'slug',p.slug,'name',p.public_name,'suburb',p.suburb,'description',p.description,'photos',p.photos,'amenities',p.amenities
 ) order by p.suburb,p.slug) from public.property_profiles p where p.published and p.approved_at is not null),'[]'::jsonb),
 'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'property_id',r.property_id,'slug',rp.slug,'title',rp.title,'description',rp.description,'photos',rp.photos,'amenities',rp.amenities,'capacity',r.capacity,'offer_type',case when r.capacity=1 then 'private' else 'shared' end,'ready',rp.ready)
 order by r.sort,rp.slug) from public.rooms r join public.room_profiles rp on rp.room_id=r.id join public.property_profiles pp on pp.property_id=r.property_id where rp.published and rp.approved_at is not null and pp.published and pp.approved_at is not null),'[]'::jsonb));
$$;
create function public.public_catalog() returns jsonb language sql security invoker set search_path='' as $$select sakan_private.catalog()$$;
revoke all on function sakan_private.catalog(),public.public_catalog() from public;
grant execute on function sakan_private.catalog(),public.public_catalog() to anon,authenticated,service_role;

create function sakan_private.availability(p_room uuid,p_arrival date,p_departure date) returns jsonb language plpgsql security definer set search_path='' as $$
declare cap integer; free integer; ready boolean; short boolean;
begin
 if p_arrival is null or p_departure is null or p_departure<=p_arrival then raise exception 'Invalid stay dates'; end if;
 select r.capacity,rp.ready into cap,ready from public.rooms r join public.room_profiles rp on rp.room_id=r.id join public.property_profiles pp on pp.property_id=r.property_id
 where r.id=p_room and rp.published and rp.approved_at is not null and pp.published and pp.approved_at is not null;
 if not found then raise exception 'Listing unavailable' using errcode='P0002'; end if;
 short:=p_departure<(p_arrival+interval '2 months')::date;
 if cap>1 and short then raise exception 'Shared rooms require at least two calendar months'; end if;
 free:=case when ready then greatest(0,sakan_private.free_spaces(p_room,p_arrival,p_departure)) else 0 end;
 return jsonb_build_object('spaces',free,'offer_type',case when cap=1 then 'private' else 'shared' end,'stay_type',case when short then 'short' else 'long' end,'weekly_rate',case when cap>1 then 185 when short then 300 else 255 end,'requests_enabled',(select requests_enabled from public.booking_settings where id));
end $$;
create function public.room_availability(p_room uuid,p_arrival date,p_departure date) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.availability(p_room,p_arrival,p_departure)$$;
revoke all on function sakan_private.availability(uuid,date,date),public.room_availability(uuid,date,date) from public;
grant execute on function sakan_private.availability(uuid,date,date),public.room_availability(uuid,date,date) to anon,authenticated,service_role;

-- Resolve recipients from the trusted staff allowlist; personal addresses are not source constants.
create function sakan_private.staff_emails() returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(lower(u.email) order by u.id),'{}'::text[]) from public.staff_access s join auth.users u on u.id=s.user_id where u.email_confirmed_at is not null;
$$;
create function sakan_private.staff_contacts() returns jsonb language plpgsql security definer set search_path='' as $$
begin perform sakan_private.require_staff(); return to_jsonb(sakan_private.staff_emails()); end $$;
create function public.staff_notification_emails() returns jsonb language sql security invoker set search_path='' as $$select sakan_private.staff_contacts()$$;
revoke all on function public.staff_notification_emails(),sakan_private.staff_contacts() from public;
grant execute on function public.staff_notification_emails(),sakan_private.staff_contacts() to authenticated;

create function sakan_private.queue_drafts(p_res public.reservations,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare recipient text; subj text; msg text;
begin
 update public.notification_outbox set status='superseded',updated_at=now() where reservation_id=p_res.id and status='pending';
 subj:='SAKAN Lodge '||p_res.reservation_code||' — '||p_action;
 msg:='Hello '||p_res.full_name||E',\n\nReservation reference: '||p_res.reservation_code||E'\nDates: '||p_res.arrival_date||' to '||p_res.departure_date||E'\nStatus: '||p_res.status||E'\nWeekly rate: AUD '||p_res.weekly_rate||case when p_res.offer_type='shared' then ' per person' else '' end||E'\nElectricity, water, gas and internet are included without additional charges.\n\n'||case when p_res.status in ('pending','review') then 'This request is not a confirmed booking and does not hold a space.' when p_res.status='held' then 'A temporary hold applies until '||p_res.hold_expires_at||'. This is not a confirmed booking.' else 'Please contact our team with any questions.' end||E'\n\nSAKAN Lodge';
 foreach recipient in array array[p_res.email]||sakan_private.staff_emails() loop
  insert into public.notification_outbox(reservation_id,recipient,kind,payload) values(p_res.id,recipient,p_action,jsonb_build_object('subject',subj,'body',msg,'revision',p_res.revision));
 end loop;
end $$;

create function sakan_private.submit_request(p_data jsonb,p_key uuid,p_internal boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations; room public.rooms; quote jsonb;
begin
 -- Only the trusted Worker can invoke this (service_role); DB gate also defaults OFF.
 if p_internal then perform sakan_private.require_staff();
 elsif not (select requests_enabled from public.booking_settings where id) then raise exception 'Online requests are not active'; end if;
 if p_key is null then raise exception 'Request identifier required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into r from public.reservations where request_key=p_key;
 if found then
  if (r.room_id::text,r.email,r.arrival_date::text,r.departure_date::text,r.full_name,r.phone,r.spaces_requested::text) is distinct from
   (p_data->>'room_id',lower(trim(p_data->>'email')),p_data->>'arrival_date',p_data->>'departure_date',trim(p_data->>'full_name'),trim(p_data->>'phone'),coalesce(p_data->>'spaces_requested','1')) then raise exception 'Request identifier already used'; end if;
  return jsonb_build_object('code',r.reservation_code,'status',r.status);
 end if;
 if length(trim(p_data->>'full_name')) not between 2 and 120 or coalesce(p_data->>'email','') !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' or length(p_data->>'email')>254 or length(trim(p_data->>'phone')) not between 6 and 30 or length(coalesce(p_data->>'introduction',''))>2000 then raise exception 'Invalid contact details'; end if;
 if (p_data->>'arrival_date')::date<(now() at time zone 'Australia/Adelaide')::date then raise exception 'Arrival cannot be in the past'; end if;
 select * into room from public.rooms where id=(p_data->>'room_id')::uuid for update;
 if not found then raise exception 'Room not found'; end if;
 if p_internal then quote:=jsonb_build_object('spaces',sakan_private.free_spaces(room.id,(p_data->>'arrival_date')::date,(p_data->>'departure_date')::date));
 else quote:=sakan_private.availability(room.id,(p_data->>'arrival_date')::date,(p_data->>'departure_date')::date); end if;
 if (quote->>'spaces')::integer<coalesce((p_data->>'spaces_requested')::integer,1) then raise exception 'Room has insufficient availability' using errcode='23P01'; end if;
 insert into public.reservations(reservation_code,request_key,property_id,room_id,full_name,email,phone,arrival_date,departure_date,spaces_requested,occupation_type,introduction)
 values('SK-'||upper(replace(gen_random_uuid()::text,'-','')),p_key,room.property_id,room.id,trim(p_data->>'full_name'),lower(trim(p_data->>'email')),trim(p_data->>'phone'),(p_data->>'arrival_date')::date,(p_data->>'departure_date')::date,coalesce((p_data->>'spaces_requested')::integer,1),left(p_data->>'occupation_type',80),coalesce(p_data->>'introduction','')) returning * into r;
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'requested',case when p_internal then auth.uid()::text else 'website' end,jsonb_build_object('revision',r.revision));
 perform sakan_private.queue_drafts(r,'request received');
 return jsonb_build_object('code',r.reservation_code,'status',r.status);
end $$;
create function public.submit_reservation(p_data jsonb,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.submit_request(p_data,p_key,false)$$;
revoke all on function sakan_private.submit_request(jsonb,uuid,boolean),public.submit_reservation(jsonb,uuid) from public,anon,authenticated;
grant execute on function sakan_private.submit_request(jsonb,uuid,boolean),public.submit_reservation(jsonb,uuid) to service_role;


create function sakan_private.staff_request(p_data jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform sakan_private.require_staff(); return sakan_private.submit_request(p_data,p_key,true); end $$;
create function public.create_staff_reservation(p_data jsonb,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.staff_request(p_data,p_key)$$;
revoke all on function sakan_private.staff_request(jsonb,uuid),public.create_staff_reservation(jsonb,uuid) from public;
grant execute on function sakan_private.staff_request(jsonb,uuid),public.create_staff_reservation(jsonb,uuid) to authenticated;

create function sakan_private.manage_reservation(p_id uuid,p_revision integer,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations; previous text; person uuid; first_person uuid; member jsonb; members jsonb; person_ids jsonb:='[]'; cap integer; signed_fields jsonb; nightly numeric;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_id for update;
 if not found then raise exception 'Reservation not found'; end if;
 if r.revision<>p_revision then raise exception 'Reservation changed. Refresh before saving' using errcode='40001'; end if;
 if exists(select 1 from public.notification_outbox where reservation_id=r.id and status='sending') then raise exception 'A message is being sent. Reconcile its outcome before modifying the reservation'; end if;
 previous:=r.status;
 if p_action='edit' then
  if r.status in ('cancelled','archived','checked_in') then raise exception 'This reservation cannot be edited'; end if;
  r.room_id:=coalesce((p_data->>'room_id')::uuid,r.room_id);
  select property_id into r.property_id from public.rooms where id=r.room_id;
  r.arrival_date:=coalesce((p_data->>'arrival_date')::date,r.arrival_date); r.departure_date:=coalesce((p_data->>'departure_date')::date,r.departure_date);
  r.spaces_requested:=coalesce((p_data->>'spaces_requested')::integer,r.spaces_requested);
  r.admin_notes:=left(coalesce(p_data->>'admin_notes',r.admin_notes),4000);
  -- Changes need fresh contract review and confirmation; previous allocation is released explicitly.
  r.status:='review'; r.confirmed_at:=null; r.hold_expires_at:=null;
  update public.contracts set status='superseded' where reservation_id=r.id and status in ('draft','approved','signed');
 elsif p_action='review' then
  if r.status<>'pending' then raise exception 'Only pending requests can enter review'; end if; r.status:='review';
 elsif p_action='hold' then
  if r.status not in ('pending','review','held') then raise exception 'This reservation cannot be held'; end if;
  r.status:='held'; r.hold_expires_at:=(p_data->>'expires_at')::timestamptz;
 elsif p_action='confirm' then
  if r.status not in ('pending','review','held') then raise exception 'This reservation cannot be confirmed'; end if;
  select capacity into cap from public.rooms where id=r.room_id for update;
  if r.offer_type is distinct from (case when cap=1 then 'private' else 'shared' end) or r.weekly_rate is distinct from
   (case when cap>1 then 185 when r.departure_date<(r.arrival_date+interval '2 months')::date then 300 else 255 end) then
   raise exception 'Room capacity changed. Edit the reservation and regenerate its agreement';
  end if;
  if not exists(select 1 from public.room_profiles where room_id=r.room_id and ready) then raise exception 'Room must be marked ready'; end if;
  if not exists(select 1 from public.contracts c where c.reservation_id=r.id and c.status='signed' and c.signed_at is not null and c.approved_at is not null and c.reservation_revision is not null
    and c.fields->>'room_id'=r.room_id::text and c.fields->>'arrival_date'=r.arrival_date::text and c.fields->>'departure_date'=r.departure_date::text and (c.fields->>'spaces_requested')::integer=r.spaces_requested and (c.fields->>'weekly_rate')::numeric=r.weekly_rate and c.fields->>'offer_type'=r.offer_type) then raise exception 'An approved, signed current agreement is required'; end if;
  if r.departure_date-r.arrival_date<7 and not exists(select 1 from public.contracts c where c.reservation_id=r.id and c.status='signed' and c.fields->>'billing_type'='nightly' and (c.fields->>'nightly_rate')::numeric>0 and (c.fields->>'nightly_rate')::numeric::text not in ('NaN','Infinity','-Infinity')) then raise exception 'An explicitly approved nightly rate is required before confirmation'; end if;
  r.status:='confirmed'; r.confirmed_at:=now(); r.hold_expires_at:=null;
 elsif p_action='cancel' then
  if r.status not in ('pending','review','held','confirmed') then raise exception 'This reservation cannot be cancelled'; end if;
  r.status:='cancelled'; r.cancelled_at:=now();r.hold_expires_at:=null;
 elsif p_action='archive' then
  if r.status<>'cancelled' then raise exception 'Cancel before archiving'; end if; r.status:='archived';
 elsif p_action='check_in' then
  if r.status<>'confirmed' or r.checked_in_person_id is not null then raise exception 'Only confirmed reservations can check in once'; end if;
  if r.arrival_date>(now() at time zone 'Australia/Adelaide')::date or r.departure_date<=(now() at time zone 'Australia/Adelaide')::date then raise exception 'Check-in date must be within the agreed stay'; end if;
  if p_data->>'bond' is null or (p_data->>'bond')::numeric<0 then raise exception 'Specify the agreed bond amount per resident'; end if;
  -- Reservation short/long is a pricing tier; the ledger uses long for fortnightly billing.
  -- Never derive an unapproved nightly rate by dividing the public weekly quote.
  select fields into signed_fields from public.contracts where reservation_id=r.id and status='signed' and approved_at is not null and signed_at is not null order by version desc limit 1;
  if signed_fields ? 'bond' and (p_data->>'bond')::numeric is distinct from (signed_fields->>'bond')::numeric then raise exception 'Bond must match the signed agreement'; end if;
  if r.departure_date-r.arrival_date<7 then
   nightly:=(signed_fields->>'nightly_rate')::numeric;
   if signed_fields->>'billing_type' is distinct from 'nightly' or nightly is null or nightly<=0 or nightly::text in ('NaN','Infinity','-Infinity') then raise exception 'An explicitly approved nightly rate is required before nightly check-in'; end if;
  end if;
  members:=coalesce(p_data->'residents',jsonb_build_array(jsonb_build_object('name',r.full_name,'email',r.email,'phone',r.phone)));
  if jsonb_typeof(members)<>'array' or jsonb_array_length(members)<>r.spaces_requested then raise exception 'Provide details for every resident'; end if;
  if signed_fields ? 'resident_names' and (select jsonb_agg(trim(value->>'name')) from jsonb_array_elements(members)) is distinct from signed_fields->'resident_names' then raise exception 'Resident names must match the signed agreement'; end if;
  -- Remove reservation allocation in this same transaction before inserting the resident.
  update public.reservations set status='checked_in' where id=r.id;
  for member in select value from jsonb_array_elements(members) loop
   if length(trim(coalesce(member->>'name','')))<2 then raise exception 'Every resident needs a name'; end if;
   insert into public.people(name,email,phone,property_id,room_id,stay_type,weekly_rate,nightly_rate,start_date,end_date,bond)
   values(trim(member->>'name'),member->>'email',member->>'phone',r.property_id,r.room_id,case when nightly is null then 'long' else 'short' end,r.weekly_rate,nightly,r.arrival_date,r.departure_date,(p_data->>'bond')::numeric) returning id into person;
   first_person:=coalesce(first_person,person);
   person_ids:=person_ids||jsonb_build_array(person);
  end loop;
  r.status:='checked_in';r.checked_in_person_id:=first_person;
 else raise exception 'Unknown reservation action'; end if;
 update public.reservations set room_id=r.room_id,property_id=r.property_id,arrival_date=r.arrival_date,departure_date=r.departure_date,spaces_requested=r.spaces_requested,admin_notes=r.admin_notes,status=r.status,hold_expires_at=r.hold_expires_at,confirmed_at=r.confirmed_at,cancelled_at=r.cancelled_at,checked_in_person_id=r.checked_in_person_id,revision=revision+1,updated_at=now() where id=r.id returning * into r;
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,p_action,auth.uid()::text,jsonb_build_object('from',previous,'to',r.status,'revision',r.revision,'people',person_ids));
 perform sakan_private.queue_drafts(r,p_action);
 return to_jsonb(r);
end $$;
create function public.manage_reservation(p_id uuid,p_revision integer,p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select sakan_private.manage_reservation(p_id,p_revision,p_action,p_data)$$;
revoke all on function sakan_private.manage_reservation(uuid,integer,text,jsonb),public.manage_reservation(uuid,integer,text,jsonb) from public;
grant execute on function sakan_private.manage_reservation(uuid,integer,text,jsonb),public.manage_reservation(uuid,integer,text,jsonb) to authenticated;

create function sakan_private.save_listing(p_kind text,p_id uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare approved boolean:=coalesce((p_data->>'published')::boolean,false); parent uuid; cap integer; photo jsonb; current_revision integer;
begin
 perform sakan_private.require_staff();
 if coalesce(p_data->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_data->>'slug')>90 then raise exception 'Use a lowercase URL slug'; end if;
 if length(coalesce(p_data->>'description',''))>6000 then raise exception 'Description too long'; end if;
 if jsonb_typeof(coalesce(p_data->'photos','[]'))<>'array' or jsonb_array_length(coalesce(p_data->'photos','[]'))>20 or jsonb_typeof(coalesce(p_data->'amenities','[]'))<>'array' then raise exception 'Invalid photos or amenities'; end if;
 for photo in select value from jsonb_array_elements(coalesce(p_data->'photos','[]')) loop
  if jsonb_typeof(photo)<>'string' or (photo#>>'{}') !~ '^https://[^[:space:]<>]+$' then raise exception 'Photo URLs must use HTTPS'; end if;
 end loop;
 if p_kind='property' then
  perform id from public.properties where id=p_id for update;
  if not found then raise exception 'Property not found'; end if;
  select revision into current_revision from public.property_profiles where property_id=p_id;
  if found and (p_data->>'revision')::integer is distinct from current_revision then raise exception 'Listing changed. Reload before approving' using errcode='40001'; end if;
  if p_data->>'suburb' not in ('Fulham','Clapham','Oaklands Park') then raise exception 'Unsupported public suburb'; end if;
  if approved and (length(trim(coalesce(p_data->>'public_name','')))<3 or length(trim(coalesce(p_data->>'description','')))<20) then raise exception 'Verify public name and description before publishing'; end if;
  insert into public.property_profiles(property_id,slug,public_name,suburb,description,photos,amenities,published,approved_by,approved_at)
  values(p_id,p_data->>'slug',p_data->>'public_name',p_data->>'suburb',p_data->>'description',coalesce(p_data->'photos','[]'),coalesce(p_data->'amenities','[]'),approved,case when approved then auth.uid() end,case when approved then now() end)
  on conflict(property_id) do update set slug=excluded.slug,public_name=excluded.public_name,suburb=excluded.suburb,description=excluded.description,photos=excluded.photos,amenities=excluded.amenities,published=excluded.published,approved_by=excluded.approved_by,approved_at=excluded.approved_at,revision=property_profiles.revision+1;
 elsif p_kind='room' then
  select property_id,capacity into parent,cap from public.rooms where id=p_id;
  perform id from public.properties where id=parent for update;
  perform id from public.rooms where id=p_id for update;
  if cap is null then raise exception 'Room not found'; end if;
  select revision into current_revision from public.room_profiles where room_id=p_id;
  if found and (p_data->>'revision')::integer is distinct from current_revision then raise exception 'Listing changed. Reload before approving' using errcode='40001'; end if;
  if exists(select 1 from public.room_profiles rp join public.rooms r on r.id=rp.room_id where r.property_id=parent and rp.room_id<>p_id and rp.slug=p_data->>'slug') then raise exception 'Room slug already used at this property'; end if;
  if approved and (length(trim(coalesce(p_data->>'title','')))<3 or length(trim(coalesce(p_data->>'description','')))<20 or jsonb_array_length(coalesce(p_data->'photos','[]'))=0) then raise exception 'Verify room title, description and photos before publishing'; end if;
  insert into public.room_profiles(room_id,slug,title,description,photos,amenities,offer_type,ready,published,approved_by,approved_at)
  values(p_id,p_data->>'slug',p_data->>'title',p_data->>'description',coalesce(p_data->'photos','[]'),coalesce(p_data->'amenities','[]'),case when cap=1 then 'private' else 'shared' end,coalesce((p_data->>'ready')::boolean,false),approved,case when approved then auth.uid() end,case when approved then now() end)
  on conflict(room_id) do update set slug=excluded.slug,title=excluded.title,description=excluded.description,photos=excluded.photos,amenities=excluded.amenities,offer_type=excluded.offer_type,ready=excluded.ready,published=excluded.published,approved_by=excluded.approved_by,approved_at=excluded.approved_at,revision=room_profiles.revision+1;
 else raise exception 'Unknown listing type'; end if;
 insert into public.audit("by",action) values(auth.uid()::text,case when approved then 'approved public ' else 'saved draft ' end||p_kind||' profile '||p_id);
end $$;
create function public.save_listing(p_kind text,p_id uuid,p_data jsonb) returns void language sql security invoker set search_path='' as $$select sakan_private.save_listing(p_kind,p_id,p_data)$$;
revoke all on function sakan_private.save_listing(text,uuid,jsonb),public.save_listing(text,uuid,jsonb) from public;
grant execute on function sakan_private.save_listing(text,uuid,jsonb),public.save_listing(text,uuid,jsonb) to authenticated;

create function sakan_private.manage_contract(p_res uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations; c public.contracts;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_res for update;
 if not found or r.status in ('cancelled','archived','checked_in') then raise exception 'Reservation cannot receive a contract'; end if;
 if p_action='draft' then
  if r.status='confirmed' then raise exception 'Modify reservation into review before replacing a confirmed contract'; end if;
  if length(trim(coalesce(p_data->>'terms','')))<40 or length(p_data->>'terms')>30000 then raise exception 'Paste the approved agreement terms (40–30000 characters)'; end if;
  update public.contracts set status='superseded' where reservation_id=p_res and status in ('draft','approved','signed');
  insert into public.contracts(reservation_id,version,reservation_revision,fields)
  values(p_res,coalesce((select max(version)+1 from public.contracts where reservation_id=p_res),1),r.revision,
   jsonb_build_object('terms',p_data->>'terms','template_reference',p_data->>'template_reference','full_name',r.full_name,'room_id',r.room_id,'arrival_date',r.arrival_date,'departure_date',r.departure_date,'weekly_rate',r.weekly_rate,'offer_type',r.offer_type,'spaces_requested',r.spaces_requested,'utilities','Electricity, water, gas and internet included without additional charges')) returning * into c;
 else
  select * into c from public.contracts where id=(p_data->>'id')::uuid and reservation_id=p_res for update;
  if not found then raise exception 'Contract not found'; end if;
  if p_action='approve' and c.status='draft' then
   update public.contracts set status='approved',approved_by=auth.uid()::text,approved_at=now() where id=c.id returning * into c;
  elsif p_action='signed' and c.status='approved' then
   if coalesce((p_data->>'signature_verified')::boolean,false) is not true then raise exception 'Verify all required signatures before recording receipt'; end if;
   if length(trim(coalesce(p_data->>'signed_by','')))<2 or coalesce(p_data->>'signed_document_path','') !~ '^contracts/[a-zA-Z0-9/_\.-]+$' or p_data->>'signed_document_path' like '%..%' then raise exception 'Signer and private contracts/ document path required'; end if;
   if not exists(select 1 from storage.objects where bucket_id='reservation-contracts' and name=p_data->>'signed_document_path') then raise exception 'Upload the signed PDF to private contract storage first'; end if;
   update public.contracts set status='signed',signed_at=now(),signed_by=p_data->>'signed_by',signed_document_path=p_data->>'signed_document_path' where id=c.id returning * into c;
  else raise exception 'Invalid contract transition'; end if;
 end if;
 insert into public.reservation_events(reservation_id,action,actor,details) values(p_res,'contract_'||p_action,auth.uid()::text,jsonb_build_object('contract',c.id,'version',c.version));
 return to_jsonb(c);
end $$;
create function public.manage_contract(p_res uuid,p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.manage_contract(p_res,p_action,p_data)$$;
revoke all on function sakan_private.manage_contract(uuid,text,jsonb),public.manage_contract(uuid,text,jsonb) from public;
grant execute on function sakan_private.manage_contract(uuid,text,jsonb),public.manage_contract(uuid,text,jsonb) to authenticated;

create function sakan_private.notification_action(p_id uuid,p_action text,p_message text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.notification_outbox;
begin
 perform sakan_private.require_staff();
 select * into n from public.notification_outbox where id=p_id;
 perform id from public.reservations where id=n.reservation_id for update;
 select * into n from public.notification_outbox where id=p_id for update;
 if not found then raise exception 'Notification not found'; end if;
 if p_action='claim' and n.status='pending' then
  if exists(select 1 from public.reservations where id=n.reservation_id and revision<>(n.payload->>'revision')::integer) then raise exception 'Notification is outdated. Refresh the reservation'; end if;
  update public.notification_outbox set status='sending',attempts=attempts+1,updated_at=now() where id=p_id returning * into n;
 elsif p_action='sent' and n.status='sending' and p_message is not null then
  update public.notification_outbox set status='sent',message_id=p_message,sent_at=now(),updated_at=now() where id=p_id returning * into n;
 elsif p_action='reconcile_sent' and n.status in ('sending','uncertain') and p_message ~ '^[A-Za-z0-9_-]{5,128}$' then
  update public.notification_outbox set status='sent',message_id=p_message,sent_at=now(),updated_at=now(),last_error=null where id=p_id returning * into n;
 elsif p_action='requeue' and (n.status='uncertain' or (n.status='sending' and n.updated_at<now()-interval '15 minutes')) and p_message='CHECKED_SENT_MAIL_NOT_SENT' then
  update public.notification_outbox set status='pending',updated_at=now(),last_error=null where id=p_id returning * into n;
 elsif p_action='uncertain' and n.status='sending' then
  update public.notification_outbox set status='uncertain',last_error='Check Gmail Sent Mail before any further action',updated_at=now() where id=p_id returning * into n;
 else raise exception 'Notification already handled; refresh and check Sent Mail'; end if;
 if n.reservation_id is not null then insert into public.reservation_events(reservation_id,action,actor,details) values(n.reservation_id,'notification_'||p_action,auth.uid()::text,jsonb_build_object('notification',n.id,'status',n.status)); end if;
 return to_jsonb(n);
end $$;
create function public.notification_action(p_id uuid,p_action text,p_message text default null) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.notification_action(p_id,p_action,p_message)$$;
revoke all on function sakan_private.notification_action(uuid,text,text),public.notification_action(uuid,text,text) from public;
grant execute on function sakan_private.notification_action(uuid,text,text),public.notification_action(uuid,text,text) to authenticated;

-- Signed agreements stay in a private bucket; no public document URLs.
do $$begin if exists(select 1 from storage.buckets where id='reservation-contracts' and public) then raise exception 'Contract storage must be private'; end if; end$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('reservation-contracts','reservation-contracts',false,10485760,array['application/pdf']) on conflict(id) do nothing;
create policy sakan_contract_read on storage.objects for select to authenticated using(bucket_id='reservation-contracts' and public.is_sakan_staff());
create policy sakan_contract_upload on storage.objects for insert to authenticated with check(bucket_id='reservation-contracts' and public.is_sakan_staff() and name like 'contracts/%');

-- New tables are read-only from browsers; every workflow mutation uses guarded RPCs.
revoke insert,update,delete on public.reservations,public.contracts,public.reservation_events,public.notification_outbox,public.property_profiles,public.room_profiles from anon,authenticated;
grant select on public.reservations,public.contracts,public.reservation_events,public.notification_outbox,public.property_profiles,public.room_profiles,public.room_blocks to authenticated;
revoke all on all functions in schema sakan_private from public;

grant insert,delete on public.room_blocks to authenticated;
create function sakan_private.no_new_utility_charges() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind='electricity' then
  if tg_op='INSERT' then raise exception 'Utilities are included; new resident electricity charges are disabled'; end if;
  if old.kind<>'electricity' or new.amount>old.amount then raise exception 'Utilities are included; resident electricity charges cannot increase'; end if;
 end if;
 return new;
end $$;
create trigger included_utilities before insert or update on public.charges for each row execute function sakan_private.no_new_utility_charges();

-- Retain historic electricity charges; reject ALL new excess allocations.
create or replace function public.post_electricity_bill(p_property_id uuid,p_bill_date date,p_q_start date,p_q_end date,p_amount numeric,p_shares jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if not public.is_sakan_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
 if p_q_start is null or p_q_end is null or p_q_start>p_q_end or p_bill_date is null or p_amount is null or p_amount<=0 then raise exception 'Invalid electricity bill'; end if;
 if jsonb_array_length(coalesce(p_shares,'[]'))>0 then raise exception 'Utilities are included; resident surcharges are disabled'; end if;
 insert into public.expenses(property_id,date,category,amount,note,paid_from,reimbursed) values(p_property_id,p_bill_date,'Electricity',p_amount,format('Quarter %s to %s; utilities included',p_q_start,p_q_end),'business',false);
end $$;
revoke all on function public.post_electricity_bill(uuid,date,date,date,numeric,jsonb) from public,anon;
grant execute on function public.post_electricity_bill(uuid,date,date,date,numeric,jsonb) to authenticated;
-- Realtime changes keep both staff sessions current. Anonymous users still have no table SELECT policy.
do $$declare t text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['reservations','reservation_events','room_blocks','contracts','notification_outbox','property_profiles','room_profiles'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
commit;
