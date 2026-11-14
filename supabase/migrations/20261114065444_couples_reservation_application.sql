-- Couples reserve the whole flat; ledger charges are split equally, never doubled.
begin;
create function sakan_private.is_couples_room(p_room uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.room_profiles rp join public.rooms r on r.id=rp.room_id join public.property_profiles pp on pp.property_id=r.property_id where rp.room_id=p_room and rp.slug='granny-flat' and pp.suburb='Fulham');
$$;
revoke all on function sakan_private.is_couples_room(uuid) from public,anon,authenticated,service_role;

create table public.reservation_applicants(
 reservation_id uuid not null references public.reservations(id), occupant_number integer not null check(occupant_number in(1,2)),
 full_name text not null, email text not null, phone text not null, occupation text,
 id_path text not null, consent_version text not null, created_at timestamptz not null default now(), person_id uuid references public.people(id),
 primary key(reservation_id,occupant_number)
);
alter table public.reservation_applicants enable row level security;
revoke all on public.reservation_applicants from public,anon,authenticated,service_role;
grant select on public.reservation_applicants to authenticated;
create policy staff_applicant_read on public.reservation_applicants for select to authenticated using(public.is_sakan_staff());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('reservation-ids','reservation-ids',false,5242880,array['image/jpeg','image/png','application/pdf']);
create policy staff_reservation_id_read on storage.objects for select to authenticated using(bucket_id='reservation-ids' and public.is_sakan_staff());

-- Preserve all existing records and agreements. New granny-flat requests must
-- reserve both places and use $250/person ($500 total) rather than shared rates.
do $$declare source text;begin
 select pg_get_functiondef('sakan_private.guard_inventory()'::regprocedure) into source;
 source:=replace(source,'  new.offer_type:=case', E'  if sakan_private.is_couples_room(rid) then\n   if n<>2 or e<=(s+interval ''3 months'')::date then raise exception ''The granny flat requires two occupants and a stay longer than three calendar months'';end if;\n   new.agreed_weekly_rate:=coalesce(new.agreed_weekly_rate,250);\n  end if;\n  new.offer_type:=case');
 if position('The granny flat requires' in source)=0 then raise exception 'Inventory guard patch failed';end if;
 execute source;
 select pg_get_functiondef('sakan_private.availability(uuid,date,date)'::regprocedure) into source;
 source:=replace(source,' free:=sakan_private.free_spaces', E' if sakan_private.is_couples_room(p_room) and p_departure<=(p_arrival+interval ''3 months'')::date then raise exception ''The granny flat requires a stay longer than three calendar months'';end if;\n free:=sakan_private.free_spaces');
 source:=replace(source,$old$'weekly_rate',case when cap>1 then 185$old$,$new$'weekly_rate',case when sakan_private.is_couples_room(p_room) then 250 when cap>1 then 185$new$);
 execute source;
 select pg_get_functiondef('sakan_private.submit_request(jsonb,uuid,boolean)'::regprocedure) into source;
 source:=replace(source,' if p_key is null then', E' if not p_internal and sakan_private.is_couples_room((p_data->>''room_id'')::uuid) and current_setting(''sakan.couples_application'',true) is distinct from ''yes'' then raise exception ''Use the couples application form with both photo IDs'';end if;\n if p_key is null then');
 execute source;
 -- Keep both contacts and couple totals when staff regenerate a contract.
 select pg_get_functiondef('sakan_private.create_template_contract(uuid,jsonb)'::regprocedure) into source;
 source:=replace(source,' return to_jsonb(c);', E' if sakan_private.is_couples_room(r.room_id) then\n  update public.contracts set fields=fields||jsonb_build_object(''resident_contacts'',(select jsonb_agg(jsonb_build_object(''name'',a.full_name,''email'',a.email,''phone'',a.phone) order by a.occupant_number) from public.reservation_applicants a where a.reservation_id=r.id),''couples_total_weekly'',r.weekly_rate*2,''couples_total_bond'',bond*2,''room_label'',''Granny flat (whole flat for two occupants)'') where id=c.id returning * into c;\n end if;\n return to_jsonb(c);');
 execute source;
 -- Use the submitted contact details for each person when approving online or
 -- offline signatures. Existing reservations without applicant rows keep fallback.
 select pg_get_functiondef('sakan_private.manual_booking(uuid,integer,uuid)'::regprocedure) into source;
 source:=replace(source,'values(member,r.email,r.phone,', 'values(member,coalesce((select a.email from public.reservation_applicants a where a.reservation_id=r.id and a.occupant_number=jsonb_array_length(members)+1),r.email),coalesce((select a.phone from public.reservation_applicants a where a.reservation_id=r.id and a.occupant_number=jsonb_array_length(members)+1),r.phone),');
 if position('select a.email' in source)=0 then raise exception 'Applicant allocation patch failed';end if;
 execute source;
