begin;
lock table public.people,public.payments,public.charges,public.properties,public.audit in share row exclusive mode;
create temporary table invoice_preservation on commit drop as select
 (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.people p) people_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.payments p) payments_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.properties p) properties_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from public.charges c) charges_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'[]')) from public.audit a) audit_hash;
alter table public.properties add column invoice_address text check(char_length(invoice_address)<=200);
create table sakan_private.invoice_counter(id boolean primary key default true check(id),last_number bigint not null);
insert into sakan_private.invoice_counter values(true,81);
create table sakan_private.rent_invoices(
 id uuid primary key default gen_random_uuid(),number bigint not null unique,payment_id uuid not null references public.payments(id),person_id uuid not null,property_id uuid not null,
 snapshot jsonb not null,status text not null default 'queued' check(status in ('queued','needs_details','preparing','sending','sent','uncertain','void')),
 replaces_number bigint,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 attempt uuid,lease_until timestamptz,attempts integer not null default 0,next_attempt timestamptz not null default now(),pdf_path text,pdf_sha256 text,gmail_id text,last_error text
);
create unique index one_current_rent_invoice on sakan_private.rent_invoices(payment_id) where status<>'void';
create index rent_invoice_queue on sakan_private.rent_invoices(status,next_attempt);
create index rent_invoice_person on sakan_private.rent_invoices(person_id,number desc);
alter table sakan_private.invoice_counter enable row level security;
alter table sakan_private.rent_invoices enable row level security;
revoke all on sakan_private.invoice_counter,sakan_private.rent_invoices from public,anon,authenticated,service_role;

create function sakan_private.invoice_payment(p public.payments) returns jsonb language sql immutable set search_path='' as $$select jsonb_build_object('id',p.id,'person_id',p.person_id,'property_id',p.property_id,'amount',p.amount,'date',p.date,'method',p.method,'kind',p.kind)$$;
revoke all on function sakan_private.invoice_payment(public.payments) from public,anon,authenticated,service_role;

-- Uses the same calendar boundaries and agreed rates as person_due and rentCharges.
create function sakan_private.invoice_rent_periods(p_id uuid,p_until date) returns table(due_date date,period_start date,period_end date,amount numeric,weekly_rate numeric) language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare p public.people; anchor date;s date;e date;nc date;pe date;terms jsonb;first boolean:=true;
begin
 select * into p from public.people where id=p_id;
 if p.checked_out_at is not null and (p.checked_out_at at time zone 'Australia/Adelaide')::date<p.start_date then return;end if;
 if p.stay_type in ('short','per_night') then
  if p.paid_up_to is null or p.paid_up_to<p.start_date then
   due_date:=p.start_date;period_start:=p.start_date;period_end:=coalesce(p.end_date,p.start_date+1)-1;weekly_rate:=null;
   amount:=coalesce(p.first_charge_amount,round(greatest(1,coalesce(p.end_date,p.start_date+1)-p.start_date)*coalesce(p.nightly_rate,0),2));
   if due_date<=p_until then return next;end if;
  end if;return;
 end if;
 s:=greatest(coalesce(p.paid_up_to+1,p.start_date),p.start_date,'2026-07-01'::date);e:=coalesce(p.end_date,'infinity'::date);
 while s<e and s<=p_until loop
  select value into terms from jsonb_array_elements(p.billing_schedule) where (value->>'effective_from')::date<=s order by value->>'effective_from' desc limit 1;
  weekly_rate:=coalesce((terms->>'weekly_rate')::numeric,p.weekly_rate);
  select coalesce(case when terms is null then p.rent_cycle_anchor else (terms->>'rent_cycle_anchor')::date end,lease_anchor) into anchor from public.properties where id=p.property_id;
  nc:=s+((anchor-s)%14+14)%14;pe:=least(case when nc>s then nc else s+14 end,e);
  if (nc>s or p.rent_cycle_anchor is not null) and first and p.paid_up_to is null and s=p.start_date and p.first_charge_amount is not null then amount:=p.first_charge_amount;
  else amount:=case when pe-s=14 then weekly_rate*2 else floor((weekly_rate/7*(pe-s))/5)*5 end;end if;
  due_date:=s;period_start:=s;period_end:=pe-1;return next;s:=pe;first:=false;
 end loop;
