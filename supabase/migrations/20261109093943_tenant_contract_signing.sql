begin;
-- Private signing evidence. The public website receives only token-scoped responses.
create table public.contract_signing_requests (
 id uuid primary key default gen_random_uuid(),
 contract_id uuid not null references public.contracts(id),
 reservation_id uuid not null references public.reservations(id),
 reservation_revision integer not null,
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 document_hash text not null check(document_hash ~ '^[0-9a-f]{64}$'),
 status text not null default 'awaiting_signature' check(status in ('awaiting_signature','processing','signed','approved','rejected','revoked','superseded')),
 expires_at timestamptz not null, created_at timestamptz not null default now(),created_by uuid not null,
 submitted_at timestamptz, submission_hash text, signatures jsonb,
 signed_document_path text, signed_document_hash text,
 evidence jsonb not null default '{}', reviewed_at timestamptz, reviewed_by uuid, review_reason text
);
create unique index one_open_contract_signing on public.contract_signing_requests(contract_id) where status in ('awaiting_signature','processing','signed');
create index contract_signing_contract on public.contract_signing_requests(contract_id,created_at desc);
create index contract_signing_reservation on public.contract_signing_requests(reservation_id,created_at desc);
create index contract_signing_review on public.contract_signing_requests(created_at) where status='signed';
alter table public.contract_signing_requests enable row level security;
revoke all on public.contract_signing_requests from public,anon,authenticated,service_role;
grant select on public.contract_signing_requests to authenticated;
create policy staff_signing_read on public.contract_signing_requests for select to authenticated using(public.is_sakan_staff());

create function sakan_private.prepare_contract_signing(p_contract uuid,p_revision integer,p_token_hash text,p_document_hash text,p_days integer,p_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.contracts; r public.reservations; s public.contract_signing_requests; n public.notification_outbox;
begin
 perform sakan_private.require_staff();
 select * into c from public.contracts where id=p_contract;
 select * into r from public.reservations where id=c.reservation_id for update;
 select * into c from public.contracts where id=p_contract for update;
 if c.id is null or r.revision is distinct from p_revision or c.reservation_revision<>r.revision or r.status not in ('pending','review','held') or c.status not in ('draft','approved') or c.document_path is null then raise exception 'Review the current unsigned agreement PDF before creating a signing link' using errcode='40001'; end if;
 if coalesce(p_token_hash,'') !~ '^[0-9a-f]{64}$' or coalesce(p_document_hash,'') !~ '^[0-9a-f]{64}$' or coalesce(p_days,0) not between 1 and 14 or coalesce(p_url,'') !~ '^https://sakanlodge\.com/sign#[0-9a-f]{64}$' or encode(sha256(convert_to(split_part(p_url,'#',2),'UTF8')),'hex')<>p_token_hash then raise exception 'Invalid signing link'; end if;
 if jsonb_array_length(c.fields->'resident_names') is distinct from r.spaces_requested then raise exception 'Name every resident in the agreement before sending'; end if;
 if exists(select 1 from public.notification_outbox where reservation_id=r.id and status='sending') then raise exception 'Reconcile the sending email before replacing a link'; end if;
 if exists(select 1 from public.contract_signing_requests where contract_id=c.id and status='signed') then raise exception 'Review the received signature first'; end if;
 update public.contract_signing_requests set status='revoked' where contract_id=c.id and status in ('awaiting_signature','processing');
 update public.notification_outbox set status='superseded',updated_at=now() where reservation_id=r.id and kind='contract_signing' and status in ('pending','uncertain');
 update public.contracts set status='approved',approved_at=coalesce(approved_at,now()),approved_by=coalesce(approved_by,auth.uid()::text) where id=c.id;
 insert into public.contract_signing_requests(contract_id,reservation_id,reservation_revision,token_hash,document_hash,expires_at,created_by)
 values(c.id,r.id,r.revision,p_token_hash,p_document_hash,now()+make_interval(days=>p_days),auth.uid()) returning * into s;
 insert into public.notification_outbox(reservation_id,recipient,kind,payload)
 values(r.id,r.email,'contract_signing',jsonb_build_object('subject','Review and sign your SAKAN Lodge agreement - '||r.reservation_code,'body','Hello '||r.full_name||E',\n\nPlease review and sign your accommodation agreement online using this private link:\n\n'||p_url||E'\n\nReservation: '||r.reservation_code||E'\nAgreement version: '||c.version||E'\nLink expires: '||to_char(s.expires_at at time zone 'Australia/Adelaide','DD Mon YYYY HH24:MI')||E' (Adelaide time).\n\nAll residents named in the agreement must sign for themselves. You can download your signed copy on the signing page. No printing, scanning or reply email is needed.\n\nSigning sends the agreement to our team for review. It does not reserve a room or confirm your allocation. We will review the signatures and check availability before approving.\n\nKeep this link private. If any details are wrong, contact our team before signing.\n\nSAKAN Lodge\nsakanlodges@gmail.com\n0426 721 787','revision',r.revision,'contract_id',c.id,'signing_request_id',s.id)) returning * into n;
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'signing_link_created',auth.uid()::text,jsonb_build_object('request_id',s.id,'contract_id',c.id,'expires_at',s.expires_at));
 return jsonb_build_object('request',to_jsonb(s)-'token_hash','notification',to_jsonb(n));
