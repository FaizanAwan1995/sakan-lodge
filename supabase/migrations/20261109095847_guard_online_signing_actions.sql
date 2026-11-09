begin;
-- Keep legacy reservation controls from bypassing the online review or invalidating a signing link via a hold.
do $$declare source text;begin
 select pg_get_functiondef('sakan_private.manage_reservation(uuid,integer,text,jsonb)'::regprocedure) into source;
 source:=replace(source,' previous:=r.status;', ' if p_action in (''review'',''hold'',''confirm'',''check_in'') and exists(select 1 from public.contract_signing_requests where reservation_id=r.id and status in (''awaiting_signature'',''processing'',''signed'')) then raise exception ''Use the online signing review panel before changing this reservation status'';end if;
 if p_action=''cancel'' then
  if exists(select 1 from public.contract_signing_requests where reservation_id=r.id and status=''signed'' and (reviewed_at is null or reviewed_by is distinct from auth.uid())) then raise exception ''Use Reject request in the signing panel and provide a reason'';end if;
  update public.contract_signing_requests set status=''revoked'',reviewed_at=now(),reviewed_by=auth.uid() where reservation_id=r.id and status in (''awaiting_signature'',''processing'');
 end if;
 previous:=r.status;');
 if position('Use the online signing review panel' in source)=0 then raise exception 'Signing action guard could not be installed';end if;
 execute source;
 select pg_get_functiondef('sakan_private.review_contract_signing(uuid,integer,text,text)'::regprocedure) into source;
 source:=replace(source,'   result:=sakan_private.manage_reservation(r.id,r.revision,''cancel'',''{}'');', '   update public.contract_signing_requests set reviewed_at=now(),reviewed_by=auth.uid(),review_reason=trim(p_reason) where id=s.id;
   result:=sakan_private.manage_reservation(r.id,r.revision,''cancel'',''{}'');');
 if position('set reviewed_at=now(),reviewed_by=auth.uid(),review_reason=trim(p_reason)' in source)=0 then raise exception 'Signing rejection guard could not be installed';end if;
 execute source;
end $$;
commit;
