begin;
-- UUIDs remain the canonical tenant identity. Audit references deliberately have
-- no foreign keys: deleting an unused test record must never cascade into logs.
alter table public.audit add column tenant_id uuid;
alter table public.audit add column tenant_name text;
alter table public.audit add column entity_table text;
alter table public.audit add column entity_id text;
create index audit_tenant_id_idx on public.audit(tenant_id, at desc) where tenant_id is not null;

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare rec jsonb; subject text; person uuid; person_name text;
begin
 rec:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='people' then person:=(rec->>'id')::uuid;person_name:=rec->>'name';
 elsif tg_table_name in ('charges','payments') then
  person:=(rec->>'person_id')::uuid;
  select name into person_name from public.people where id=person;
 end if;
 subject:=coalesce(rec->>'name',rec->>'label',nullif(concat_ws(' ',rec->>'kind',rec->>'category',rec->>'date',rec->>'amount'),''));
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id)
 values(coalesce(auth.jwt()->>'email','system'),lower(tg_op)||' '||tg_table_name||coalesce(': '||left(subject,160),'')||case when person is not null then ' | Tenant ID '||person::text||' | '||coalesce(person_name,'Unknown tenant') else '' end,person,person_name,tg_table_name,rec->>'id');
 return null;
end $$;
revoke all on function public.log_change() from public,anon,authenticated;

create function sakan_private.guard_tenant_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.id is distinct from old.id then raise exception 'Tenant ID is permanent and cannot be changed' using errcode='23514';end if;
  return new;
 end if;
 if exists(select 1 from public.payments where person_id=old.id) or exists(select 1 from public.charges where person_id=old.id) or coalesce(old.opening_balance,0)<>0 or (coalesce(old.bond,0)>0 and old.bond_status in ('paid','held')) then
  raise exception 'Tenant has financial history. Check out the tenant instead of deleting the account' using errcode='23503';
 end if;
 if exists(select 1 from public.reservations where checked_in_person_id=old.id or assigned_people @> jsonb_build_array(old.id)) then
  raise exception 'Tenant is linked to a booking. Check out the tenant; booking and contract history must remain' using errcode='23503';
 end if;
 return old;
end $$;
revoke all on function sakan_private.guard_tenant_identity() from public,anon,authenticated;
create trigger guard_tenant_identity before update or delete on public.people for each row execute function sakan_private.guard_tenant_identity();

-- Optimistic comparison prevents an old edit form restoring a tenant after
-- another administrator checks them out or changes their room/rate.
create function sakan_private.update_tenant_details(p_id uuid,p_expected jsonb,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.people; n public.people;
begin
 perform sakan_private.require_staff();
 select * into p from public.people where id=p_id for update;
 if not found then raise exception 'Tenant not found';end if;
 if p_expected is distinct from to_jsonb(p) then raise exception 'Tenant changed. Reload before saving' using errcode='40001';end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'object' then raise exception 'Invalid tenant details';end if;
 if exists(select 1 from jsonb_object_keys(p_changes) k where k<>all(array['name','phone','email','property_id','room_id','stay_type','weekly_rate','nightly_rate','start_date','end_date','paid_up_to','opening_balance','first_charge_amount','bond','bond_status','document_url','document_notes'])) then raise exception 'Unsupported tenant field';end if;
 n:=jsonb_populate_record(p,to_jsonb(p)||p_changes);
 update public.people set name=n.name,phone=n.phone,email=n.email,property_id=n.property_id,room_id=n.room_id,stay_type=n.stay_type,weekly_rate=n.weekly_rate,nightly_rate=n.nightly_rate,start_date=n.start_date,end_date=n.end_date,paid_up_to=n.paid_up_to,opening_balance=n.opening_balance,first_charge_amount=n.first_charge_amount,bond=n.bond,bond_status=n.bond_status,document_url=n.document_url,document_notes=n.document_notes where id=p.id returning * into p;
 return to_jsonb(p);
end $$;
create function public.update_tenant_details(p_id uuid,p_expected jsonb,p_changes jsonb) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.update_tenant_details(p_id,p_expected,p_changes)$$;
revoke all on function sakan_private.update_tenant_details(uuid,jsonb,jsonb),public.update_tenant_details(uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function sakan_private.update_tenant_details(uuid,jsonb,jsonb),public.update_tenant_details(uuid,jsonb,jsonb) to authenticated;

create function sakan_private.remove_test_tenant(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.people;
begin
 perform sakan_private.require_staff();
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Enter a reason of at least five characters';end if;
 select * into p from public.people where id=p_id for update;
 if not found then raise exception 'Tenant not found';end if;
 -- The shared delete guard checks transactions and bookings for ALL delete paths.
 delete from public.people where id=p.id;
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id)
 values(auth.uid()::text,'removed empty test tenant '||p.name||' | Tenant ID '||p.id||' | reason: '||trim(p_reason),p.id,p.name,'people',p.id::text);
end $$;
create function public.remove_test_tenant(p_id uuid,p_reason text) returns void language sql security invoker set search_path='' as $$select sakan_private.remove_test_tenant(p_id,p_reason)$$;
revoke all on function sakan_private.remove_test_tenant(uuid,text),public.remove_test_tenant(uuid,text) from public,anon,service_role;
grant execute on function sakan_private.remove_test_tenant(uuid,text),public.remove_test_tenant(uuid,text) to authenticated;

-- Audit rows are append-only even when the live record is edited or removed.
create function sakan_private.keep_audit_history() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Activity history cannot be changed or deleted';end $$;
revoke all on function sakan_private.keep_audit_history() from public,anon,authenticated;
create trigger keep_audit_history before update or delete on public.audit for each row execute function sakan_private.keep_audit_history();
commit;
