begin;
-- Opt-in per-resident cycle; existing records retain the property cycle.
alter table public.people add column rent_cycle_anchor date;
create or replace function sakan_private.person_due(p_id uuid) returns numeric language plpgsql security definer set search_path='' as $$
declare p public.people; anchor date; today date:=(now() at time zone 'Australia/Adelaide')::date; s date; e date; nc date; pe date; total numeric:=0; first boolean:=true; amt numeric;
begin
 select * into p from public.people where id=p_id; select coalesce(p.rent_cycle_anchor,lease_anchor) into anchor from public.properties where id=p.property_id;
 if p.start_date<=today and not(p.checked_out_at is not null and (p.checked_out_at at time zone 'Australia/Adelaide')::date<p.start_date) then
 if p.stay_type in ('short','per_night') then
  if p.paid_up_to is null or p.paid_up_to<p.start_date then total:=coalesce(p.first_charge_amount,round(greatest(1,coalesce(p.end_date,p.start_date+1)-p.start_date)*coalesce(p.nightly_rate,0),2)); end if;
 else
  s:=greatest(coalesce(p.paid_up_to+1,p.start_date),p.start_date,'2026-07-01'::date); e:=coalesce(p.end_date,'infinity'::date);
  while s<e and s<=today loop
   nc:=s+((anchor-s)%14+14)%14;
   pe:=least(case when nc>s then nc else s+14 end,e);
   if (nc>s or p.rent_cycle_anchor is not null) and first and p.paid_up_to is null and s=p.start_date and p.first_charge_amount is not null then amt:=p.first_charge_amount;
   else amt:=case when pe-s=14 then p.weekly_rate*2 else floor((p.weekly_rate/7*(pe-s))/5)*5 end; end if;
   total:=total+coalesce(amt,0);s:=pe;first:=false;
  end loop;
 end if;end if;
 if coalesce(p.opening_balance,0)>0 and coalesce(p.created_at::date,p.start_date)<=today then total:=total+p.opening_balance;end if;
 select total+coalesce(sum(amount),0) into total from public.charges where person_id=p.id and due_date<=today;
 select total-coalesce(sum(amount),0) into total from public.payments where person_id=p.id and coalesce(kind,'rent')='rent' and date<=today;
 return round(greatest(total,0),2);
end $$;
create or replace function sakan_private.update_tenant_details(p_id uuid,p_expected jsonb,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.people; n public.people;
begin
 perform sakan_private.require_staff();
 select * into p from public.people where id=p_id for update;
 if not found then raise exception 'Tenant not found';end if;
 if p_expected is distinct from to_jsonb(p) then raise exception 'Tenant changed. Reload before saving' using errcode='40001';end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'object' then raise exception 'Invalid tenant details';end if;
 if exists(select 1 from jsonb_object_keys(p_changes) k where k<>all(array['name','phone','email','property_id','room_id','stay_type','weekly_rate','nightly_rate','start_date','end_date','paid_up_to','opening_balance','first_charge_amount','rent_cycle_anchor','bond','bond_status','document_url','document_notes'])) then raise exception 'Unsupported tenant field';end if;
 n:=jsonb_populate_record(p,to_jsonb(p)||p_changes);
 update public.people set name=n.name,phone=n.phone,email=n.email,property_id=n.property_id,room_id=n.room_id,stay_type=n.stay_type,weekly_rate=n.weekly_rate,nightly_rate=n.nightly_rate,start_date=n.start_date,end_date=n.end_date,paid_up_to=n.paid_up_to,opening_balance=n.opening_balance,first_charge_amount=n.first_charge_amount,rent_cycle_anchor=n.rent_cycle_anchor,bond=n.bond,bond_status=n.bond_status,document_url=n.document_url,document_notes=n.document_notes where id=p.id returning * into p;
 return to_jsonb(p);
end $$;

commit;
