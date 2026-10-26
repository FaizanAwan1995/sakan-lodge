begin;
create function sakan_private.receipt_snapshot(pay public.payments) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.people;house public.properties;room text;addr text;cc jsonb;credit numeric;remaining numeric:=pay.amount;allocated numeric;line record;lines jsonb:='[]';today date:=pay.date;
begin
 select * into p from public.people where id=pay.person_id;select * into house from public.properties where id=pay.property_id;
 select label into room from public.rooms where id=p.room_id;
 select coalesce(nullif(trim(house.invoice_address),''),nullif(trim(premises_address),'')) into addr from (select 1) seed left join public.contract_defaults d on d.property_id=house.id;
 select coalesce(jsonb_agg(email order by email),'[]') into cc from (select distinct lower(email) email from auth.users u join public.staff_access a on a.user_id=u.id where email_confirmed_at is not null union select 'sakanlodges@gmail.com') x;
 select coalesce(sum(amount),0) into credit from public.payments where person_id=p.id and kind in ('rent','bond_applied') and (date,created_at,id)<(pay.date,pay.created_at,pay.id);
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
 return jsonb_build_object('tenant_name',p.name,'tenant_email',lower(trim(p.email)),'address',addr,'property',house.name,'room',room,'payment',sakan_private.invoice_payment(pay),'lines',lines,'cc',cc,'issued_date',(now() at time zone 'Australia/Adelaide')::date,'handled_by',pay.received_by);
end $$;
revoke all on function sakan_private.receipt_snapshot(public.payments) from public,anon,authenticated,service_role;


-- Previewing old receipts never numbers, emails or changes payment records.
create function sakan_private.payment_receipt(p_payment uuid,p_action text default 'preview',p_start date default null,p_end date default null,p_expected jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare pay public.payments;inv sakan_private.rent_invoices;doc jsonb;num bigint;p public.people;rate numeric;
begin
 perform sakan_private.require_staff();
 if p_action not in ('preview','issue') then raise exception 'Unknown receipt action';end if;
 select * into pay from public.payments where id=p_payment for update;
 if not found or pay.kind<>'rent' or pay.amount<=0 then raise exception 'Choose a recorded rent payment';end if;
 if pay.date>(now() at time zone 'Australia/Adelaide')::date then raise exception 'Future payments cannot be receipted';end if;
 select * into inv from sakan_private.rent_invoices where payment_id=pay.id and status<>'void';
 if found then return to_jsonb(inv)||jsonb_build_object('existing',true);end if;
 select * into p from public.people where id=pay.person_id;
 doc:=sakan_private.receipt_snapshot(pay);
 if (p_start is null)<>(p_end is null) then raise exception 'Enter both rent period dates';end if;
 if p_start is not null then
  if p_start<p.start_date or p_end<p_start or p_end-p_start>365 or (p.end_date is not null and p_end>=p.end_date) then raise exception 'Choose a valid rent period within the recorded stay';end if;
  -- Preserve the payment amount; staff confirms the covered period explicitly.
  select coalesce((value->>'weekly_rate')::numeric,p.weekly_rate) into rate from jsonb_array_elements(p.billing_schedule) where (value->>'effective_from')::date<=p_start order by value->>'effective_from' desc limit 1;
  doc:=jsonb_set(doc,'{lines}',jsonb_build_array(jsonb_build_object('description','Accommodation rent (confirmed historical period)','period_start',p_start,'period_end',p_end,'amount',pay.amount,'weekly_rate',coalesce(rate,p.weekly_rate))));
 end if;
 doc:=doc||jsonb_build_object('historical_receipt',true,'source_note',pay.note);
 if p_action='preview' then return jsonb_build_object('number','DRAFT','snapshot',doc,'existing',false);end if;
 if exists(select 1 from jsonb_array_elements(doc->'lines') l where l->>'period_start' is null or l->>'period_end' is null) then raise exception 'Confirm the covered rent period using From and To dates';end if;
 if p_expected is null or p_expected is distinct from doc then raise exception 'Payment or contact details changed. Review the preview again';end if;
 if nullif(trim(doc->>'address'),'') is null then raise exception 'Add the verified invoice address in property settings';end if;
 if coalesce(doc->>'tenant_email','') !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' or doc->>'tenant_email'='sakanlodges@gmail.com' then raise exception 'Add a valid tenant email first';end if;
 if jsonb_array_length(doc->'cc')<>3 then raise exception 'Both verified administrator copy addresses are required';end if;
 update sakan_private.invoice_counter set last_number=last_number+1 where id returning last_number into num;
 insert into sakan_private.rent_invoices(number,payment_id,person_id,property_id,snapshot) values(num,pay.id,pay.person_id,pay.property_id,doc) returning * into inv;
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id,reason) values(auth.uid()::text,'rent_invoice_historical_queued #'||num,pay.person_id,p.name,'rent_invoice',inv.id::text,'Admin reviewed the recorded payment and confirmed the receipt period and recipients');
 return to_jsonb(inv)||jsonb_build_object('existing',false);
end $$;
create function public.staff_payment_receipt(p_payment uuid,p_action text default 'preview',p_start date default null,p_end date default null,p_expected jsonb default null) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.payment_receipt(p_payment,p_action,p_start,p_end,p_expected)$$;
revoke all on function sakan_private.payment_receipt(uuid,text,date,date,jsonb),public.staff_payment_receipt(uuid,text,date,date,jsonb) from public,anon,service_role;
grant execute on function sakan_private.payment_receipt(uuid,text,date,date,jsonb),public.staff_payment_receipt(uuid,text,date,date,jsonb) to authenticated;
commit;
