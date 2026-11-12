begin;
alter table public.booking_settings add column checkout_emails_enabled_at timestamptz not null default now();
grant select on public.booking_settings to service_role;
alter table public.incoming_alert_deliveries add column not_before timestamptz not null default now();
alter table public.incoming_alert_deliveries drop constraint incoming_alert_deliveries_kind_check;
alter table public.incoming_alert_deliveries add constraint incoming_alert_deliveries_kind_check check(kind in('reservation','enquiry','signing_received','signing_approved','signing_rejected','checkout_thanks'));
alter table public.incoming_alert_deliveries drop constraint incoming_alert_deliveries_status_check;
alter table public.incoming_alert_deliveries add constraint incoming_alert_deliveries_status_check check(status in('pending','sending','sent','uncertain','cancelled'));
create unique index one_checkout_thanks_per_tenant on public.incoming_alert_deliveries(source_id) where kind='checkout_thanks';

create function sakan_private.checkout_email_eligible(p public.people) returns boolean language sql stable set search_path='' as $$
 select p.start_date <= (now() at time zone 'Australia/Adelaide')::date and
 coalesce(p.email,'') ~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' and lower(p.email)<>'sakanlodges@gmail.com' and
 exists(select 1 from public.booking_settings b where
  (p.checked_out_at is not null and p.checked_out_at>=b.checkout_emails_enabled_at and p.checked_out_at<=now()) or
  (p.checked_out_at is null and p.end_date<(now() at time zone 'Australia/Adelaide')::date and p.end_date>p.start_date and p.end_date>=(b.checkout_emails_enabled_at at time zone 'Australia/Adelaide')::date));
$$;
revoke all on function sakan_private.checkout_email_eligible(public.people) from public,anon,authenticated;
grant execute on function sakan_private.checkout_email_eligible(public.people) to service_role;

create function sakan_private.queue_checkout_thanks(p public.people) returns void language plpgsql security definer set search_path='' as $$
begin
 if not sakan_private.checkout_email_eligible(p) then
  update public.incoming_alert_deliveries set status='cancelled',updated_at=now() where kind='checkout_thanks' and source_id=p.id and status='pending';return;
 end if;
 insert into public.incoming_alert_deliveries(source_id,kind,recipient,reply_to,subject,body,not_before)
 values(p.id,'checkout_thanks',lower(trim(p.email)),'sakanlodges@gmail.com','Thank you for staying with SAKAN Lodge',
 'Hi '||p.name||E',\n\nThank you for staying with SAKAN Lodge. It was a pleasure having you with us, and we wish you all the best for your next chapter.\n\nIf you have a moment, we would really appreciate an honest review of your stay. Your feedback helps future guests choose their accommodation and helps our small business grow.\n\nYou can leave a review on any of these platforms:\n\nGoogle Maps\nhttps://maps.app.goo.gl/GYqfd7BsjgCmsMdy9?g_st=ic\n\nFacebook\nhttps://www.facebook.com/SakanLodge/reviews/\n\nSAKAN Lodge website\nhttps://sakanlodge.com/#leave-review\n\nThank you again for being part of SAKAN Lodge. We would love to welcome you back in the future.\n\nWarm regards,\nFaizan & Danish\nSAKAN Lodge\nsakanlodges@gmail.com',now()+interval '10 minutes')
 on conflict(source_id) where kind='checkout_thanks' do update set recipient=excluded.recipient,body=excluded.body,status='pending',updated_at=now(),not_before=case when incoming_alert_deliveries.status='cancelled' then excluded.not_before else incoming_alert_deliveries.not_before end
 where incoming_alert_deliveries.status in('pending','cancelled');
end $$;
revoke all on function sakan_private.queue_checkout_thanks(public.people) from public,anon,authenticated;
grant execute on function sakan_private.queue_checkout_thanks(public.people) to service_role;
create function sakan_private.checkout_thanks_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin perform sakan_private.queue_checkout_thanks(new);return new;end $$;
revoke all on function sakan_private.checkout_thanks_trigger() from public,anon,authenticated,service_role;
create trigger checkout_thanks_after_change after update of checked_out_at,end_date,start_date,email,name on public.people for each row execute function sakan_private.checkout_thanks_trigger();

create function sakan_private.queue_due_checkout_thanks() returns void language plpgsql security definer set search_path='' as $$
declare tenant public.people;
begin
 for tenant in select person.* from public.people person where sakan_private.checkout_email_eligible(person) and not exists(select 1 from public.incoming_alert_deliveries d where d.kind='checkout_thanks' and d.source_id=person.id and d.status<>'cancelled') order by person.id limit 100 loop
  perform sakan_private.queue_checkout_thanks(tenant);
 end loop;
end $$;
revoke all on function sakan_private.queue_due_checkout_thanks() from public,anon,authenticated;
grant execute on function sakan_private.queue_due_checkout_thanks() to service_role;

do $$ declare src text;begin
 src:=pg_get_functiondef('public.incoming_alert_worker(text,uuid,uuid,text)'::regprocedure);
 src:=replace(src,'if p_action=''pending'' then','if p_action=''pending'' then perform sakan_private.queue_due_checkout_thanks();');
 src:=replace(src,'where status=''pending'' order by created_at limit 12','where status=''pending'' and not_before<=now() order by created_at limit 12');
 src:=replace(src,'where id=p_id and status=''pending'' returning * into n;', 'where id=p_id and status=''pending'' and not_before<=now() and (kind<>''checkout_thanks'' or exists(select 1 from public.people p where p.id=source_id and lower(trim(p.email))=recipient and sakan_private.checkout_email_eligible(p))) returning * into n;');
 execute src;
end $$;
commit;