end $$;

create function sakan_private.validate_couples_application(p_data jsonb,p_key uuid) returns void language plpgsql security definer set search_path='' as $$
declare p jsonb; i integer:=0; r public.reservations; expected jsonb; quote jsonb;
begin
 if p_key is null or not sakan_private.is_couples_room((p_data->>'room_id')::uuid) then raise exception 'Choose the Fulham granny flat';end if;
 if p_data->>'consent_version' is distinct from 'couples-application-v1' then raise exception 'Both occupants must consent';end if;
 if jsonb_typeof(p_data->'occupants') is distinct from 'array' or jsonb_array_length(p_data->'occupants')<>2 then raise exception 'Provide both occupants';end if;
 if length(coalesce(p_data->>'introduction',''))>2000 then raise exception 'Introduction is too long';end if;
 for p in select value from jsonb_array_elements(p_data->'occupants') loop
  i:=i+1;
  if length(trim(coalesce(p->>'name',''))) not between 2 and 120 or length(coalesce(p->>'email',''))>254 or coalesce(p->>'email','') !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' or length(trim(coalesce(p->>'phone',''))) not between 6 and 30 or length(coalesce(p->>'occupation',''))>80 then raise exception 'Complete both occupants contact details';end if;
  if coalesce(p->>'id_path','') !~ ('^applications/'||p_key::text||'/'||i||'-[0-9a-f]{64}\.(jpg|png|pdf)$') then raise exception 'Provide a private photo ID for each occupant';end if;
 end loop;
 select * into r from public.reservations where request_key=p_key;
 if found then
  select jsonb_agg(jsonb_build_object('name',a.full_name,'email',a.email,'phone',a.phone,'occupation',a.occupation,'id_path',a.id_path) order by occupant_number) into expected from public.reservation_applicants a where reservation_id=r.id;
  if expected is distinct from p_data->'occupants' or r.room_id::text is distinct from p_data->>'room_id' or r.arrival_date::text is distinct from p_data->>'arrival_date' or r.departure_date::text is distinct from p_data->>'departure_date' or r.introduction is distinct from coalesce(p_data->>'introduction','') then raise exception 'Request identifier already used';end if;
  return;
 end if;
 if (p_data->>'arrival_date')::date<(now() at time zone 'Australia/Adelaide')::date then raise exception 'Arrival cannot be in the past';end if;
 quote:=sakan_private.availability((p_data->>'room_id')::uuid,(p_data->>'arrival_date')::date,(p_data->>'departure_date')::date);
 if (quote->>'spaces')::integer<2 then raise exception 'The whole granny flat is unavailable' using errcode='23P01';end if;
 if not (select requests_enabled from public.booking_settings where id) then raise exception 'Online applications are unavailable';end if;
end $$;
create function public.validate_couples_application(p_data jsonb,p_key uuid) returns void language sql security invoker set search_path='' as $$select sakan_private.validate_couples_application(p_data,p_key)$$;

create function sakan_private.submit_couples_application(p_data jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations; c public.contracts; d public.contract_defaults; p jsonb; i integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 perform sakan_private.validate_couples_application(p_data,p_key);
 select * into r from public.reservations where request_key=p_key;
 if found then select * into c from public.contracts where reservation_id=r.id order by version limit 1;
 else
  for p in select value from jsonb_array_elements(p_data->'occupants') loop
   if not exists(select 1 from storage.objects where bucket_id='reservation-ids' and name=p->>'id_path') then raise exception 'Both photo IDs must finish uploading';end if;
  end loop;
  perform set_config('sakan.couples_application','yes',true);
  perform sakan_private.submit_request(jsonb_build_object('room_id',p_data->>'room_id','arrival_date',p_data->>'arrival_date','departure_date',p_data->>'departure_date','spaces_requested',2,'full_name',p_data->'occupants'->0->>'name','email',p_data->'occupants'->0->>'email','phone',p_data->'occupants'->0->>'phone','introduction',coalesce(p_data->>'introduction','')),p_key);
  perform set_config('sakan.couples_application','no',true);
  select * into r from public.reservations where request_key=p_key for update;
  for p in select value from jsonb_array_elements(p_data->'occupants') loop
   i:=i+1;
   insert into public.reservation_applicants(reservation_id,occupant_number,full_name,email,phone,occupation,id_path,consent_version) values(r.id,i,p->>'name',p->>'email',p->>'phone',p->>'occupation',p->>'id_path',p_data->>'consent_version');
  end loop;
  select * into d from public.contract_defaults where property_id=r.property_id;
  if length(d.premises_address)<5 or length(d.draft_terms)<40 or length(d.proprietor->>'name')<2 or d.property_id is null then raise exception 'The property agreement defaults need administrator review';end if;
  insert into public.contracts(reservation_id,version,reservation_revision,fields) values(r.id,1,r.revision,jsonb_build_object(
   'full_name',r.full_name,'room_id',r.room_id,'arrival_date',r.arrival_date,'departure_date',r.departure_date,'weekly_rate',r.weekly_rate,'offer_type',r.offer_type,'spaces_requested',2,
   'resident_names',(select jsonb_agg(value->>'name') from jsonb_array_elements(p_data->'occupants')),
   'resident_contacts',(select jsonb_agg(value-'id_path') from jsonb_array_elements(p_data->'occupants')),
   'email',r.email,'phone',r.phone,'premises_address',d.premises_address,'room_label','Granny flat (whole flat for two occupants)',
   'bed_numbers',to_jsonb(r.bed_numbers),'term_description',r.arrival_date||' to '||r.departure_date,'bond',500,'couples_total_weekly',500,'couples_total_bond',1000,
   'first_rent_due',r.arrival_date,'billing_type','fortnightly','terms',d.draft_terms,'proprietor',d.proprietor-'signature_png'-'signature_width'-'signature_height',
   'proprietor_signature',d.proprietor-'address'-'phone'-'name','proprietor_signature_date',(now() at time zone 'Australia/Adelaide')::date,
   'template_reference','Property agreement defaults / couples application / admin review required'
  )) returning * into c;
  insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'couples_application_received','website',jsonb_build_object('occupants',2,'contract_id',c.id));
 end if;
 return jsonb_build_object('code',r.reservation_code,'status',r.status,'reservation_id',r.id,'contract',to_jsonb(c));
