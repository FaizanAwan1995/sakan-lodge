begin;
alter table sakan_private.rent_invoices alter column payment_id drop not null;
alter table sakan_private.rent_invoices add constraint invoice_payment_or_confirmation check(payment_id is not null or coalesce(snapshot->>'admin_confirmed_period'='true',false));

-- Locking the tenant serializes duplicate historical submissions. Numbering uses
-- the same transactional counter as payment invoices; preview never increments it.
create function sakan_private.past_fortnight_invoice(p_person uuid,p_start date,p_amount numeric,p_reason text,p_action text default 'preview',p_expected jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.people;house public.properties;pay public.payments;doc jsonb;inv sakan_private.rent_invoices;num bigint;rate numeric;today date:=(now() at time zone 'Australia/Adelaide')::date;finish date:=p_start+13;
begin
 perform sakan_private.require_staff();
 if p_action is null or p_action not in ('preview','issue') then raise exception 'Unknown invoice action';end if;
 select * into p from public.people where id=p_person for update;
 if not found then raise exception 'Tenant not found';end if;
 if p_start is null or p_start<p.start_date or finish>today or (p.end_date is not null and finish>=p.end_date) or (p.checked_out_at is not null and finish>=(p.checked_out_at at time zone 'Australia/Adelaide')::date) then raise exception 'Choose a completed fortnight within the recorded stay';end if;
 if p_amount is null or p_amount<=0 or p_amount>100000 or p_amount<>round(p_amount,2) then raise exception 'Enter a valid rent amount';end if;
 if length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>500 then raise exception 'Explain how payment was confirmed (5 to 500 characters)';end if;
 select * into inv from sakan_private.rent_invoices i where i.person_id=p.id and i.status<>'void' and i.snapshot->>'admin_confirmed_period'='true' and i.snapshot->'lines'->0->>'period_start'=p_start::text;
 if found then return to_jsonb(inv)||jsonb_build_object('existing',true);end if;
 if exists(select 1 from sakan_private.rent_invoices i cross join lateral jsonb_array_elements(i.snapshot->'lines') l where i.person_id=p.id and i.status<>'void' and (l->>'period_start')::date<=finish and (l->>'period_end')::date>=p_start) then raise exception 'An invoice already covers this period. Open invoice history to download or resend it';end if;
 -- Construct document details without inserting a payment or altering balances.
 pay.person_id:=p.id;pay.property_id:=p.property_id;pay.amount:=p_amount;pay.date:=today;pay.kind:='rent';pay.method:='admin_confirmed';
 doc:=sakan_private.receipt_snapshot(pay);
 select coalesce((value->>'weekly_rate')::numeric,p.weekly_rate) into rate from jsonb_array_elements(p.billing_schedule) where (value->>'effective_from')::date<=p_start order by value->>'effective_from' desc limit 1;
 doc:=doc||jsonb_build_object('admin_confirmed_period',true,'confirmation_reason',trim(p_reason),'confirmed_by',auth.uid(),'lines',jsonb_build_array(jsonb_build_object('description','Accommodation rent','period_start',p_start,'period_end',finish,'amount',p_amount,'weekly_rate',coalesce(rate,p.weekly_rate))));
 if p_action='preview' then return jsonb_build_object('number','DRAFT','snapshot',doc,'existing',false);end if;
 if p_expected is null or p_expected is distinct from doc then raise exception 'Details changed. Review the preview again';end if;
 if nullif(trim(doc->>'address'),'') is null then raise exception 'Add the verified invoice address in property settings';end if;
 if coalesce(doc->>'tenant_email','') !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' or doc->>'tenant_email'='sakanlodges@gmail.com' then raise exception 'Add a valid tenant email first';end if;
 if jsonb_array_length(doc->'cc')<>3 then raise exception 'Both verified administrator copy addresses are required';end if;
 update sakan_private.invoice_counter set last_number=last_number+1 where id returning last_number into num;
 insert into sakan_private.rent_invoices(number,person_id,property_id,snapshot) values(num,p.id,p.property_id,doc) returning * into inv;
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id,reason) values(auth.uid()::text,'rent_invoice_past_fortnight_queued #'||num,p.id,p.name,'rent_invoice',inv.id::text,trim(p_reason));
 return to_jsonb(inv)||jsonb_build_object('existing',false);
end $$;
create function public.staff_past_fortnight_invoice(p_person uuid,p_start date,p_amount numeric,p_reason text,p_action text default 'preview',p_expected jsonb default null) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.past_fortnight_invoice(p_person,p_start,p_amount,p_reason,p_action,p_expected)$$;
revoke all on function sakan_private.past_fortnight_invoice(uuid,date,numeric,text,text,jsonb),public.staff_past_fortnight_invoice(uuid,date,numeric,text,text,jsonb) from public,anon,service_role;
grant execute on function sakan_private.past_fortnight_invoice(uuid,date,numeric,text,text,jsonb),public.staff_past_fortnight_invoice(uuid,date,numeric,text,text,jsonb) to authenticated;
create or replace function sakan_private.invoice_worker(p_action text,p_id uuid default null,p_attempt uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
  if inv.payment_id is not null then
   select * into pay from public.payments where id=inv.payment_id;
   if sakan_private.invoice_payment(pay) is distinct from inv.snapshot->'payment' then raise exception 'Payment no longer matches invoice';end if;
  elsif inv.snapshot->>'admin_confirmed_period' is distinct from 'true' then raise exception 'Invalid historical invoice';end if;
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

commit;
