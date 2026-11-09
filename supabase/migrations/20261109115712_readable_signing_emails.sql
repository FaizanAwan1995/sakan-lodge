begin;
create function sakan_private.signing_stay_summary(r public.reservations,f jsonb) returns text language sql stable security invoker set search_path='' as $$
 select 'Resident: '||r.full_name||E'\nRoom: '||coalesce(f->>'room_label','As agreed')||E'\nAddress: '||coalesce(f->>'premises_address','As agreed')||E'\nCheck-in: '||to_char(r.arrival_date,'FMDay, FMDD FMMonth YYYY')||E'\nCheckout: '||to_char(r.departure_date,'FMDay, FMDD FMMonth YYYY')||E'\nRent: AUD $'||to_char(case when f->>'billing_type'='nightly' then (f->>'nightly_rate')::numeric else (f->>'weekly_rate')::numeric end,'FM999999990.00')||case when f->>'billing_type'='nightly' then ' per night, per resident' when r.offer_type='shared' then ' per week, per resident' else ' per week' end||E'\nBond: AUD $'||to_char((f->>'bond')::numeric,'FM999999990.00')||' per resident';
$$;
revoke all on function sakan_private.signing_stay_summary(public.reservations,jsonb) from public,anon,authenticated,service_role;
create function sakan_private.readable_signing_invitation() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.reservations;c public.contracts;s public.contract_signing_requests;link text;message text;
begin
 if new.kind<>'contract_signing' then return new;end if;
 select * into r from public.reservations where id=new.reservation_id;
 select * into c from public.contracts where id=(new.payload->>'contract_id')::uuid;
 select * into s from public.contract_signing_requests where id=(new.payload->>'signing_request_id')::uuid;
 link:=substring(new.payload->>'body' from 'https://sakanlodge\.com/sign#[0-9a-f]{64}');
 if link is null then raise exception 'Signing invitation link missing';end if;
 message:='Hi '||r.full_name||E',\n\nYour SAKAN Lodge agreement is ready. Please check the details below, read the agreement and sign online when you are ready.\n\nYour stay\n'||sakan_private.signing_stay_summary(r,c.fields)||E'\n\nReview and sign your agreement:\n'||link||E'\n\nPlease sign by '||to_char(s.expires_at at time zone 'Australia/Adelaide','FMDay, FMDD FMMonth YYYY "at" FMHH12:MI am')||E' (Adelaide time). Each resident named in the agreement must sign for themselves.\n\nWhat happens next?\nOur team will review your signatures and confirm room availability. We will email you the outcome. Signing alone does not confirm a room allocation.\n\nThere is no need to print, scan or email the agreement back. You can download your signed copy after submitting. If a detail needs correcting, contact us before signing.\n\nKind regards,\nSAKAN Lodge\n0426 721 787\nsakanlodges@gmail.com\n\nReference: SK-'||right(r.reservation_code,8)||' | Agreement '||c.version;
 new.payload:=new.payload||jsonb_build_object('subject','Your SAKAN Lodge agreement is ready to sign','body',message);return new;
end $$;
revoke all on function sakan_private.readable_signing_invitation() from public,anon,authenticated,service_role;
create trigger readable_signing_invitation before insert on public.notification_outbox for each row execute function sakan_private.readable_signing_invitation();

create or replace function sakan_private.queue_signing_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.reservations;c public.contracts;recipient text;link text;message text;subject text;summary text;
begin
 if new.status=old.status or new.status not in ('signed','approved','rejected') then return new;end if;
 select * into r from public.reservations where id=new.reservation_id;
 select * into c from public.contracts where id=new.contract_id;
 summary:=sakan_private.signing_stay_summary(r,c.fields);
 if new.status='signed' then
  subject:=left(regexp_replace(r.full_name,E'[\r\n]+',' ','g'),120)||' has signed their SAKAN Lodge agreement';
  message:=E'Hello SAKAN team,\n\n'||r.full_name||E' has finished signing. Their agreement is ready for your review.\n\nStay details\n'||summary||E'\n\nNext step\nOpen the signed agreement in Ledger, check the signatures and applicant details, then approve the room allocation or decline with a reason. Please verify any rent or bond payments separately.\n\nReview the agreement:\nhttps://sakanlodge.com/ledger/reservations?reservation='||r.id||E'\n\nReference: SK-'||right(r.reservation_code,8)||' | Agreement '||c.version;
  for recipient in select distinct e from unnest(array['sakanlodges@gmail.com']||sakan_private.staff_emails()) e loop
   insert into public.incoming_alert_deliveries(source_id,kind,recipient,reply_to,subject,body) values(new.id,'signing_received',recipient,r.email,subject,message) on conflict do nothing;
  end loop;
 else
  select substring(payload->>'body' from 'https://sakanlodge\.com/sign#[0-9a-f]{64}') into link from public.notification_outbox where payload->>'signing_request_id'=new.id::text and kind='contract_signing' order by created_at desc limit 1;
  subject:=case when new.status='approved' then 'Welcome to SAKAN Lodge - your room is approved' else 'An update on your SAKAN Lodge application' end;
  message:='Hi '||r.full_name||E',\n\n'||case when new.status='approved' then E'We have approved your signed agreement and allocated your agreed room. We look forward to welcoming you.\n\nYour stay\n'||summary||E'\n\nBefore you arrive\nPlease contact our team to confirm your arrival time and arrange key collection. Rent and bond are payable as agreed. Payment confirmations are sent separately.' else E'Thank you for your interest in SAKAN Lodge. After reviewing your request, we are unable to proceed with this application.\n\nReason: '||coalesce(new.review_reason,'Please contact our team for details.')||E'\n\nPlease do not make a payment for this declined request. Contact us if you would like to discuss the decision or explore another option.' end||case when link is not null then E'\n\nYour signed agreement\nDownload a copy for your records:\n'||link||E'\n\nYour private copy is available until '||to_char(new.expires_at at time zone 'Australia/Adelaide','FMDD FMMonth YYYY "at" FMHH12:MI am')||' (Adelaide time). Please keep the link private.' else E'\n\nContact our team if you need a copy of your signed agreement.' end||E'\n\nKind regards,\nSAKAN Lodge\n0426 721 787\nsakanlodges@gmail.com\n\nReference: SK-'||right(r.reservation_code,8)||' | Agreement '||c.version;
  insert into public.incoming_alert_deliveries(source_id,kind,recipient,reply_to,subject,body) values(new.id,'signing_'||new.status,r.email,'sakanlodges@gmail.com',subject,message) on conflict do nothing;
  if new.status='rejected' then update public.notification_outbox set status='superseded',updated_at=now() where reservation_id=r.id and kind='cancel' and status='pending';end if;
 end if;return new;
end $$;
commit;