end $$;
create function public.prepare_contract_signing(p_contract uuid,p_revision integer,p_token_hash text,p_document_hash text,p_days integer,p_url text) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.prepare_contract_signing(p_contract,p_revision,p_token_hash,p_document_hash,p_days,p_url)$$;

-- Service-only, bearer-token-scoped operation. Never grant this to anon or authenticated.
create function sakan_private.contract_signing_public(p_hash text,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.contract_signing_requests; r public.reservations; c public.contracts; entry jsonb; name text; i integer:=0; names jsonb;
begin
 if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Signing link unavailable' using errcode='42501'; end if;
 select * into s from public.contract_signing_requests where token_hash=p_hash;
 if not found then raise exception 'Signing link unavailable' using errcode='42501'; end if;
 select * into r from public.reservations where id=s.reservation_id for update;
 select * into c from public.contracts where id=s.contract_id for update;
 select * into s from public.contract_signing_requests where id=s.id for update;
 if s.expires_at<=now() or s.status='revoked' then raise exception 'Signing link expired or revoked. Ask SAKAN for a new link' using errcode='42501'; end if;
 if p_action='access' and s.status in ('signed','approved','rejected','superseded') then
  return jsonb_build_object('request',to_jsonb(s)-'token_hash','contract',to_jsonb(c),'code',r.reservation_code);
 end if;
 if c.reservation_revision<>s.reservation_revision or r.revision<>s.reservation_revision or c.status not in ('approved','signed') or r.status not in ('pending','review','held') then raise exception 'This agreement has changed. Ask SAKAN for a new signing link' using errcode='40001'; end if;
 if p_action='access' then
  return jsonb_build_object('request',to_jsonb(s)-'token_hash','contract',to_jsonb(c),'code',r.reservation_code);
 elsif p_action='begin' then
  if s.status in ('signed','approved') and s.submission_hash=p_data->>'submission_hash' then return jsonb_build_object('request',to_jsonb(s)-'token_hash','contract',to_jsonb(c),'code',r.reservation_code); end if;
  if s.status not in ('awaiting_signature','processing') or p_data->>'document_hash' is distinct from s.document_hash or coalesce(p_data->>'submission_hash','') !~ '^[0-9a-f]{64}$' or p_data->>'consent_version' is distinct from 'sakan-sign-v1' or jsonb_typeof(p_data->'signatures') is distinct from 'array' then raise exception 'Review the current agreement and consent before signing'; end if;
  if octet_length((p_data->'signatures')::text)>220000 then raise exception 'Signature submission too large'; end if;
  names:=c.fields->'resident_names';
  if jsonb_array_length(p_data->'signatures') is distinct from jsonb_array_length(names) then raise exception 'Every named resident must sign'; end if;
  for entry in select value from jsonb_array_elements(p_data->'signatures') loop
   name:=names->>i;
   if lower(regexp_replace(trim(coalesce(entry->>'name','')),'\s+',' ','g'))<>lower(regexp_replace(trim(name),'\s+',' ','g')) or entry->>'consent' is distinct from 'true' or coalesce(entry->>'mode','') not in ('typed','drawn') then raise exception 'Each resident must sign using their name and consent'; end if;
   i:=i+1;
  end loop;
  if s.status='processing' and s.submission_hash is distinct from p_data->>'submission_hash' then raise exception 'A signature submission is already processing. Retry the original submission' using errcode='40001'; end if;
  if s.status='awaiting_signature' then
   update public.contract_signing_requests set status='processing',submitted_at=now(),submission_hash=p_data->>'submission_hash',signatures=p_data->'signatures',evidence=jsonb_build_object('consent_version','sakan-sign-v1','network_fingerprint',p_data->>'network_fingerprint','user_agent',left(p_data->>'user_agent',300),'access_method','Private invitation link sent to the applicant email; administrator reviews identity') where id=s.id returning * into s;
  end if;
 elsif p_action='complete' then
  if s.status='signed' and s.signed_document_path=p_data->>'path' and s.signed_document_hash=p_data->>'signed_hash' then return jsonb_build_object('request',to_jsonb(s)-'token_hash','contract',to_jsonb(c),'code',r.reservation_code); end if;
  if s.status<>'processing' or s.submission_hash is distinct from p_data->>'submission_hash' or p_data->>'path' is distinct from ('contracts/'||r.id||'/'||c.id||'/signed-'||s.id||'.pdf') or coalesce(p_data->>'signed_hash','') !~ '^[0-9a-f]{64}$' then raise exception 'Signature receipt could not be verified'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='reservation-contracts' and o.name=p_data->>'path') then raise exception 'Store the signed agreement first'; end if;
  update public.contract_signing_requests set status='signed',signed_document_path=p_data->>'path',signed_document_hash=p_data->>'signed_hash' where id=s.id returning * into s;
  update public.contracts set status='signed',signed_at=s.submitted_at,signed_by=(select string_agg(value->>'name','; ' order by ord) from jsonb_array_elements(s.signatures) with ordinality as x(value,ord)),signed_document_path=s.signed_document_path where id=c.id returning * into c;
  insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'tenant_signature_received','tenant-signing-link',jsonb_build_object('request_id',s.id,'contract_id',c.id,'document_hash',s.document_hash,'signed_document_hash',s.signed_document_hash,'signed_at',s.submitted_at));
 else raise exception 'Unknown signing operation'; end if;
 return jsonb_build_object('request',to_jsonb(s)-'token_hash','contract',to_jsonb(c),'code',r.reservation_code);
