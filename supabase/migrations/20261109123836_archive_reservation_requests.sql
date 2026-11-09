begin;
create function sakan_private.archive_reservation_request(p_id uuid,p_revision integer,p_reason text,p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations;s public.contract_signing_requests;result jsonb;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_id for update;
 if r.id is null or r.revision is distinct from p_revision then raise exception 'Request changed. Reload before removing it' using errcode='40001';end if;
 if r.status='archived' then return to_jsonb(r);end if;
 if r.checked_in_person_id is not null or coalesce(jsonb_array_length(r.assigned_people),0)>0 or r.status not in ('pending','review','held','confirmed','cancelled') then raise exception 'This request is linked to an allocated tenant. Manage the stay from their tenant profile';end if;
 if p_confirmation is distinct from 'ARCHIVE_REQUEST' or length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Enter a reason and confirm removal';end if;
 select * into s from public.contract_signing_requests where reservation_id=r.id and status='signed' order by created_at desc limit 1;
 if s.id is not null then
  result:=sakan_private.review_contract_signing(s.id,r.revision,'reject',p_reason);
  select * into r from public.reservations where id=r.id;
 elsif r.status<>'cancelled' then
  result:=sakan_private.manage_reservation(r.id,r.revision,'cancel','{}');
  select * into r from public.reservations where id=r.id;
 end if;
 result:=sakan_private.manage_reservation(r.id,r.revision,'archive','{}');
 -- Archival itself is an internal housekeeping action, not an additional applicant email.
 update public.notification_outbox set status='superseded',updated_at=now() where reservation_id=r.id and kind='archive' and status='pending';
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'removed_from_active_requests',auth.uid()::text,jsonb_build_object('reason',trim(p_reason),'signed_request_rejected',s.id is not null,'documents_preserved',true));
 return result;
end $$;
create function public.archive_reservation_request(p_id uuid,p_revision integer,p_reason text,p_confirmation text) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.archive_reservation_request(p_id,p_revision,p_reason,p_confirmation)$$;
revoke all on function sakan_private.archive_reservation_request(uuid,integer,text,text),public.archive_reservation_request(uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function sakan_private.archive_reservation_request(uuid,integer,text,text),public.archive_reservation_request(uuid,integer,text,text) to authenticated;
commit;
