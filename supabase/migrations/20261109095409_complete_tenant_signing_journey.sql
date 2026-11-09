begin;
-- Only newly created agreements receive the online-workflow wording. Historical PDFs and terms remain frozen.
create function sakan_private.online_signing_terms(p_terms text) returns text language sql immutable security invoker set search_path='' as $$
 select replace(p_terms,'reply to sakanlodges@gmail.com with the signed agreement and payment receipt.','sign the agreement using your private SAKAN online signing link. Do not email the signed agreement back. Contact sakanlodges@gmail.com about any payment receipt.');
$$;
revoke all on function sakan_private.online_signing_terms(text) from public,anon,authenticated,service_role;
create function sakan_private.prepare_online_contract_terms() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.fields:=jsonb_set(new.fields,'{terms}',to_jsonb(sakan_private.online_signing_terms(new.fields->>'terms')));
 return new;
end $$;
revoke all on function sakan_private.prepare_online_contract_terms() from public,anon,authenticated,service_role;
create trigger online_contract_terms before insert on public.contracts for each row execute function sakan_private.prepare_online_contract_terms();

-- Keep a signed receipt available for 30 days; unsigned links still expire on the chosen deadline.
create function sakan_private.extend_signed_receipt_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='signed' and old.status='processing' then new.expires_at:=greatest(new.expires_at,now()+interval '30 days'); end if;
 return new;
end $$;
revoke all on function sakan_private.extend_signed_receipt_access() from public,anon,authenticated,service_role;
create trigger signed_receipt_access before update of status on public.contract_signing_requests for each row execute function sakan_private.extend_signed_receipt_access();

alter table public.incoming_alert_deliveries drop constraint incoming_alert_deliveries_kind_check;
alter table public.incoming_alert_deliveries add constraint incoming_alert_deliveries_kind_check check(kind in ('reservation','enquiry','signing_received','signing_approved','signing_rejected'));
create function sakan_private.queue_signing_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.reservations; c public.contracts; recipient text; link text; message text; subject text;
begin
 if new.status=old.status or new.status not in ('signed','approved','rejected') then return new;end if;
 select * into r from public.reservations where id=new.reservation_id;
 select * into c from public.contracts where id=new.contract_id;
 if new.status='signed' then
  for recipient in select distinct e from unnest(array['sakanlodges@gmail.com']||sakan_private.staff_emails()) e loop
   insert into public.incoming_alert_deliveries(source_id,kind,recipient,reply_to,subject,body)
   values(new.id,'signing_received',recipient,r.email,'Signed agreement ready for review - '||r.reservation_code,
    'Every named resident has submitted a signature for '||r.reservation_code||E'.\nApplicant: '||r.full_name||E'\nAgreement version: '||c.version||E'\n\nOpen the signed PDF and review the applicant identity, dates, room, rent and bond before approving or rejecting. Signing has not allocated the room or recorded a payment.\n\nReview in Ledger: https://sakanlodge.com/ledger/reservations?reservation='||r.id) on conflict do nothing;
  end loop;
 else
  select substring(payload->>'body' from 'https://sakanlodge\.com/sign#[0-9a-f]{64}') into link from public.notification_outbox where payload->>'signing_request_id'=new.id::text and kind='contract_signing' order by created_at desc limit 1;
  subject:=case when new.status='approved' then 'Your SAKAN Lodge room allocation is approved - ' else 'Update on your SAKAN Lodge request - ' end||r.reservation_code;
  message:='Hello '||r.full_name||E',\n\n'||case when new.status='approved' then
   E'Your signed agreement has been approved and the agreed room has been allocated to you.\n\nRoom: '||coalesce(c.fields->>'room_label','As agreed')||E'\nPremises: '||coalesce(c.fields->>'premises_address','As agreed')||E'\nCheck-in: '||r.arrival_date||E'\nCheckout: '||r.departure_date||E'\n\nPlease contact our team to arrange arrival and key collection. Rent and bond remain payable as agreed; this email does not acknowledge any payment.'
   else E'Our team has declined this request.\n\nReason: '||coalesce(new.review_reason,'Contact our team for details.')||E'\n\nNo tenant or room allocation was created by this decision. Contact our team if you would like to discuss another option.' end
   ||case when link is not null then E'\n\nDownload and keep your signed agreement using your private link:\n'||link||E'\nCopy access expires: '||to_char(new.expires_at at time zone 'Australia/Adelaide','DD Mon YYYY HH24:MI')||' (Adelaide time). Keep this link private.' else E'\n\nContact our team for a copy of your signed agreement.' end||E'\n\nNo printing, scanning or reply with a signed PDF is needed.\n\nSAKAN Lodge\nsakanlodges@gmail.com\n0426 721 787';
  insert into public.incoming_alert_deliveries(source_id,kind,recipient,reply_to,subject,body)
  values(new.id,'signing_'||new.status,r.email,'sakanlodges@gmail.com',subject,message) on conflict do nothing;
  -- Replace the old generic cancellation draft with the specific reviewed outcome.
  if new.status='rejected' then update public.notification_outbox set status='superseded',updated_at=now() where reservation_id=r.id and kind='cancel' and status='pending';end if;
 end if;
 return new;
