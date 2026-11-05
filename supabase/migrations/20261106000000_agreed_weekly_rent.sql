-- Admin-approved weekly rent override for incoming reservation agreements.
-- Public quotes remain standard; only the staff-guarded agreement RPC can set the override.
alter table public.reservations add column if not exists agreed_weekly_rate numeric(10,2);
alter table public.reservations add constraint reservations_agreed_weekly_rate_valid check (agreed_weekly_rate is null or (agreed_weekly_rate > 0 and agreed_weekly_rate <= 10000));
CREATE OR REPLACE FUNCTION sakan_private.guard_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if tg_op='UPDATE' and (new.room_id,new.property_id,new.start_date,new.end_date,new.checked_out_at) is not distinct from (old.room_id,old.property_id,old.start_date,old.end_date,old.checked_out_at) then return new; end if;
  s:=new.start_date; e:=coalesce(new.end_date,'infinity'::date); n:=1;
  if new.property_id<>pid then raise exception 'Room does not belong to property'; end if;
  if new.checked_out_at is not null then
    if new.checked_out_at>now() then raise exception 'Actual checkout cannot be in the future'; end if;
    e:=least(e,(new.checked_out_at at time zone 'Australia/Adelaide')::date);
    if e<=s then return new; end if;
  end if;
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
  new.weekly_rate:=coalesce(new.agreed_weekly_rate,case when cap>1 then 185 when new.stay_type='short' then 300 else 255 end);
  if new.status not in ('held','confirmed') then return new; end if;
  if new.status='held' and (new.hold_expires_at is null or new.hold_expires_at<=now()) then raise exception 'Hold expiry must be in the future'; end if;
  free:=sakan_private.free_spaces(rid,s,e,new.id);
 end if;
 if s is null or e<=s or n<1 or n>cap then raise exception 'Invalid allocation'; end if;
 if free<n then raise exception 'Room has insufficient availability' using errcode='23P01'; end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION sakan_private.booking_contract(p_id uuid, p_revision integer, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.reservations; c jsonb; t jsonb;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_id for update;
 if not found or r.revision<>p_revision then raise exception 'Reservation changed. Reload before generating' using errcode='40001'; end if;
 if r.status not in ('pending','review','held') then raise exception 'Only unconfirmed reservations can generate a new agreement'; end if;
 if length(trim(coalesce(p_data->>'full_name','')))<2 or coalesce(p_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(trim(coalesce(p_data->>'phone','')))<6 then raise exception 'Verify applicant name, email and contact'; end if;
 if p_data ? 'weekly_rate' then
  if (p_data->>'weekly_rate')::numeric is null or (p_data->>'weekly_rate')::numeric <= 0 or (p_data->>'weekly_rate')::numeric > 10000 or round((p_data->>'weekly_rate')::numeric,2) <> (p_data->>'weekly_rate')::numeric then raise exception 'Enter a valid agreed weekly rent in dollars and cents'; end if;
  update public.reservations set agreed_weekly_rate=(p_data->>'weekly_rate')::numeric where id=p_id;
 end if;
 r:=jsonb_populate_record(null::public.reservations,sakan_private.manage_reservation(p_id,p_revision,'edit',p_data));
 update public.reservations set full_name=trim(p_data->>'full_name'),email=lower(trim(p_data->>'email')),phone=trim(p_data->>'phone') where id=p_id returning * into r;
 insert into public.contract_defaults(property_id,premises_address) values(r.property_id,trim(p_data->>'premises_address')) on conflict(property_id) do update set premises_address=excluded.premises_address;
 if coalesce(p_data->>'template_id','')='' then
  if p_data->>'terms_confirmed' is distinct from 'true' then raise exception 'Review and verify the supplied source agreement terms'; end if;
  t:=sakan_private.approve_agreement_template((p_data->'template')||jsonb_build_object('confirmation','APPROVE_REUSABLE_TEMPLATE'));
  p_data:=p_data||jsonb_build_object('template_id',t->>'id');
 end if;
 c:=sakan_private.create_template_contract(p_id,p_data||jsonb_build_object('revision',r.revision));
 update public.contracts set fields=fields||jsonb_build_object('proprietor_signature',(select proprietor - 'address' - 'phone' - 'name' from public.contract_defaults where property_id=r.property_id),'proprietor_signature_date',(now() at time zone 'Australia/Adelaide')::date) where id=(c->>'id')::uuid returning to_jsonb(contracts.*) into c;
 return jsonb_build_object('reservation',to_jsonb(r),'contract',c);
end $function$;

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
 previous:=r.status;
 if p_action='edit' then
  if r.status in ('cancelled','archived','checked_in','assigned') then raise exception 'This reservation cannot be edited'; end if;
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
end $function$;

