begin;
alter table public.payments add column referral_credit numeric not null default 0 check (referral_credit>=0 and referral_credit<=99999999 and referral_credit=round(referral_credit,2) and (referral_credit=0 or kind='rent'));
alter table public.payments add column referred_person text check (length(referred_person)<=120);
alter table public.charges add column referral_payment_id uuid unique references public.payments(id);
-- Sync before the invoice snapshot is queued; both writes roll back together.
create function sakan_private.sync_referral_credit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.referral_credit>0 then
  insert into public.charges(person_id,kind,due_date,amount,note,referral_payment_id)
  values(new.person_id,'adjustment',new.date,-new.referral_credit,'Referral credit' || coalesce(' - referred '||nullif(new.referred_person,''),''),new.id)
  on conflict (referral_payment_id) do update set person_id=excluded.person_id,due_date=excluded.due_date,amount=excluded.amount,note=excluded.note;
 else
  update public.charges set amount=0,note='Referral credit removed by payment correction' where referral_payment_id=new.id;
 end if;
 return new;
end $$;
revoke all on function sakan_private.sync_referral_credit() from public,anon,authenticated,service_role;
create trigger apply_referral_credit after insert or update on public.payments for each row execute function sakan_private.sync_referral_credit();

CREATE OR REPLACE FUNCTION sakan_private.account_transaction(p_request uuid, p_person uuid, p_data jsonb, p_expected jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare p public.people; old_payment public.payments; saved public.payments; charge public.charges; cached sakan_private.account_requests;
 payload jsonb; result jsonb; amount numeric; kind text; day date; held numeric; referral numeric;
begin
 perform sakan_private.require_staff();
 if p_request is null then raise exception 'A request key is required';end if;
 payload:=jsonb_build_object('person',p_person,'data',p_data,'expected',p_expected,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into cached from sakan_private.account_requests where request_id=p_request;
 if found then
  if cached.actor<>auth.uid() or cached.payload is distinct from payload then raise exception 'Request key already used with different details';end if;
  return cached.result;
 end if;
 select * into p from public.people where id=p_person for update;
 if not found then raise exception 'Tenant not found';end if;
 amount:=(p_data->>'amount')::numeric;kind:=p_data->>'kind';day:=(p_data->>'date')::date;
 if amount is null or amount<=0 or amount<>round(amount,2) or amount>99999999 then raise exception 'Enter a positive amount with at most two decimal places';end if;
 if day is null or day>(now() at time zone 'Australia/Adelaide')::date then raise exception 'Transaction date cannot be in the future';end if;
 if kind is null or kind not in ('rent','bond','bond_refund','bond_deducted','charge') then raise exception 'Invalid transaction type';end if;
 if kind='charge' or p_expected is not null then
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'A correction or charge needs a reason';end if;
 end if;
 referral:=coalesce((p_data->>'referral_credit')::numeric,0);
 if referral<0 or referral>99999999 or referral<>round(referral,2) or referral::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid referral credit';end if;
 if referral>0 and kind<>'rent' then raise exception 'Referral credits apply only to rent';end if;
 if length(coalesce(p_data->>'referred_person',''))>120 then raise exception 'Referral name is too long';end if;
 perform set_config('sakan.change_reason',coalesce(trim(p_reason),''),true);
 if kind='charge' then
  if p_expected is not null then raise exception 'Charges are corrected with an adjustment, never overwritten';end if;
  insert into public.charges(person_id,kind,due_date,amount,note) values(p.id,'adjustment',day,amount,trim(p_reason)) returning * into charge;
  result:=to_jsonb(charge);
 else
  if p_data->>'method' is null or p_data->>'method' not in ('cash','transfer') then raise exception 'Choose cash or transfer';end if;
  if p_data->>'received_by' is null or p_data->>'received_by' not in ('Danish','Faizan','Joint account') then raise exception 'Choose who received the money';end if;
  if p_expected is not null then
   select * into old_payment from public.payments where id=(p_expected->>'id')::uuid and person_id=p.id for update;
   if old_payment.settlement_id is not null then raise exception 'Settlement entries cannot be overwritten. Reconcile through an audited adjustment';end if; if not found or to_jsonb(old_payment) is distinct from p_expected then raise exception 'Payment changed. Reload before correcting it' using errcode='40001';end if;
  end if;
  -- Check the entire dated bond history after the proposed correction. A later
  -- receipt must not fund an earlier refund, or hide an invalid later refund.
  if kind in ('bond','bond_refund','bond_deducted','bond_applied') or old_payment.kind in ('bond','bond_refund','bond_deducted','bond_applied') then
  select min(balance) into held from (
   select sum(case when entries.kind='bond' then entries.amount else -entries.amount end) over(order by date) balance from (
    select pay.date,pay.kind,pay.amount from public.payments pay where pay.person_id=p.id and pay.kind in ('bond','bond_refund','bond_deducted','bond_applied') and (old_payment.id is null or pay.id<>old_payment.id)
    union all select day,kind,amount where kind in ('bond','bond_refund','bond_deducted','bond_applied')
   ) entries
  ) balances;
  if held < -0.005 then raise exception 'This would refund or retain more bond than recorded as received';end if;
  end if;
  if old_payment.id is null then
   insert into public.payments(person_id,property_id,date,amount,method,kind,received_by,note,referral_credit,referred_person)
   values(p.id,p.property_id,day,amount,p_data->>'method',kind,p_data->>'received_by',p_data->>'note',referral,nullif(trim(p_data->>'referred_person'),'')) returning * into saved;
  else
   update public.payments set date=day,amount=amount,method=p_data->>'method',kind=kind,received_by=p_data->>'received_by',note=p_data->>'note',referral_credit=referral,referred_person=nullif(trim(p_data->>'referred_person'),'')
   where id=old_payment.id returning * into saved;
  end if;
  result:=to_jsonb(saved);
 end if;
 insert into sakan_private.account_requests(request_id,actor,payload,result) values(p_request,auth.uid(),payload,result);
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION sakan_private.invoice_payment(p payments)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$select jsonb_build_object('id',p.id,'person_id',p.person_id,'property_id',p.property_id,'amount',p.amount,'date',p.date,'method',p.method,'kind',p.kind,'referral_credit',p.referral_credit,'referred_person',p.referred_person)$function$
;
CREATE OR REPLACE FUNCTION sakan_private.invoice_snapshot(pay payments)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.people;house public.properties;room text;addr text;cc jsonb;credit numeric;remaining numeric:=pay.amount+pay.referral_credit;allocated numeric;line record;lines jsonb:='[]';today date:=(now() at time zone 'Australia/Adelaide')::date;
begin
 select * into p from public.people where id=pay.person_id;select * into house from public.properties where id=pay.property_id;
 select label into room from public.rooms where id=p.room_id;
 select coalesce(nullif(trim(house.invoice_address),''),nullif(trim(premises_address),'')) into addr from (select 1) seed left join public.contract_defaults d on d.property_id=house.id;
 select coalesce(jsonb_agg(email order by email),'[]') into cc from (select distinct lower(email) email from auth.users u join public.staff_access a on a.user_id=u.id where email_confirmed_at is not null union select 'sakanlodges@gmail.com') x;
 select coalesce(sum(amount),0) into credit from public.payments where person_id=p.id and id<>pay.id and kind in ('rent','bond_applied') and date<=today;
 select credit-coalesce(sum(amount),0) into credit from public.charges where person_id=p.id and due_date<=today and amount<0 and referral_payment_id is distinct from pay.id;
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
 return jsonb_build_object('tenant_name',p.name,'tenant_email',lower(trim(p.email)),'address',addr,'property',house.name,'room',room,'payment',sakan_private.invoice_payment(pay),'lines',lines,'cc',cc,'issued_date',today,'handled_by',pay.received_by,'referral_credit',pay.referral_credit,'referred_person',pay.referred_person,'total_settled',pay.amount+pay.referral_credit);
end $function$
;
commit;
