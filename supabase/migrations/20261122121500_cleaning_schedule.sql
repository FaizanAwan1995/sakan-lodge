create table public.cleaning_shifts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties on delete cascade,
  duty_date date not null,
  first_person uuid not null references public.people on delete cascade,
  second_person uuid not null references public.people on delete cascade,
  complete boolean not null default false,
  remind_now boolean not null default false,
  delivery_key uuid not null default gen_random_uuid() unique,
  version integer not null default 1,
  unique(property_id,duty_date),
  check(first_person <> second_person)
);
alter table public.cleaning_shifts enable row level security;
revoke all on public.cleaning_shifts from public,anon,authenticated;
grant select,delete on public.cleaning_shifts to authenticated;
grant insert(property_id,duty_date,first_person,second_person,complete),
      update(property_id,duty_date,first_person,second_person,complete,remind_now)
      on public.cleaning_shifts to authenticated;
grant select on public.cleaning_shifts to service_role;
create policy cleaning_staff on public.cleaning_shifts for all to authenticated
 using ((select public.is_sakan_staff())) with check ((select public.is_sakan_staff()));

create function sakan_private.validate_cleaning_shift() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' or (new.property_id,new.duty_date,new.first_person,new.second_person) is distinct from
 (old.property_id,old.duty_date,old.first_person,old.second_person) then
   if (select count(*) from public.people p where p.id in (new.first_person,new.second_person)
       and p.property_id=new.property_id and p.start_date<=new.duty_date
       and (p.end_date is null or p.end_date>=new.duty_date)
       and (p.checked_out_at is null or (p.checked_out_at at time zone 'Australia/Adelaide')::date>new.duty_date))<>2 then
     raise exception 'Choose two residents staying at this property on the cleaning date.';
   end if;
   new.delivery_key:=gen_random_uuid();
   new.remind_now:=false;
 end if;
 if tg_op='UPDATE' then new.version:=old.version+1; end if;
 return new;
end $$;
create trigger validate_cleaning before insert or update on public.cleaning_shifts
 for each row execute function sakan_private.validate_cleaning_shift();

alter table public.incoming_alert_deliveries drop constraint incoming_alert_deliveries_kind_check;
alter table public.incoming_alert_deliveries add constraint incoming_alert_deliveries_kind_check check
 (kind in ('reservation','enquiry','signing_received','signing_approved','signing_rejected','checkout_thanks','cleaning'));
create view sakan_private.due_cleaning_emails as
 select s.delivery_key,lower(trim(p.email)) recipient,p.name resident,h.name house,s.duty_date
 from public.cleaning_shifts s join public.properties h on h.id=s.property_id
 join public.people p on p.id in (s.first_person,s.second_person) and p.property_id=s.property_id
 where not s.complete and p.checked_out_at is null and p.start_date<=s.duty_date
 and (p.end_date is null or p.end_date>=s.duty_date)
 and trim(p.email) ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
 and s.duty_date >= (now() at time zone 'Australia/Adelaide')::date
 and (s.remind_now or (s.duty_date + time '09:00') at time zone 'Australia/Adelaide' <= now());
revoke all on sakan_private.due_cleaning_emails from public,anon,authenticated;
grant select on sakan_private.due_cleaning_emails to service_role;

create function sakan_private.queue_cleaning_emails() returns void language plpgsql set search_path='' as $$
begin
 update public.incoming_alert_deliveries d set status='cancelled',updated_at=now()
 where kind='cleaning' and status='pending' and not exists(select 1 from sakan_private.due_cleaning_emails e
 where e.delivery_key=d.source_id and e.recipient=d.recipient);
 insert into public.incoming_alert_deliveries(source_id,kind,recipient,reply_to,subject,body)
 select e.delivery_key,'cleaning',e.recipient,'sakanlodges@gmail.com',
 'SAKAN Lodge cleaning reminder | '||e.house||' | '||to_char(e.duty_date,'DD Mon'),
 format(E'Hi %s,\n\nYou are on the %s cleaning roster for %s. Please clean the shared areas with your assigned partner and put the bins out that evening. If you need to swap, please reply so we can update the roster.\n\nThank you,\nFaizan & Danish\nSAKAN Lodge',e.resident,e.house,to_char(e.duty_date,'FMDay DD Mon YYYY'))
 from (select distinct on(delivery_key,recipient) * from sakan_private.due_cleaning_emails order by delivery_key,recipient,resident) e
 on conflict(kind,source_id,recipient) do update set status='pending',updated_at=now()
 where incoming_alert_deliveries.status='cancelled';
end $$;
revoke all on function sakan_private.queue_cleaning_emails() from public,anon,authenticated;
grant execute on function sakan_private.queue_cleaning_emails() to service_role;

-- Extend the existing mail worker; claim-time validation covers edits between polling and delivery.
do $$ declare src text; begin
 src:=pg_get_functiondef('public.incoming_alert_worker(text,uuid,uuid,text)'::regprocedure);
 if strpos(src,'perform sakan_private.queue_due_checkout_thanks();')=0 or strpos(src,'and (kind<>''checkout_thanks''')=0 then
 raise exception 'Incoming alert worker has changed'; end if;
 src:=replace(src,'perform sakan_private.queue_due_checkout_thanks();','perform sakan_private.queue_due_checkout_thanks(); perform sakan_private.queue_cleaning_emails();');
 src:=replace(src,'and (kind<>''checkout_thanks''','and (kind<>''cleaning'' or exists(select 1 from sakan_private.due_cleaning_emails e where e.delivery_key=source_id and e.recipient=incoming_alert_deliveries.recipient)) and (kind<>''checkout_thanks''');
 execute src;
end $$;

create function public.cleaning_delivery_status() returns table(shift_id uuid,recipient text,status text)
 language sql stable security definer set search_path='' as $$
 select s.id,d.recipient,d.status from public.cleaning_shifts s join public.incoming_alert_deliveries d
 on d.source_id=s.delivery_key and d.kind='cleaning' where public.is_sakan_staff();
$$;
revoke all on function public.cleaning_delivery_status() from public,anon;
grant execute on function public.cleaning_delivery_status() to authenticated;
