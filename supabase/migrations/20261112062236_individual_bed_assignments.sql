-- Named beds are additive; existing tenants and signed agreements are unchanged.
begin;
alter table public.people add column bed_number integer check(bed_number>0);
alter table public.reservations add column bed_numbers integer[];
create index people_named_bed_dates on public.people(room_id,bed_number,start_date,end_date) where bed_number is not null;

create function sakan_private.available_beds(p_room uuid,p_start date,p_end date,p_res uuid default null,p_person uuid default null)
returns integer[] language sql volatile security definer set search_path='' as $$
 select coalesce(array_agg(b order by b),'{}'::integer[]) from public.rooms room cross join lateral generate_series(1,room.capacity) b
 where room.id=p_room and not exists(
  select 1 from public.people p where p.room_id=p_room and p.id is distinct from p_person and p.bed_number=b
   and p.start_date<p_end and least(coalesce(p.end_date,'infinity'::date),coalesce((p.checked_out_at at time zone 'Australia/Adelaide')::date,'infinity'::date))>p_start
   and least(coalesce(p.end_date,'infinity'::date),coalesce((p.checked_out_at at time zone 'Australia/Adelaide')::date,'infinity'::date))>p.start_date
 ) and not exists(
  select 1 from public.reservations r where r.room_id=p_room and r.id is distinct from p_res and b=any(r.bed_numbers)
   and r.arrival_date<p_end and r.departure_date>p_start and (r.status='confirmed' or (r.status='held' and r.hold_expires_at>now()))
 );
$$;
revoke all on function sakan_private.available_beds(uuid,date,date,uuid,uuid) from public,anon,authenticated,service_role;

create function sakan_private.bed_reference(p_room uuid,p_beds integer[]) returns text
language sql stable security definer set search_path='' as $$
 select case when cardinality(p_beds)>0 then
  string_agg(case when trim(r.label) ~* '^room[[:space:]]*[0-9]+$' then 'R'||substring(r.label from '[0-9]+') else trim(r.label) end||'-B'||b,', ' order by ord)
 else max(r.label) end from public.rooms r left join lateral unnest(p_beds) with ordinality x(b,ord) on true where r.id=p_room;
$$;
revoke all on function sakan_private.bed_reference(uuid,integer[]) from public,anon,authenticated,service_role;

-- Every writer shares the room lock with the existing aggregate inventory guard.
create function sakan_private.guard_bed_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare cap integer; beds integer[]; available integer[]; s date; e date; n integer; exclude_res uuid; exclude_person uuid;
begin
 if new.room_id is null then
  if tg_table_name='people' then new.bed_number:=null; end if;
  return new;
 end if;
 if tg_op='UPDATE' then
  perform id from public.rooms where id in(new.room_id,old.room_id) order by id for update;
 else perform id from public.rooms where id=new.room_id for update; end if;
 select capacity into cap from public.rooms where id=new.room_id;
 if tg_table_name='people' then
  if tg_op='UPDATE' and (new.room_id,new.bed_number,new.start_date,new.end_date,new.checked_out_at) is not distinct from (old.room_id,old.bed_number,old.start_date,old.end_date,old.checked_out_at) then return new; end if;
  s:=new.start_date;e:=least(coalesce(new.end_date,'infinity'::date),coalesce((new.checked_out_at at time zone 'Australia/Adelaide')::date,'infinity'::date));n:=1;exclude_person:=new.id;
  if new.bed_number is not null and (new.bed_number<1 or new.bed_number>cap) then raise exception 'Choose one valid, different bed per resident'; end if;
  -- Historical checkout edits do not invent a physical bed assignment.
  if e<=s or e<=(now() at time zone 'Australia/Adelaide')::date then return new; end if;
  if new.bed_number is not null then beds:=array[new.bed_number]; end if;
 else
  s:=new.arrival_date;e:=new.departure_date;n:=new.spaces_requested;exclude_res:=new.id;beds:=new.bed_numbers;
  if new.status in('cancelled','archived','assigned','checked_in') then return new; end if;
 end if;
 if cap is null or s is null or e<=s or n<1 or n>cap then raise exception 'Invalid bed allocation'; end if;
 available:=sakan_private.available_beds(new.room_id,s,e,exclude_res,exclude_person);
 if cardinality(beds)>0 then
  if cardinality(beds)<>n or exists(select 1 from unnest(beds) b where b is null or b<1 or b>cap) or (select count(distinct b) from unnest(beds) b)<>n then raise exception 'Choose one valid, different bed per resident'; end if;
  if not beds <@ available then raise exception 'Selected bed is unavailable for these dates' using errcode='23P01'; end if;
 else
  beds:=available[1:n];
  if coalesce(cardinality(beds),0)<>n then raise exception 'No bed is available for the full stay' using errcode='23P01'; end if;
 end if;
 if tg_table_name='people' then new.bed_number:=beds[1];else new.bed_numbers:=beds;end if;
 return new;