end $$;
create function public.submit_couples_application(p_data jsonb,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.submit_couples_application(p_data,p_key)$$;

create function sakan_private.complete_application_contract(p_key uuid,p_contract uuid,p_path text) returns void language plpgsql security definer set search_path='' as $$
declare r public.reservations; c public.contracts;
begin
 select * into r from public.reservations where request_key=p_key for update;
 select * into c from public.contracts where id=p_contract and reservation_id=r.id for update;
 if c.id is null or c.status<>'draft' or c.reservation_revision<>r.revision or not exists(select 1 from public.reservation_applicants where reservation_id=r.id) then raise exception 'Current application agreement required';end if;
 if p_path is distinct from 'contracts/'||r.id||'/'||c.id||'/application.pdf' or not exists(select 1 from storage.objects where bucket_id='reservation-contracts' and name=p_path) then raise exception 'Private PDF required';end if;
 if c.document_path is null then update public.contracts set document_path=p_path where id=c.id;end if;
end $$;
create function public.complete_application_contract(p_key uuid,p_contract uuid,p_path text) returns void language sql security invoker set search_path='' as $$select sakan_private.complete_application_contract(p_key,p_contract,p_path)$$;
revoke all on function sakan_private.validate_couples_application(jsonb,uuid),public.validate_couples_application(jsonb,uuid),sakan_private.submit_couples_application(jsonb,uuid),public.submit_couples_application(jsonb,uuid),sakan_private.complete_application_contract(uuid,uuid,text),public.complete_application_contract(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function sakan_private.validate_couples_application(jsonb,uuid),public.validate_couples_application(jsonb,uuid),sakan_private.submit_couples_application(jsonb,uuid),public.submit_couples_application(jsonb,uuid),sakan_private.complete_application_contract(uuid,uuid,text),public.complete_application_contract(uuid,uuid,text) to service_role;

-- Keep submitted contacts and IDs linked to the two allocated tenant records.
create function sakan_private.link_application_people() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.assigned_people is distinct from old.assigned_people then update public.reservation_applicants a set person_id=(new.assigned_people->>(a.occupant_number-1))::uuid where reservation_id=new.id;end if;
 return new;
end $$;
revoke all on function sakan_private.link_application_people() from public,anon,authenticated,service_role;
create trigger link_application_people after update of assigned_people on public.reservations for each row execute function sakan_private.link_application_people();

-- Natural listing identity, never a generated tenant/property UUID. Preserve
-- approval and photos; only correct the granny flat's advertised capacity.
update public.rooms r set capacity=2 from public.room_profiles rp,public.property_profiles pp where rp.room_id=r.id and pp.property_id=r.property_id and rp.slug='granny-flat' and pp.suburb='Fulham' and r.capacity=1;
update public.room_profiles rp set description='Private granny flat for two occupants, with your own kitchen, bathroom and separate entrance. Rent is $500 per couple per week, bills included. Total bond is $1,000. Stays must be longer than three calendar months.' from public.rooms r,public.property_profiles pp where rp.room_id=r.id and pp.property_id=r.property_id and rp.slug='granny-flat' and pp.suburb='Fulham';
commit;
