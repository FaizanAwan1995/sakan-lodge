-- Extend the existing staff-only, idempotent settlement action; preserve all existing records and grants.
begin;
create or replace function sakan_private.settle_tenant_bond(p_request uuid,p_person uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.people; cached sakan_private.account_requests; payload jsonb; result jsonb; held numeric; due numeric; applied numeric; refunded numeric; retained numeric; retain_reason text; retained_id uuid; day date:=(now() at time zone 'Australia/Adelaide')::date; reason text; applied_id uuid; refund_id uuid;
begin
 perform sakan_private.require_staff();
 if p_request is null then raise exception 'Request key required';end if;
 payload:=jsonb_build_object('operation','settle_bond','person',p_person,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into cached from sakan_private.account_requests where request_id=p_request;
 if found then
  if cached.actor<>auth.uid() or cached.payload is distinct from payload then raise exception 'Request key already used with different details';end if;
  return cached.result;
 end if;
 select * into person from public.people where id=p_person for update;
 if not found then raise exception 'Tenant not found';end if;
 applied:=(p_data->>'apply_amount')::numeric;refunded:=(p_data->>'refund_amount')::numeric;reason:=trim(p_data->>'reason');
 retained:=coalesce((p_data->>'retain_amount')::numeric,0);retain_reason:=trim(p_data->>'retain_reason');
 if applied is null or refunded is null or applied<0 or refunded<0 or retained<0 or applied+refunded+retained<=0 or applied<>round(applied,2) or refunded<>round(refunded,2) or applied::text in ('NaN','Infinity','-Infinity') or refunded::text in ('NaN','Infinity','-Infinity') or retained<>round(retained,2) or retained::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter valid amounts with at most two decimal places';end if;
 if retained>0 and length(coalesce(retain_reason,''))<5 then raise exception 'Enter a reason for the other bond deduction';end if;
 if length(coalesce(reason,''))<5 then raise exception 'Enter a settlement reason';end if;
 if p_data->>'handled_by' is null or p_data->>'handled_by' not in ('Faizan','Danish','Joint account') then raise exception 'Choose the administrator handling settlement';end if;
 if p_data->>'method' is null or p_data->>'method' not in ('cash','transfer') then raise exception 'Choose the actual refund method';end if;
 select coalesce(sum(case when kind='bond' then amount when kind in ('bond_refund','bond_deducted','bond_applied') then -amount else 0 end),0) into held from public.payments where person_id=person.id and date<=day;
 due:=sakan_private.person_due(person.id);
 if held is distinct from (p_data->>'expected_held')::numeric or due is distinct from (p_data->>'expected_owed')::numeric then raise exception 'Account balance changed. Refresh before settling' using errcode='40001';end if;
 if applied>due then raise exception 'Amount applied cannot exceed outstanding rent and charges';end if;
 if applied+refunded+retained>held then raise exception 'Settlement exceeds recorded bond held. Reconcile the original receipt first';end if;
 perform set_config('sakan.change_reason',reason,true);
 perform set_config('sakan.bond_settlement',p_request::text,true);
 if applied>0 then
  insert into public.payments(person_id,property_id,date,amount,method,kind,received_by,note,settlement_id)
  values(person.id,person.property_id,day,applied,'adjustment','bond_applied',p_data->>'handled_by',reason,p_request) returning id into applied_id;
 end if;
 if retained>0 then
  insert into public.payments(person_id,property_id,date,amount,method,kind,received_by,note,settlement_id)
  values(person.id,person.property_id,day,retained,'adjustment','bond_deducted',p_data->>'handled_by',retain_reason,p_request) returning id into retained_id;
 end if;
 if refunded>0 then
  insert into public.payments(person_id,property_id,date,amount,method,kind,received_by,note,settlement_id)
  values(person.id,person.property_id,day,refunded,p_data->>'method','bond_refund',p_data->>'handled_by',reason,p_request) returning id into refund_id;
 end if;
 result:=jsonb_build_object('applied',applied,'refunded',refunded,'retained',retained,'bond_held',held-applied-refunded-retained,'owed',sakan_private.person_due(person.id),'settlement_id',p_request,'applied_id',applied_id,'refund_id',refund_id,'retained_id',retained_id,'date',day);
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id,before_values,after_values,reason)
 values(auth.uid()::text,'bond_settled',person.id,person.name,'bond_settlement',p_request::text,jsonb_build_object('bond_held',held,'owed',due),result,reason);
 insert into sakan_private.account_requests(request_id,actor,payload,result) values(p_request,auth.uid(),payload,result);
 return result;
end $$;
commit;