end $$;
revoke all on function sakan_private.queue_signing_notifications() from public,anon,authenticated,service_role;
create trigger signing_notifications after update of status on public.contract_signing_requests for each row execute function sakan_private.queue_signing_notifications();

-- Do not send a legacy draft that still instructs the tenant to email a signature back.
do $$declare source text;begin
 select pg_get_functiondef('sakan_private.prepare_contract_signing(uuid,integer,text,text,integer,text)'::regprocedure) into source;
 source:=replace(source,' if jsonb_array_length(c.fields->''resident_names'')', ' if position(''reply to sakanlodges@gmail.com with the signed agreement and payment receipt.'' in (c.fields->>''terms''))>0 then raise exception ''Generate a replacement agreement with the online signing instructions before sending''; end if;
 if jsonb_array_length(c.fields->''resident_names'')');
 if position('Generate a replacement agreement' in source)=0 then raise exception 'Online signing terms guard could not be installed';end if;
 execute source;
end $$;
create function sakan_private.reconcile_signing_email(p_id uuid,p_action text,p_message text) returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.incoming_alert_deliveries; rid uuid;
begin
 perform sakan_private.require_staff();
 select * into n from public.incoming_alert_deliveries where id=p_id for update;
 if n.id is null or n.kind not in ('signing_received','signing_approved','signing_rejected') then raise exception 'Signing email not found';end if;
 if p_action='sent' and n.status in ('sending','uncertain') and p_message ~ '^[A-Za-z0-9_-]{5,128}$' then
  update public.incoming_alert_deliveries set status='sent',message_id=p_message,updated_at=now() where id=n.id returning * into n;
 elsif p_action='requeue' and (n.status='uncertain' or (n.status='sending' and n.updated_at<now()-interval '15 minutes')) and p_message='CHECKED_SENT_MAIL_NOT_SENT' then
  update public.incoming_alert_deliveries set status='pending',attempt=null,updated_at=now() where id=n.id returning * into n;
 else raise exception 'Check Gmail Sent Mail before reconciling or retrying this email';end if;
 select reservation_id into rid from public.contract_signing_requests where id=n.source_id;
 insert into public.reservation_events(reservation_id,action,actor,details) values(rid,'signing_email_'||p_action,auth.uid()::text,jsonb_build_object('delivery_id',n.id,'status',n.status));
 return to_jsonb(n);
end $$;
create function public.reconcile_signing_email(p_id uuid,p_action text,p_message text) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.reconcile_signing_email(p_id,p_action,p_message)$$;
revoke all on function sakan_private.reconcile_signing_email(uuid,text,text),public.reconcile_signing_email(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function sakan_private.reconcile_signing_email(uuid,text,text),public.reconcile_signing_email(uuid,text,text) to authenticated;
commit;