end $$;
revoke all on function sakan_private.invoice_rent_periods(uuid,date) from public,anon,authenticated,service_role;

create function sakan_private.invoice_snapshot(pay public.payments) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.people;house public.properties;room text;addr text;cc jsonb;credit numeric;remaining numeric:=pay.amount;allocated numeric;line record;lines jsonb:='[]';today date:=(now() at time zone 'Australia/Adelaide')::date;
begin
 select * into p from public.people where id=pay.person_id;select * into house from public.properties where id=pay.property_id;
 select label into room from public.rooms where id=p.room_id;
 select coalesce(nullif(trim(house.invoice_address),''),nullif(trim(premises_address),'')) into addr from (select 1) seed left join public.contract_defaults d on d.property_id=house.id;
 select coalesce(jsonb_agg(email order by email),'[]') into cc from (select distinct lower(email) email from auth.users u join public.staff_access a on a.user_id=u.id where email_confirmed_at is not null union select 'sakanlodges@gmail.com') x;
 select coalesce(sum(amount),0) into credit from public.payments where person_id=p.id and id<>pay.id and kind in ('rent','bond_applied') and date<=today;
 select credit-coalesce(sum(amount),0) into credit from public.charges where person_id=p.id and due_date<=today and amount<0;
 for line in
  select * from (
   select r.due_date,r.period_start,r.period_end,r.amount,r.weekly_rate,'Accommodation rent'::text description,1 priority from sakan_private.invoice_rent_periods(p.id,today+730) r
   union all select c.due_date,c.period_start,c.period_end,c.amount,null,'Account charge',2 from public.charges c where c.person_id=p.id and c.amount>0 and c.due_date<=today
   union all select coalesce(p.created_at::date,p.start_date),null,null,p.opening_balance,null,'Opening balance',0 where p.opening_balance>0 and coalesce(p.created_at::date,p.start_date)<=today
  ) charges order by due_date,priority,period_start
 loop
  if credit>=line.amount then credit:=credit-line.amount;continue;end if;
  allocated:=least(remaining,line.amount-greatest(credit,0));credit:=0;
  if allocated>0 then lines:=lines||jsonb_build_array(jsonb_build_object('description',line.description,'period_start',line.period_start,'period_end',line.period_end,'charge_amount',line.amount,'weekly_rate',line.weekly_rate,'amount',allocated));remaining:=remaining-allocated;end if;
  exit when remaining<=0;
 end loop;
 if remaining>0 then lines:=lines||jsonb_build_array(jsonb_build_object('description','Rent credit - not yet allocated to a period','amount',remaining));end if;
 return jsonb_build_object('tenant_name',p.name,'tenant_email',lower(trim(p.email)),'address',addr,'property',house.name,'room',room,'payment',sakan_private.invoice_payment(pay),'lines',lines,'cc',cc,'issued_date',today,'handled_by',pay.received_by);
end $$;
revoke all on function sakan_private.invoice_snapshot(public.payments) from public,anon,authenticated,service_role;