end $$;
create function public.contract_signing_public(p_hash text,p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select sakan_private.contract_signing_public(p_hash,p_action,p_data)$$;

create function sakan_private.review_contract_signing(p_id uuid,p_revision integer,p_action text,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.contract_signing_requests; r public.reservations; c public.contracts; result jsonb;
begin
 perform sakan_private.require_staff();
 select * into s from public.contract_signing_requests where id=p_id;
 select * into r from public.reservations where id=s.reservation_id for update;
 select * into c from public.contracts where id=s.contract_id for update;
 select * into s from public.contract_signing_requests where id=p_id for update;
 if s.id is null or r.revision is distinct from p_revision then raise exception 'Request changed. Refresh before reviewing' using errcode='40001'; end if;
 if p_action='revoke' and s.status in ('awaiting_signature','processing') then
  update public.contract_signing_requests set status='revoked',reviewed_at=now(),reviewed_by=auth.uid() where id=s.id;
  result:=to_jsonb(r);
 elsif p_action in ('approve','reject') and s.status='signed' then
  if c.status<>'signed' or c.signed_document_path is distinct from s.signed_document_path or c.reservation_revision<>r.revision or s.reservation_revision<>r.revision or r.status not in ('pending','review','held') then raise exception 'Agreement changed. Generate a replacement before proceeding' using errcode='40001'; end if;
  if p_action='approve' then
   update public.contract_signing_requests set status='approved',reviewed_at=now(),reviewed_by=auth.uid() where id=s.id;
   result:=sakan_private.manual_booking(r.id,r.revision,c.id);
  else
   if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Enter a rejection reason (3-1000 characters)'; end if;
   result:=sakan_private.manage_reservation(r.id,r.revision,'cancel','{}');
   update public.contract_signing_requests set status='rejected',reviewed_at=now(),reviewed_by=auth.uid(),review_reason=trim(p_reason) where id=s.id;
  end if;
 else raise exception 'This signing request has already been handled. Refresh before reviewing'; end if;
 update public.notification_outbox set status='superseded',updated_at=now() where payload->>'signing_request_id'=s.id::text and status in ('pending','uncertain');
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'signing_'||p_action,auth.uid()::text,jsonb_build_object('request_id',s.id,'contract_id',c.id,'reason',case when p_action='reject' then trim(p_reason) end,'payments_recorded',false));
 return result;
end $$;
create function public.review_contract_signing(p_id uuid,p_revision integer,p_action text,p_reason text default null) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.review_contract_signing(p_id,p_revision,p_action,p_reason)$$;

-- Preserve existing manual/offline workflow, but never bypass an active online review.
do $$declare source text;begin
 select pg_get_functiondef('sakan_private.manual_booking(uuid,integer,uuid)'::regprocedure) into source;
 source:=replace(source,' perform sakan_private.require_staff();',' perform sakan_private.require_staff();
 if exists(select 1 from public.contract_signing_requests where contract_id=p_contract and status in (''awaiting_signature'',''processing'',''signed'')) then raise exception ''Review and approve the online signature before allocating this room''; end if;');
 -- Honour the administrator-approved rent already frozen in this contract.
 source:=replace(source,'r.weekly_rate is distinct from (case when cap>1 then 185 when r.departure_date<(r.arrival_date+interval ''2 months'')::date then 300 else 255 end)',
 'r.weekly_rate is distinct from coalesce(r.agreed_weekly_rate,(case when cap>1 then 185 when r.departure_date<(r.arrival_date+interval ''2 months'')::date then 300 else 255 end))');
 if position('Review and approve the online signature' in source)=0 or position('coalesce(r.agreed_weekly_rate' in source)=0 then raise exception 'Manual booking signing guard could not be installed'; end if;
 execute source;
 select pg_get_functiondef('sakan_private.notification_action(uuid,text,text)'::regprocedure) into source;
 source:=replace(source,' if p_action=''claim'' and n.status=''pending'' then',' if p_action=''claim'' and n.status=''pending'' then
  if n.kind=''contract_signing'' and not exists(select 1 from public.contract_signing_requests where id=(n.payload->>''signing_request_id'')::uuid and status=''awaiting_signature'' and expires_at>now()) then raise exception ''Signing invitation expired or was replaced. Create a fresh link''; end if;');
 if position('Signing invitation expired or was replaced' in source)=0 then raise exception 'Signing invitation guard could not be installed'; end if;
 execute source;
end $$;
create function sakan_private.supersede_signing_links() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='superseded' and old.status<>'superseded' then
  update public.contract_signing_requests set status='superseded' where contract_id=new.id and status in ('awaiting_signature','processing','signed');
  update public.notification_outbox set status='superseded',updated_at=now() where payload->>'contract_id'=new.id::text and kind='contract_signing' and status in ('pending','uncertain');
 end if;
 return new;
end $$;
create trigger signing_contract_superseded after update of status on public.contracts for each row execute function sakan_private.supersede_signing_links();

revoke all on function sakan_private.prepare_contract_signing(uuid,integer,text,text,integer,text),public.prepare_contract_signing(uuid,integer,text,text,integer,text),sakan_private.review_contract_signing(uuid,integer,text,text),public.review_contract_signing(uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function sakan_private.prepare_contract_signing(uuid,integer,text,text,integer,text),public.prepare_contract_signing(uuid,integer,text,text,integer,text),sakan_private.review_contract_signing(uuid,integer,text,text),public.review_contract_signing(uuid,integer,text,text) to authenticated;
revoke all on function sakan_private.contract_signing_public(text,text,jsonb),public.contract_signing_public(text,text,jsonb),sakan_private.supersede_signing_links() from public,anon,authenticated,service_role;
grant execute on function sakan_private.contract_signing_public(text,text,jsonb),public.contract_signing_public(text,text,jsonb) to service_role;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.contract_signing_requests;
 end if;
end $$;
commit;
