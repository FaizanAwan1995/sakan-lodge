begin;
-- Existing residents, signed agreements and transactions are never backfilled.
create table public.contract_defaults (
 property_id uuid primary key references public.properties(id),
 premises_address text not null default '',
 proprietor jsonb not null default '{}',
 draft_terms text not null default ''
);
alter table public.contract_defaults enable row level security;
revoke all on public.contract_defaults from public,anon,authenticated;
grant select,insert,update on public.contract_defaults to authenticated;
create policy staff_contract_defaults on public.contract_defaults for all to authenticated using(public.is_sakan_staff()) with check(public.is_sakan_staff());
alter table public.reservations add column bond_verified_at timestamptz, add column bond_receipt_path text, add column assigned_people jsonb not null default '[]';
alter table public.reservations drop constraint reservation_status;
alter table public.reservations add constraint reservation_status check(status in ('pending','review','held','confirmed','assigned','checked_in','cancelled','archived'));

create function sakan_private.booking_contract(p_id uuid,p_revision integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reservations; c jsonb; t jsonb;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_id for update;
 if not found or r.revision<>p_revision then raise exception 'Reservation changed. Reload before generating' using errcode='40001'; end if;
 if r.status not in ('pending','review','held') then raise exception 'Only unconfirmed reservations can generate a new agreement'; end if;
 if length(trim(coalesce(p_data->>'full_name','')))<2 or coalesce(p_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(trim(coalesce(p_data->>'phone','')))<6 then raise exception 'Verify applicant name, email and contact'; end if;
 r:=jsonb_populate_record(null::public.reservations,sakan_private.manage_reservation(p_id,p_revision,'edit',p_data));
 update public.reservations set full_name=trim(p_data->>'full_name'),email=lower(trim(p_data->>'email')),phone=trim(p_data->>'phone') where id=p_id returning * into r;
 insert into public.contract_defaults(property_id,premises_address) values(r.property_id,trim(p_data->>'premises_address')) on conflict(property_id) do update set premises_address=excluded.premises_address;
 if coalesce(p_data->>'template_id','')='' then
  if p_data->>'terms_confirmed' is distinct from 'true' then raise exception 'Review and verify the supplied source agreement terms'; end if;
  t:=sakan_private.approve_agreement_template((p_data->'template')||jsonb_build_object('confirmation','APPROVE_REUSABLE_TEMPLATE'));
  p_data:=p_data||jsonb_build_object('template_id',t->>'id');
 end if;
 c:=sakan_private.create_template_contract(p_id,p_data||jsonb_build_object('revision',r.revision));
 return jsonb_build_object('reservation',to_jsonb(r),'contract',c);
end $$;
create function public.generate_booking_contract(p_id uuid,p_revision integer,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.booking_contract(p_id,p_revision,p_data)$$;

create function sakan_private.contract_document(p_id uuid,p_path text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.contracts; r public.reservations;
begin
 perform sakan_private.require_staff();
 select * into c from public.contracts where id=p_id;
 select * into r from public.reservations where id=c.reservation_id for update;
 select * into c from public.contracts where id=p_id for update;
 if c.id is null or c.status not in ('draft','approved','signed') or r.status in ('cancelled','archived') then raise exception 'Current contract required'; end if;
 if p_path is not null then
  if c.document_path is not null then raise exception 'Generated PDF is immutable'; end if;
  if p_path not like 'contracts/'||r.id||'/'||c.id||'/%' or p_path like '%..%' then raise exception 'Invalid PDF path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='reservation-contracts' and name=p_path) then raise exception 'Store the generated PDF first'; end if;
  update public.contracts set document_path=p_path where id=p_id returning * into c;
 end if;
 return jsonb_build_object('contract',to_jsonb(c),'code',r.reservation_code);
end $$;
create function public.booking_contract_document(p_id uuid,p_path text default null) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.contract_document(p_id,p_path)$$;

create function sakan_private.booking_offer(p_id uuid,p_revision integer,p_contract uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reservations; c public.contracts; n public.notification_outbox; msg text;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_id for update;
 if not found or r.revision<>p_revision then raise exception 'Reservation changed. Reload before sending' using errcode='40001'; end if;
 select * into c from public.contracts where id=p_contract and reservation_id=r.id;
 if r.status not in ('pending','review','held') or c.id is null or c.status not in ('draft','approved') or c.document_path is null or c.reservation_revision<>r.revision then raise exception 'Review the current generated PDF first'; end if;
 select * into n from public.notification_outbox where reservation_id=r.id and kind='provisional_offer' and payload->>'contract_id'=c.id::text and status<>'superseded' order by created_at desc limit 1;
 if found then return to_jsonb(n); end if;
 perform sakan_private.manage_contract(r.id,'approve',jsonb_build_object('id',c.id)) where c.status='draft';
 msg:='Hello '||r.full_name||E',\n\nThank you for choosing SAKAN Lodge. We have reviewed your request and attached your accommodation agreement for review and signature.\n\nReservation reference: '||r.reservation_code||E'\nArrival: '||r.arrival_date||E'\nDeparture: '||r.departure_date||E'\nRoom: '||(c.fields->>'room_label')||E'\nRent per fortnight: AUD $'||(r.weekly_rate*2)||case when r.offer_type='shared' then ' per person' else '' end||E'\nBond required: AUD $'||((c.fields->>'bond')::numeric*r.spaces_requested)||E' total\n\nThis is a provisional booking notice, not final confirmation. To proceed:\n1. Pay the bond to our PayID: 0426721787. Use your reservation reference as the payment reference.\n2. Reply to sakanlodges@gmail.com with the signed agreement and your payment receipt.\n\nYour booking will be confirmed after our team verifies the bond payment, the required signatures and room availability. Remaining rent can be paid on arrival.\nElectricity, water, gas and internet are included without additional charges.\n\nKind regards,\nSAKAN Lodge\nsakanlodges@gmail.com\n0426 721 787';
 if c.fields->>'billing_type'='nightly' then msg:=replace(msg,E'\nRent per fortnight: AUD $'||(r.weekly_rate*2),E'\nAgreed rent per night: AUD $'||(c.fields->>'nightly_rate')); end if;
 insert into public.notification_outbox(reservation_id,recipient,kind,payload) values(r.id,r.email,'provisional_offer',jsonb_build_object('subject','SAKAN Lodge - provisional booking and agreement - '||r.reservation_code,'body',msg,'revision',r.revision,'contract_id',c.id,'document_path',c.document_path)) returning * into n;
 return to_jsonb(n);
end $$;
create function public.prepare_booking_offer(p_id uuid,p_revision integer,p_contract uuid) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.booking_offer(p_id,p_revision,p_contract)$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('reservation-receipts','reservation-receipts',false,10485760,array['application/pdf','image/png','image/jpeg']) on conflict(id) do nothing;
create policy staff_receipt_read on storage.objects for select to authenticated using(bucket_id='reservation-receipts' and public.is_sakan_staff());
create policy staff_receipt_upload on storage.objects for insert to authenticated with check(bucket_id='reservation-receipts' and public.is_sakan_staff() and name like 'receipts/%');

create function sakan_private.finish_booking(p_id uuid,p_revision integer,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reservations; c public.contracts; person uuid; first_person uuid; people jsonb:='[]'; member text; bond numeric; amount numeric; received date; receipt text;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_id for update;
 if not found or r.revision<>p_revision then raise exception 'Reservation changed. Reload before confirming' using errcode='40001'; end if;
 if r.status not in ('pending','review','held') or r.checked_in_person_id is not null then raise exception 'Booking already assigned or cannot be confirmed'; end if;
 select * into c from public.contracts where reservation_id=r.id and status='signed' and approved_at is not null and signed_at is not null order by version desc limit 1;
 if c.id is null or c.reservation_revision<>r.revision then raise exception 'Current approved signed contract required'; end if;
 bond:=(c.fields->>'bond')::numeric; amount:=(p_data->>'amount')::numeric; received:=(p_data->>'received_date')::date; receipt:=p_data->>'receipt_path';
 if bond is null or amount is distinct from bond*r.spaces_requested or p_data->>'payment_verified' is distinct from 'true' or received is null or received>(now() at time zone 'Australia/Adelaide')::date or length(trim(coalesce(p_data->>'reference','')))<3 then raise exception 'Verify the exact bond amount, receipt date and bank reference'; end if;
 if receipt not like 'receipts/'||r.id||'/%' or receipt like '%..%' or not exists(select 1 from storage.objects where bucket_id='reservation-receipts' and name=receipt) then raise exception 'Upload payment evidence for this reservation first'; end if;
 update public.reservations set bond_verified_at=now(),bond_receipt_path=receipt where id=r.id;
 r:=jsonb_populate_record(null::public.reservations,sakan_private.manage_reservation(r.id,r.revision,'confirm','{}'));
 -- Move the allocation atomically to actual dated ledger residents. No duplicate
 -- reservation allocation and no claim that a future resident has checked in.
 update public.reservations set status='assigned' where id=r.id;
 for member in select value from jsonb_array_elements_text(c.fields->'resident_names') loop
  insert into public.people(name,email,phone,property_id,room_id,stay_type,weekly_rate,nightly_rate,start_date,end_date,bond,bond_status)
  values(member,r.email,r.phone,r.property_id,r.room_id,case when c.fields->>'billing_type'='nightly' then 'short' else 'long' end,r.weekly_rate,(c.fields->>'nightly_rate')::numeric,r.arrival_date,r.departure_date,bond,'paid') returning id into person;
  people:=people||jsonb_build_array(person); first_person:=coalesce(first_person,person);
  if bond>0 then insert into public.payments(person_id,property_id,date,amount,method,kind,received_by,note) values(person,r.property_id,received,bond,'transfer','bond',auth.uid()::text,'Verified PayID bond for '||r.reservation_code||'; bank reference: '||left(p_data->>'reference',160)); end if;
 end loop;
 if jsonb_array_length(people)<>r.spaces_requested then raise exception 'Signed contract must name every resident'; end if;
 update public.reservations set status='assigned',checked_in_person_id=first_person,assigned_people=people,revision=revision+1,updated_at=now() where id=r.id returning * into r;
 perform sakan_private.queue_drafts(r,'booking confirmed');
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'bond_verified_and_assigned',auth.uid()::text,jsonb_build_object('people',people,'amount',amount,'receipt',receipt));
 return to_jsonb(r);
end $$;
create function public.confirm_paid_booking(p_id uuid,p_revision integer,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.finish_booking(p_id,p_revision,p_data)$$;

-- Close the old confirmation shortcut; legacy records remain unchanged.
do $$declare src text; begin
 select pg_get_functiondef('sakan_private.manage_reservation(uuid,integer,text,jsonb)'::regprocedure) into src;
 src:=replace(src,' elsif p_action=''confirm'' then', ' elsif p_action=''confirm'' then'||E'\n  if r.bond_verified_at is null then raise exception ''Verify bond payment using final booking confirmation''; end if;');
 execute src;
end $$;
-- Do not expose a fully allocated room after final confirmation, even if the
-- assigned tenant arrives later. Shared inventory retains unallocated beds.
do $$declare src text; begin
 select pg_get_functiondef('sakan_private.catalog()'::regprocedure) into src;
 src:=replace(src, '(now() at time zone ''Australia/Adelaide'')::date+1)>0', '''infinity''::date)>0');
 execute src;
end $$;
-- Freeze agreement changes while an email is being sent under the same lock.
do $$declare src text; begin
 select pg_get_functiondef('sakan_private.manage_contract(uuid,text,jsonb)'::regprocedure) into src;
 src:=replace(src, ' if p_action=''draft'' then', ' if exists(select 1 from public.notification_outbox where reservation_id=p_res and status=''sending'') then raise exception ''Reconcile the sending email before editing contracts''; end if;'||E'\n if p_action=''draft'' then');
 execute src;
end $$;
-- Once assigned, details and signed contracts cannot be rewritten through
-- legacy edit controls. Actual arrival is a separate, idempotent transition.
do $$declare src text; begin
 select pg_get_functiondef('sakan_private.manage_reservation(uuid,integer,text,jsonb)'::regprocedure) into src;
 src:=replace(src, 'r.status in (''cancelled'',''archived'',''checked_in'')', 'r.status in (''cancelled'',''archived'',''checked_in'',''assigned'')');
 src:=replace(src, ' previous:=r.status;', ' if p_action=''check_in'' and r.status=''assigned'' then
  if r.arrival_date>(now() at time zone ''Australia/Adelaide'')::date or r.departure_date<=(now() at time zone ''Australia/Adelaide'')::date then raise exception ''Actual arrival must be within the agreed stay''; end if;
  update public.reservations set status=''checked_in'',revision=revision+1,updated_at=now() where id=r.id returning * into r;
  insert into public.reservation_events(reservation_id,action,actor) values(r.id,''actual_arrival'',auth.uid()::text);
  return to_jsonb(r);
 end if;
 previous:=r.status;');
 execute src;
 select pg_get_functiondef('sakan_private.manage_contract(uuid,text,jsonb)'::regprocedure) into src;
 src:=replace(src, 'r.status in (''cancelled'',''archived'',''checked_in'')', 'r.status in (''cancelled'',''archived'',''checked_in'',''assigned'')');
 execute src;
end $$;
-- Trigger count and all public data grants remain unchanged.
revoke all on function sakan_private.booking_contract(uuid,integer,jsonb),public.generate_booking_contract(uuid,integer,jsonb),sakan_private.contract_document(uuid,text),public.booking_contract_document(uuid,text),sakan_private.booking_offer(uuid,integer,uuid),public.prepare_booking_offer(uuid,integer,uuid),sakan_private.finish_booking(uuid,integer,jsonb),public.confirm_paid_booking(uuid,integer,jsonb) from public,anon,service_role;
grant execute on function sakan_private.booking_contract(uuid,integer,jsonb),public.generate_booking_contract(uuid,integer,jsonb),sakan_private.contract_document(uuid,text),public.booking_contract_document(uuid,text),sakan_private.booking_offer(uuid,integer,uuid),public.prepare_booking_offer(uuid,integer,uuid),sakan_private.finish_booking(uuid,integer,jsonb),public.confirm_paid_booking(uuid,integer,jsonb) to authenticated;
commit;