create function sakan_private.queue_rent_invoice() returns trigger language plpgsql security definer set search_path='' as $$
declare prior sakan_private.rent_invoices;num bigint;doc uuid;
begin
 if tg_op='UPDATE' and sakan_private.invoice_payment(old)=sakan_private.invoice_payment(new) then return new;end if;
 if tg_op='DELETE' or tg_op='UPDATE' then
  select * into prior from sakan_private.rent_invoices where payment_id=old.id and status<>'void' for update;
  if prior.id is null then return case when tg_op='DELETE' then old else new end;end if;
  if tg_op='DELETE' then raise exception 'An invoiced payment cannot be deleted. Correct it with an audited replacement';end if;
  if prior.status in ('preparing','sending','uncertain') then raise exception 'Invoice delivery is active or uncertain. Reconcile its status before correcting the payment';end if;
  update sakan_private.rent_invoices set status='void',updated_at=now(),last_error='Payment corrected; original document retained' where id=prior.id;
 end if;
 if new.kind<>'rent' then return new;end if;
 update sakan_private.invoice_counter set last_number=last_number+1 where id returning last_number into num;
 insert into sakan_private.rent_invoices(number,payment_id,person_id,property_id,snapshot,replaces_number) values(num,new.id,new.person_id,new.property_id,sakan_private.invoice_snapshot(new),prior.number) returning id into doc;
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id) values(coalesce(auth.jwt()->>'email','system'),'rent_invoice_queued #'||num,new.person_id,(select name from public.people where id=new.person_id),'rent_invoice',doc::text);
 return new;
end $$;
revoke all on function sakan_private.queue_rent_invoice() from public,anon,authenticated,service_role;
create trigger queue_rent_invoice after insert or update or delete on public.payments for each row execute function sakan_private.queue_rent_invoice();

