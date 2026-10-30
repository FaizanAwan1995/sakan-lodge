-- Website enquiries and independent staff alerts. Existing guest drafts remain manual.
create table public.website_enquiries (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique,
 reference text not null unique default ('ENQ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 details jsonb not null, fingerprint text not null, created_at timestamptz not null default now()
);
create index website_enquiries_fingerprint_created on public.website_enquiries(fingerprint,created_at);
create table public.incoming_alert_deliveries (
 id uuid primary key default gen_random_uuid(), source_id uuid not null, kind text not null check(kind in ('reservation','enquiry')),
 recipient text not null, reply_to text not null, subject text not null, body text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','uncertain')),
 attempt uuid, message_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(kind,source_id,recipient)
);
create index incoming_alert_pending on public.incoming_alert_deliveries(created_at) where status='pending';
alter table public.website_enquiries enable row level security;
alter table public.incoming_alert_deliveries enable row level security;
revoke all on public.website_enquiries,public.incoming_alert_deliveries from anon,authenticated;
grant select on public.website_enquiries,public.incoming_alert_deliveries to authenticated;
grant all on public.website_enquiries,public.incoming_alert_deliveries to service_role;
create policy staff_read on public.website_enquiries for select to authenticated using((select public.is_sakan_staff()));
create policy staff_read on public.incoming_alert_deliveries for select to authenticated using((select public.is_sakan_staff()));

create function sakan_private.queue_incoming_alert() returns trigger language plpgsql security definer set search_path='' as $$
declare subject text; body text; reply text; kind text; recipient text; location text; room text;
begin
 if tg_table_name='reservations' then
  kind:='reservation';reply:=new.email;
  select coalesce(pp.public_name,p.name),r.label into location,room from public.properties p join public.rooms r on r.property_id=p.id left join public.property_profiles pp on pp.property_id=p.id where r.id=new.room_id;
  subject:='New reservation request - '||new.reservation_code;
  body:='New reservation request'||E'\nReference: '||new.reservation_code||E'\nName: '||new.full_name||E'\nEmail: '||new.email||E'\nPhone: '||new.phone||E'\nProperty: '||coalesce(location,'')||E'\nRoom: '||coalesce(room,'')||E'\nDates: '||new.arrival_date||' to '||new.departure_date||E'\nOccupants: '||new.spaces_requested||E'\nIntroduction: '||coalesce(new.introduction,'')||E'\n\nReview in Ledger: https://sakanlodge.com/ledger/reservations?reservation='||new.id||E'\n\nThis request is not a confirmed booking.';
 else
  kind:='enquiry';reply:=new.details->>'email';subject:='New accommodation enquiry - '||new.reference;
  body:='New website enquiry'||E'\nReference: '||new.reference;
  for location,room in select key,value from jsonb_each_text(new.details) loop body:=body||E'\n'||location||': '||room;end loop;
  body:=body||E'\n\nView enquiries: https://sakanlodge.com/ledger/home?enquiries=1\n\nThis enquiry is not a reservation.';
 end if;
 for recipient in select distinct e from unnest(array['sakanlodges@gmail.com']||sakan_private.staff_emails()) e loop
  insert into public.incoming_alert_deliveries(source_id,kind,recipient,reply_to,subject,body) values(new.id,kind,recipient,reply,subject,body) on conflict do nothing;
 end loop;
 return new;
end $$;
revoke all on function sakan_private.queue_incoming_alert() from public,anon,authenticated;
create trigger reservation_staff_alert after insert on public.reservations for each row execute function sakan_private.queue_incoming_alert();
create trigger enquiry_staff_alert after insert on public.website_enquiries for each row execute function sakan_private.queue_incoming_alert();

create function public.submit_enquiry(p_data jsonb,p_key uuid,p_fingerprint text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.website_enquiries;
begin
 if current_user<>'service_role' then raise exception 'Service only' using errcode='42501';end if;
 if p_key is null or coalesce(p_fingerprint,'') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_fingerprint,0));
 select * into e from public.website_enquiries where request_key=p_key;
 if found then
  if e.details<>p_data then raise exception 'Request changed' using errcode='23505';end if;
  return jsonb_build_object('reference',e.reference);
 end if;
 if (select count(*) from public.website_enquiries where fingerprint=p_fingerprint and created_at>now()-interval '1 hour')>=5 then raise sqlstate 'PGRST' using message='{"code":"RATE_LIMIT","message":"Too many enquiries","details":null,"hint":null}',detail='{"status":429}';end if;
 if jsonb_typeof(p_data)<>'object' or length(p_data::text)>8000 or coalesce(length(p_data->>'full_name'),0) not between 2 and 120 or coalesce(p_data->>'email','') !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$' then raise exception 'Invalid details';end if;
 insert into public.website_enquiries(request_key,details,fingerprint) values(p_key,p_data,p_fingerprint) returning * into e;
 return jsonb_build_object('reference',e.reference);
end $$;
revoke all on function public.submit_enquiry(jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.submit_enquiry(jsonb,uuid,text) to service_role;

create function public.incoming_alert_worker(p_action text,p_id uuid default null,p_attempt uuid default null,p_message text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare n public.incoming_alert_deliveries;
begin
 if current_user<>'service_role' then raise exception 'Service only' using errcode='42501';end if;
 if p_action='pending' then
  update public.incoming_alert_deliveries set status='uncertain',updated_at=now() where status='sending' and updated_at<now()-interval '5 minutes';
  return coalesce((select jsonb_agg(id) from (select id from public.incoming_alert_deliveries where status='pending' order by created_at limit 12)q),'[]');
 elsif p_action='claim' then
  if p_attempt is null then raise exception 'Attempt required';end if;
  update public.incoming_alert_deliveries set status='sending',attempt=p_attempt,updated_at=now() where id=p_id and status='pending' returning * into n;
  return case when n.id is null then null else to_jsonb(n) end;
 elsif p_action='sent' then
  if coalesce(length(p_message),0)=0 then raise exception 'Message confirmation required';end if;
  update public.incoming_alert_deliveries set status='sent',message_id=p_message,updated_at=now() where id=p_id and attempt=p_attempt and status in ('sending','uncertain') returning * into n;
 elsif p_action='uncertain' then
  update public.incoming_alert_deliveries set status='uncertain',updated_at=now() where id=p_id and attempt=p_attempt and status='sending' returning * into n;
 else raise exception 'Unknown action';end if;
 return to_jsonb(n);
end $$;
revoke all on function public.incoming_alert_worker(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.incoming_alert_worker(text,uuid,uuid,text) to service_role;