end $$;
revoke all on function sakan_private.guard_bed_assignment() from public,anon,authenticated,service_role;
create trigger a_resident_named_bed before insert or update on public.people for each row execute function sakan_private.guard_bed_assignment();
create trigger a_reservation_named_beds before insert or update on public.reservations for each row execute function sakan_private.guard_bed_assignment();
CREATE OR REPLACE FUNCTION sakan_private.availability(p_room uuid, p_arrival date, p_departure date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cap integer; free integer; short boolean;
begin
 if p_arrival is null or p_departure is null or p_departure<=p_arrival then raise exception 'Invalid stay dates'; end if;
 select r.capacity into cap from public.rooms r join public.room_profiles rp on rp.room_id=r.id join public.property_profiles pp on pp.property_id=r.property_id
 where r.id=p_room and rp.published and rp.approved_at is not null and rp.ready and pp.published and pp.approved_at is not null;
 if not found then raise exception 'Listing unavailable' using errcode='P0002'; end if;
 short:=p_departure<(p_arrival+interval '2 months')::date;
 if cap>1 and short then raise exception 'Shared rooms require at least two calendar months'; end if;
 free:=sakan_private.free_spaces(p_room,p_arrival,p_departure);
 return jsonb_build_object('beds',to_jsonb(sakan_private.available_beds(p_room,p_arrival,p_departure)),'spaces',least(free,cardinality(sakan_private.available_beds(p_room,p_arrival,p_departure))),'offer_type',case when cap=1 then 'private' else 'shared' end,'stay_type',case when short then 'short' else 'long' end,'weekly_rate',case when cap>1 then 185 when short then 300 else 255 end,'requests_enabled',(select requests_enabled from public.booking_settings where id));
end $function$
;
CREATE OR REPLACE FUNCTION sakan_private.submit_request(p_data jsonb, p_key uuid, p_internal boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reservations; room public.rooms; quote jsonb;
begin
 -- Only the trusted Worker can invoke this (service_role); DB gate also defaults OFF.
 if p_internal then perform sakan_private.require_staff();
 elsif not (select requests_enabled from public.booking_settings where id) then raise exception 'Online requests are not active'; end if;
 if p_key is null then raise exception 'Request identifier required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into r from public.reservations where request_key=p_key;
 if found then
  if jsonb_typeof(p_data->'bed_numbers')='array' and jsonb_array_length(p_data->'bed_numbers')>0 and r.bed_numbers is distinct from array(select jsonb_array_elements_text(p_data->'bed_numbers')::integer) then raise exception 'Request identifier already used'; end if;
  if coalesce(p_data->>'bed_number','')<>'' and r.bed_numbers is distinct from array[(p_data->>'bed_number')::integer] then raise exception 'Request identifier already used'; end if;
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
 insert into public.reservations(reservation_code,request_key,property_id,room_id,full_name,email,phone,arrival_date,departure_date,spaces_requested,occupation_type,introduction,bed_numbers)
 values('SK-'||upper(replace(gen_random_uuid()::text,'-','')),p_key,room.property_id,room.id,trim(p_data->>'full_name'),lower(trim(p_data->>'email')),trim(p_data->>'phone'),(p_data->>'arrival_date')::date,(p_data->>'departure_date')::date,coalesce((p_data->>'spaces_requested')::integer,1),left(p_data->>'occupation_type',80),coalesce(p_data->>'introduction',''),case when coalesce(p_data->>'bed_number','')<>'' then array[(p_data->>'bed_number')::integer] when p_data ? 'bed_numbers' then array(select jsonb_array_elements_text(p_data->'bed_numbers')::integer) end) returning * into r;
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'requested',case when p_internal then auth.uid()::text else 'website' end,jsonb_build_object('revision',r.revision));
 perform sakan_private.queue_drafts(r,'request received');
 return jsonb_build_object('code',r.reservation_code,'status',r.status);
end $function$
;
CREATE OR REPLACE FUNCTION sakan_private.manage_reservation(p_id uuid, p_revision integer, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reservations; previous text; person uuid; first_person uuid; member jsonb; members jsonb; person_ids jsonb:='[]'; cap integer; signed_fields jsonb; nightly numeric;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_id for update;
 if not found then raise exception 'Reservation not found'; end if;
 if r.revision<>p_revision then raise exception 'Reservation changed. Refresh before saving' using errcode='40001'; end if;
 if exists(select 1 from public.notification_outbox where reservation_id=r.id and status='sending') then raise exception 'A message is being sent. Reconcile its outcome before modifying the reservation'; end if;
 if p_action='check_in' and r.status='assigned' then
  if r.arrival_date>(now() at time zone 'Australia/Adelaide')::date or r.departure_date<=(now() at time zone 'Australia/Adelaide')::date then raise exception 'Actual arrival must be within the agreed stay'; end if;
  update public.reservations set status='checked_in',revision=revision+1,updated_at=now() where id=r.id returning * into r;
  insert into public.reservation_events(reservation_id,action,actor) values(r.id,'actual_arrival',auth.uid()::text);
  return to_jsonb(r);
 end if;
 if p_action in ('review','hold','confirm','check_in') and exists(select 1 from public.contract_signing_requests where reservation_id=r.id and status in ('awaiting_signature','processing','signed')) then raise exception 'Use the online signing review panel before changing this reservation status';end if;
 if p_action='cancel' then
  if exists(select 1 from public.contract_signing_requests where reservation_id=r.id and status='signed' and (reviewed_at is null or reviewed_by is distinct from auth.uid())) then raise exception 'Use Reject request in the signing panel and provide a reason';end if;
  update public.contract_signing_requests set status='revoked',reviewed_at=now(),reviewed_by=auth.uid() where reservation_id=r.id and status in ('awaiting_signature','processing');
 end if;
 previous:=r.status;
 if p_action='edit' then
  if r.status in ('cancelled','archived','checked_in','assigned') then raise exception 'This reservation cannot be edited'; end if;
  r.room_id:=coalesce((p_data->>'room_id')::uuid,r.room_id);
  select property_id into r.property_id from public.rooms where id=r.room_id;
  r.arrival_date:=coalesce((p_data->>'arrival_date')::date,r.arrival_date); r.departure_date:=coalesce((p_data->>'departure_date')::date,r.departure_date);
  if p_data ? 'bed_numbers' then r.bed_numbers:=array(select jsonb_array_elements_text(p_data->'bed_numbers')::integer); elsif r.room_id is distinct from (select room_id from public.reservations where id=r.id) then r.bed_numbers:=null; end if;
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
  if r.bond_verified_at is null then raise exception 'Verify bond payment using final booking confirmation'; end if;
  if r.status not in ('pending','review','held') then raise exception 'This reservation cannot be confirmed'; end if;
  select capacity into cap from public.rooms where id=r.room_id for update;
  if r.offer_type is distinct from (case when cap=1 then 'private' else 'shared' end) or r.weekly_rate is distinct from
   coalesce(r.agreed_weekly_rate,(case when cap>1 then 185 when r.departure_date<(r.arrival_date+interval '2 months')::date then 300 else 255 end)) then
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
   insert into public.people(name,email,phone,property_id,room_id,stay_type,weekly_rate,nightly_rate,start_date,end_date,bond,bed_number)
   values(trim(member->>'name'),member->>'email',member->>'phone',r.property_id,r.room_id,case when nightly is null then 'long' else 'short' end,r.weekly_rate,nightly,r.arrival_date,r.departure_date,(p_data->>'bond')::numeric,r.bed_numbers[jsonb_array_length(person_ids)+1]) returning id into person;
   first_person:=coalesce(first_person,person);
   person_ids:=person_ids||jsonb_build_array(person);
  end loop;
  r.status:='checked_in';r.checked_in_person_id:=first_person;
 else raise exception 'Unknown reservation action'; end if;
 update public.reservations set room_id=r.room_id,property_id=r.property_id,arrival_date=r.arrival_date,departure_date=r.departure_date,spaces_requested=r.spaces_requested,bed_numbers=r.bed_numbers,admin_notes=r.admin_notes,status=r.status,hold_expires_at=r.hold_expires_at,confirmed_at=r.confirmed_at,cancelled_at=r.cancelled_at,checked_in_person_id=r.checked_in_person_id,revision=revision+1,updated_at=now() where id=r.id returning * into r;
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,p_action,auth.uid()::text,jsonb_build_object('from',previous,'to',r.status,'revision',r.revision,'people',person_ids));
 perform sakan_private.queue_drafts(r,p_action);
 return to_jsonb(r);
end $function$
;
CREATE OR REPLACE FUNCTION sakan_private.manual_booking(p_id uuid, p_revision integer, p_contract uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reservations; c public.contracts; cap integer; member text; person uuid; first_person uuid; members jsonb:='[]';
begin
 perform sakan_private.require_staff();
 if exists(select 1 from public.contract_signing_requests where contract_id=p_contract and status in ('awaiting_signature','processing','signed')) then raise exception 'Review and approve the online signature before allocating this room'; end if;
 select * into r from public.reservations where id=p_id for update;
 if not found or r.revision<>p_revision then raise exception 'Reservation changed. Reload before confirming' using errcode='40001'; end if;
 if r.status not in ('pending','review','held') or r.checked_in_person_id is not null then raise exception 'Reservation cannot be confirmed again'; end if;
 if exists(select 1 from public.notification_outbox where reservation_id=r.id and status='sending') then raise exception 'Reconcile the sending email first'; end if;
 select * into c from public.contracts where id=p_contract and reservation_id=r.id;
 if c.id is null or c.status not in ('draft','approved','signed') or c.document_path is null or c.reservation_revision<>r.revision then raise exception 'Generate the current contract PDF first'; end if;
 select capacity into cap from public.rooms where id=r.room_id for update;
 if r.offer_type is distinct from (case when cap=1 then 'private' else 'shared' end) or r.weekly_rate is distinct from coalesce(r.agreed_weekly_rate,(case when cap>1 then 185 when r.departure_date<(r.arrival_date+interval '2 months')::date then 300 else 255 end)) then raise exception 'Room capacity changed. Regenerate agreement'; end if;
 if not exists(select 1 from public.room_profiles where room_id=r.room_id and ready) then raise exception 'Room must be ready'; end if;
 if sakan_private.free_spaces(r.room_id,r.arrival_date,r.departure_date,r.id)<r.spaces_requested then raise exception 'Room is no longer available' using errcode='23P01'; end if;
 if c.fields ? 'bed_numbers' and c.fields->'bed_numbers' is distinct from to_jsonb(r.bed_numbers) then raise exception 'Bed assignment changed. Regenerate the agreement'; end if;
 if jsonb_array_length(c.fields->'resident_names') is distinct from r.spaces_requested then raise exception 'Contract must name every resident'; end if;
 if r.departure_date-r.arrival_date<7 and (c.fields->>'billing_type' is distinct from 'nightly' or coalesce((c.fields->>'nightly_rate')::numeric,0)<=0) then raise exception 'Explicit nightly rate required'; end if;
 update public.reservations set status='assigned',hold_expires_at=null where id=r.id;
 for member in select value from jsonb_array_elements_text(c.fields->'resident_names') loop
  insert into public.people(name,email,phone,property_id,room_id,stay_type,weekly_rate,nightly_rate,start_date,end_date,bond,bond_status,bed_number)
  values(member,r.email,r.phone,r.property_id,r.room_id,case when c.fields->>'billing_type'='nightly' then 'short' else 'long' end,r.weekly_rate,(c.fields->>'nightly_rate')::numeric,r.arrival_date,r.departure_date,(c.fields->>'bond')::numeric,'not_paid',r.bed_numbers[jsonb_array_length(members)+1]) returning id into person;
  members:=members||jsonb_build_array(person); first_person:=coalesce(first_person,person);
 end loop;
 update public.reservations set confirmed_at=now(),checked_in_person_id=first_person,assigned_people=members,revision=revision+1,updated_at=now() where id=r.id returning * into r;
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'manually_confirmed_and_assigned',auth.uid()::text,jsonb_build_object('people',members,'contract_id',c.id,'payments_recorded',false));
 return to_jsonb(r);
end $function$
;
CREATE OR REPLACE FUNCTION sakan_private.create_template_contract(p_res uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reservations; t public.agreement_templates; c public.contracts; names jsonb; rate numeric; bond numeric;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_res for update;
 if not found then raise exception 'Reservation not found'; end if;
 if (p_data->>'revision')::integer is distinct from r.revision then raise exception 'Reservation changed. Refresh before drafting' using errcode='40001'; end if;
 select * into t from public.agreement_templates where id=(p_data->>'template_id')::uuid;
 if not found then raise exception 'Approved private template required'; end if;
 names:=p_data->'resident_names';
 if jsonb_typeof(names) is distinct from 'array' then raise exception 'List every resident'; end if;
 if jsonb_array_length(names)<>r.spaces_requested or exists(select 1 from jsonb_array_elements_text(names) n where length(trim(n))<2) then raise exception 'List every resident'; end if;
 if length(trim(coalesce(p_data->>'premises_address','')))<5 or length(trim(coalesce(p_data->>'term_description','')))<3 then raise exception 'Verified premises and explicit agreement term required'; end if;
 if (p_data->>'first_rent_due')::date is null then raise exception 'First rent due date required'; end if;
 if (p_data->>'first_rent_due')::date >= r.departure_date then raise exception 'First rent due must be before departure'; end if;
 if (p_data->>'first_rent_due')::date not between date '2000-01-01' and date '2100-12-31' then raise exception 'First rent due date is outside the supported range'; end if;
 bond:=(p_data->>'bond')::numeric;
 if bond is null or bond<0 or bond::text in ('NaN','Infinity','-Infinity') or round(bond,2)<>bond then raise exception 'Explicit bond amount in cents required'; end if;
 if r.departure_date-r.arrival_date<7 then
  rate:=(p_data->>'nightly_rate')::numeric;
  if rate is null or rate<=0 or rate::text in ('NaN','Infinity','-Infinity') or round(rate,2)<>rate then raise exception 'Explicit nightly rate in cents required'; end if;
 end if;
 c:=jsonb_populate_record(null::public.contracts,sakan_private.manage_contract(p_res,'draft',jsonb_build_object('terms',t.terms,'template_reference',t.title||' / '||t.id)));
 update public.contracts set fields=fields||jsonb_build_object('template_id',t.id,'proprietor',t.proprietor,'email',r.email,'phone',r.phone,'resident_names',names,'premises_address',trim(p_data->>'premises_address'),'room_label',sakan_private.bed_reference(r.room_id,r.bed_numbers),'bed_numbers',to_jsonb(r.bed_numbers),'term_description',trim(p_data->>'term_description'),'bond',bond,'first_rent_due',(p_data->>'first_rent_due')::date,'billing_type',case when rate is null then 'fortnightly' else 'nightly' end,'nightly_rate',rate,'payment_method',case when rate is null then 'Cash or direct transfer; fortnightly rent in advance on the house cycle' else 'Cash or direct transfer; agreed nightly rent in advance' end) where id=c.id returning * into c;
 return to_jsonb(c);
end $function$
;
CREATE OR REPLACE FUNCTION sakan_private.update_tenant_details(p_id uuid, p_expected jsonb, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.people; n public.people;
begin
 perform sakan_private.require_staff();
 select * into p from public.people where id=p_id for update;
 if not found then raise exception 'Tenant not found';end if;
 if p_expected is distinct from to_jsonb(p) then raise exception 'Tenant changed. Reload before saving' using errcode='40001';end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'object' then raise exception 'Invalid tenant details';end if;
 if exists(select 1 from jsonb_object_keys(p_changes) k where k<>all(array['name','phone','email','property_id','room_id','bed_number','stay_type','weekly_rate','nightly_rate','start_date','end_date','paid_up_to','opening_balance','first_charge_amount','rent_cycle_anchor','bond','bond_status','document_url','document_notes'])) then raise exception 'Unsupported tenant field';end if;
 n:=jsonb_populate_record(p,to_jsonb(p)||p_changes);
 update public.people set name=n.name,phone=n.phone,email=n.email,property_id=n.property_id,room_id=n.room_id,bed_number=n.bed_number,stay_type=n.stay_type,weekly_rate=n.weekly_rate,nightly_rate=n.nightly_rate,start_date=n.start_date,end_date=n.end_date,paid_up_to=n.paid_up_to,opening_balance=n.opening_balance,first_charge_amount=n.first_charge_amount,rent_cycle_anchor=n.rent_cycle_anchor,bond=n.bond,bond_status=n.bond_status,document_url=n.document_url,document_notes=n.document_notes where id=p.id returning * into p;
 return to_jsonb(p);
end $function$
;
CREATE OR REPLACE FUNCTION sakan_private.guard_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare free integer; suburb text;
begin
 if new.capacity<1 then raise exception 'Capacity must be positive'; end if;
 if new.property_id<>old.property_id then
  if exists(select 1 from public.people where room_id=new.id) or exists(select 1 from public.reservations where room_id=new.id) then raise exception 'A room with resident or reservation history cannot move property'; end if;
  update public.room_profiles set published=false,ready=false,approved_by=null,approved_at=null,revision=revision+1 where room_id=new.id;
 end if;
 if new.capacity<>old.capacity then
  if exists(select 1 from public.people p where p.room_id=new.id and p.bed_number>new.capacity and least(coalesce(p.end_date,'infinity'::date),coalesce((p.checked_out_at at time zone 'Australia/Adelaide')::date,'infinity'::date))>(now() at time zone 'Australia/Adelaide')::date) then raise exception 'Reassign beds before reducing room capacity'; end if;
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
end $function$
;
commit;