-- The service credential is confined to the production Worker. Browser staff
-- may list/reconcile invoices, but cannot claim or fabricate worker sends.
create function sakan_private.invoice_worker(p_action text,p_id uuid default null,p_attempt uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare inv sakan_private.rent_invoices;pay public.payments;missing text;
begin
 if p_action='pending' then
  update sakan_private.rent_invoices set status='uncertain',last_error='Sending confirmation expired. Check Gmail Sent Mail before any retry.',updated_at=now() where status='sending' and lease_until<now();
  return (select coalesce(jsonb_agg(id),'[]') from (select id from sakan_private.rent_invoices where (status='queued' and next_attempt<=now() and attempts<5) or (status='preparing' and lease_until<now()) order by number limit 5) x);
 end if;
 select * into inv from sakan_private.rent_invoices where id=p_id for update;
 if not found then raise exception 'Invoice not found';end if;
 if p_action='prepare' then
  if not(inv.status='queued' and inv.next_attempt<=now() and inv.attempts<5 or inv.status='preparing' and inv.lease_until<now()) then return jsonb_build_object('skipped',true);end if;
  select * into pay from public.payments where id=inv.payment_id;
  if sakan_private.invoice_payment(pay) is distinct from inv.snapshot->'payment' then raise exception 'Payment no longer matches invoice';end if;
  -- Only missing contact/address fields may be completed before first issue.
  if inv.pdf_path is null then
  inv.snapshot:=jsonb_set(inv.snapshot,'{tenant_email}',coalesce((select to_jsonb(lower(trim(email))) from public.people where id=inv.person_id),'null'));
  inv.snapshot:=jsonb_set(inv.snapshot,'{cc}',(select coalesce(jsonb_agg(email order by email),'[]') from (select distinct lower(email) email from auth.users u join public.staff_access a on a.user_id=u.id where email_confirmed_at is not null union select 'sakanlodges@gmail.com') x));
  if nullif(trim(inv.snapshot->>'address'),'') is null then inv.snapshot:=jsonb_set(inv.snapshot,'{address}',coalesce((select to_jsonb(coalesce(nullif(trim(p.invoice_address),''),nullif(trim(d.premises_address),''))) from public.properties p left join public.contract_defaults d on d.property_id=p.id where p.id=inv.property_id),'null'));end if;
  end if;
  if jsonb_array_length(inv.snapshot->'cc')<>3 then missing:='Both verified administrator copy addresses are required';
  elsif nullif(trim(inv.snapshot->>'address'),'') is null then missing:='Add the verified invoice address in property settings';
  elsif coalesce(inv.snapshot->>'tenant_email','') !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' or inv.snapshot->>'tenant_email'='sakanlodges@gmail.com' then missing:='Add a valid tenant email before sending';end if;
  if missing is not null then update sakan_private.rent_invoices set snapshot=inv.snapshot,status='needs_details',last_error=missing,updated_at=now() where id=inv.id;return jsonb_build_object('skipped',true,'error',missing);end if;
  if p_attempt is null then raise exception 'Attempt key required';end if;
  update sakan_private.rent_invoices set snapshot=inv.snapshot,status='preparing',attempt=p_attempt,attempts=attempts+1,lease_until=now()+interval '10 minutes',updated_at=now(),last_error=null where id=inv.id returning * into inv;
  return to_jsonb(inv);
 end if;
 if inv.attempt is distinct from p_attempt then raise exception 'Invoice claim changed';end if;
 if p_action='begin_send' then
  if inv.status<>'preparing' or inv.lease_until<now() then raise exception 'Invoice claim expired';end if;
  if inv.pdf_path is not null then
   if p_data->>'path' is distinct from inv.pdf_path or p_data->>'sha256' is distinct from inv.pdf_sha256 then raise exception 'Archived invoice PDF must remain unchanged';end if;
  elsif coalesce(p_data->>'path','') <> 'invoices/'||inv.id||'/'||p_attempt||'.pdf' or coalesce(p_data->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid immutable PDF reference';end if;
  update sakan_private.rent_invoices set status='sending',pdf_path=p_data->>'path',pdf_sha256=p_data->>'sha256',lease_until=now()+interval '10 minutes',updated_at=now() where id=inv.id returning * into inv;
 elsif p_action='sent' then
  if inv.status not in ('sending','uncertain') or nullif(p_data->>'message_id','') is null then raise exception 'Invoice cannot be marked sent';end if;
  update sakan_private.rent_invoices set status='sent',gmail_id=p_data->>'message_id',last_error=null,updated_at=now(),lease_until=null where id=inv.id returning * into inv;
 elsif p_action='uncertain' then
  if inv.status='sent' then return to_jsonb(inv);end if;
  if inv.status<>'sending' then raise exception 'Sending was not started';end if;
  update sakan_private.rent_invoices set status='uncertain',last_error='Check Gmail Sent Mail before retrying invoice #'||inv.number,updated_at=now() where id=inv.id returning * into inv;
 elsif p_action='prepare_failed' then
  if inv.status<>'preparing' then raise exception 'Preparation is no longer active';end if;
  update sakan_private.rent_invoices set status='queued',next_attempt=now()+interval '5 minutes',last_error='Invoice preparation failed; check PDF, storage and Gmail configuration',lease_until=null,updated_at=now() where id=inv.id returning * into inv;
 else raise exception 'Unknown invoice worker action';end if;
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id,reason) values('system','rent_invoice_'||p_action||' #'||inv.number,inv.person_id,inv.snapshot->>'tenant_name','rent_invoice',inv.id::text,jsonb_build_object('to',inv.snapshot->>'tenant_email','cc',inv.snapshot->'cc','gmail_id',inv.gmail_id,'attempt',p_attempt)::text);
 return to_jsonb(inv);
end $$;
create function public.rent_invoice_worker(p_action text,p_id uuid default null,p_attempt uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select sakan_private.invoice_worker(p_action,p_id,p_attempt,p_data)$$;
revoke all on function sakan_private.invoice_worker(text,uuid,uuid,jsonb),public.rent_invoice_worker(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function sakan_private.invoice_worker(text,uuid,uuid,jsonb),public.rent_invoice_worker(text,uuid,uuid,jsonb) to service_role;

create function sakan_private.staff_invoices(p_person uuid default null,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform sakan_private.require_staff();
 return (select coalesce(jsonb_agg(to_jsonb(x) order by number desc),'[]') from (select i.id,i.number,i.payment_id,i.person_id,i.snapshot,i.status,i.replaces_number,i.created_at,i.pdf_path,i.gmail_id,i.last_error,i.attempts,(select coalesce(jsonb_agg(jsonb_build_object('at',a.at,'by',a."by",'action',a.action,'reason',a.reason) order by a.at,a.id),'[]') from public.audit a where a.entity_table='rent_invoice' and a.entity_id=i.id::text) events from sakan_private.rent_invoices i where p_person is null or i.person_id=p_person order by number desc limit 50 offset greatest(0,p_offset)) x);
end $$;
create function public.staff_rent_invoices(p_person uuid default null,p_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select sakan_private.staff_invoices(p_person,p_offset)$$;
create function sakan_private.staff_invoice_action(p_id uuid,p_action text,p_reason text default null,p_message text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv sakan_private.rent_invoices;
begin
 perform sakan_private.require_staff();select * into inv from sakan_private.rent_invoices where id=p_id for update;
 if not found then raise exception 'Invoice not found';end if;
 if p_action='get' then return to_jsonb(inv);end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Enter a reconciliation reason';end if;
 if p_action='resend' and inv.status='sent' and inv.pdf_path is not null then
  if inv.updated_at>now()-interval '1 minute' then raise exception 'Wait one minute before requesting another copy';end if;
  update sakan_private.rent_invoices set status='queued',attempts=0,next_attempt=now(),last_error=null,updated_at=now() where id=p_id;
 elsif p_action='retry_pending' and inv.status in ('needs_details','queued') then
  update sakan_private.rent_invoices set status='queued',attempts=0,next_attempt=now(),last_error=null,updated_at=now() where id=p_id;
 elsif p_action='confirmed_not_sent' and inv.status='uncertain' then
  update sakan_private.rent_invoices set status='queued',attempts=0,next_attempt=now(),last_error=null,updated_at=now() where id=p_id;
 elsif p_action='confirmed_sent' and inv.status='uncertain' and nullif(trim(p_message),'') is not null then
  update sakan_private.rent_invoices set status='sent',gmail_id=trim(p_message),last_error=null,updated_at=now() where id=p_id;
 else raise exception 'Invoice status changed. Refresh and review delivery first';end if;
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id,reason) values(auth.uid()::text,'rent_invoice_'||p_action||' #'||inv.number,inv.person_id,inv.snapshot->>'tenant_name','rent_invoice',inv.id::text,trim(p_reason));
 return (select to_jsonb(i) from sakan_private.rent_invoices i where id=p_id);
end $$;
create function public.staff_rent_invoice_action(p_id uuid,p_action text,p_reason text default null,p_message text default null) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.staff_invoice_action(p_id,p_action,p_reason,p_message)$$;
revoke all on function sakan_private.staff_invoices(uuid,integer),public.staff_rent_invoices(uuid,integer),sakan_private.staff_invoice_action(uuid,text,text,text),public.staff_rent_invoice_action(uuid,text,text,text) from public,anon,service_role;
grant execute on function sakan_private.staff_invoices(uuid,integer),public.staff_rent_invoices(uuid,integer),sakan_private.staff_invoice_action(uuid,text,text,text),public.staff_rent_invoice_action(uuid,text,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('rent-invoices','rent-invoices',false,10485760,array['application/pdf']);
create policy staff_invoice_read on storage.objects for select to authenticated using(bucket_id='rent-invoices' and public.is_sakan_staff());
-- Worker uploads use the server-only service credential, never browser keys.
do $$declare b record;begin
 select * into b from invoice_preservation;
 if b.people_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.people p)
 or b.payments_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.payments p)
 or b.properties_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p)-'invoice_address' order by id)::text,'[]')) from public.properties p)
 or b.charges_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from public.charges c)
 or b.audit_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'[]')) from public.audit a)
 or exists(select 1 from sakan_private.rent_invoices) then raise exception 'Invoice migration changed historical records';end if;
end $$;
commit;
