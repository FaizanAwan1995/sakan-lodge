-- Bond payment receipts reuse the immutable numbered invoice queue.
-- A bond receipt is only created for a recorded and verified bond payment.
-- Legacy 'paid' profile flags do not constitute financial evidence.
CREATE OR REPLACE FUNCTION sakan_private.bond_invoice_snapshot(pay public.payments)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE tenant public.people; house public.properties; room_label text; address_text text; cc_list jsonb;
BEGIN
 IF pay.kind <> 'bond' OR pay.amount <= 0 THEN RAISE EXCEPTION 'A recorded positive bond payment is required'; END IF;
 SELECT * INTO tenant FROM public.people WHERE id=pay.person_id;
 SELECT * INTO house FROM public.properties WHERE id=pay.property_id;
 SELECT label INTO room_label FROM public.rooms WHERE id=tenant.room_id;
 SELECT COALESCE(NULLIF(trim(house.invoice_address),''),NULLIF(trim(d.premises_address),'')) INTO address_text
 FROM (SELECT 1) seed LEFT JOIN public.contract_defaults d ON d.property_id=house.id;
 SELECT COALESCE(jsonb_agg(email ORDER BY email),'[]'::jsonb) INTO cc_list
 FROM (SELECT DISTINCT lower(email) email FROM auth.users u JOIN public.staff_access a ON a.user_id=u.id
       WHERE u.email_confirmed_at IS NOT NULL UNION SELECT 'sakanlodges@gmail.com') admins;
 RETURN jsonb_build_object(
  'document_type','bond_receipt','tenant_name',tenant.name,'tenant_email',lower(trim(tenant.email)),
  'address',address_text,'property',house.name,'room',room_label,
  'payment',sakan_private.invoice_payment(pay),
  'lines',jsonb_build_array(jsonb_build_object('description','Refundable accommodation bond received','amount',pay.amount)),
  'cc',cc_list,'issued_date',(now() AT TIME ZONE 'Australia/Adelaide')::date,
  'handled_by',pay.received_by);
END $fn$;

-- Keeps existing correction and uncertain-send protections for both rent and bonds.
CREATE OR REPLACE FUNCTION sakan_private.queue_rent_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE prior sakan_private.rent_invoices; invoice_number bigint; invoice_id uuid;
BEGIN
 IF tg_op='UPDATE' AND sakan_private.invoice_payment(old)=sakan_private.invoice_payment(new) THEN RETURN new; END IF;
 IF tg_op='DELETE' OR tg_op='UPDATE' THEN
  SELECT * INTO prior FROM sakan_private.rent_invoices WHERE payment_id=old.id AND status<>'void' FOR UPDATE;
  IF prior.id IS NULL THEN RETURN CASE WHEN tg_op='DELETE' THEN old ELSE new END; END IF;
  IF tg_op='DELETE' THEN RAISE EXCEPTION 'A receipted payment cannot be deleted. Correct it with an audited replacement'; END IF;
  IF prior.status IN ('preparing','sending','uncertain') THEN
    RAISE EXCEPTION 'Receipt delivery is active or uncertain. Reconcile it before correcting the payment';
  END IF;
  UPDATE sakan_private.rent_invoices SET status='void',updated_at=now(),
    last_error='Payment corrected; original document retained' WHERE id=prior.id;
 END IF;
 IF new.kind NOT IN ('rent','bond') THEN RETURN new; END IF;
 UPDATE sakan_private.invoice_counter SET last_number=last_number+1 WHERE id RETURNING last_number INTO invoice_number;
 INSERT INTO sakan_private.rent_invoices(number,payment_id,person_id,property_id,snapshot,replaces_number)
 VALUES(invoice_number,new.id,new.person_id,new.property_id,
   CASE WHEN new.kind='bond' THEN sakan_private.bond_invoice_snapshot(new)
   ELSE sakan_private.invoice_snapshot(new) END,prior.number)
 RETURNING id INTO invoice_id;
 INSERT INTO public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id)
 VALUES(coalesce(auth.jwt()->>'email','system'),
   CASE WHEN new.kind='bond' THEN 'bond_receipt_queued #' ELSE 'rent_invoice_queued #' END || invoice_number,
   new.person_id,(SELECT name FROM public.people WHERE id=new.person_id),'rent_invoice',invoice_id::text);
 RETURN new;
END $fn$;

-- Allows issuing receipts for previously recorded payments, without creating a
-- second payment or silently trusting the legacy bond-status flag.
CREATE OR REPLACE FUNCTION sakan_private.bond_payment_receipt(
 p_payment uuid,p_action text DEFAULT 'preview',p_expected jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE pay public.payments; existing sakan_private.rent_invoices; snapshot_doc jsonb; invoice_number bigint;
BEGIN
 PERFORM sakan_private.require_staff();
 IF p_action NOT IN ('preview','issue') THEN RAISE EXCEPTION 'Unknown receipt action'; END IF;
 SELECT * INTO pay FROM public.payments WHERE id=p_payment FOR UPDATE;
 IF NOT FOUND OR pay.kind<>'bond' OR pay.amount<=0 THEN RAISE EXCEPTION 'Choose a recorded bond payment'; END IF;
 IF pay.date>(now() AT TIME ZONE 'Australia/Adelaide')::date THEN RAISE EXCEPTION 'Future payments cannot be receipted'; END IF;
 SELECT * INTO existing FROM sakan_private.rent_invoices WHERE payment_id=pay.id AND status<>'void';
 IF FOUND THEN RETURN to_jsonb(existing)||jsonb_build_object('existing',true); END IF;
 snapshot_doc:=sakan_private.bond_invoice_snapshot(pay);
 IF p_action='preview' THEN RETURN jsonb_build_object('number','DRAFT','snapshot',snapshot_doc,'existing',false); END IF;
 IF p_expected IS NULL OR p_expected IS DISTINCT FROM snapshot_doc THEN
   RAISE EXCEPTION 'Payment or contact details changed. Review the receipt again';
 END IF;
 IF nullif(trim(snapshot_doc->>'address'),'') IS NULL THEN RAISE EXCEPTION 'Add the verified property address'; END IF;
 IF COALESCE(snapshot_doc->>'tenant_email','') !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$'
    OR snapshot_doc->>'tenant_email'='sakanlodges@gmail.com' THEN RAISE EXCEPTION 'Add a valid tenant email'; END IF;
 IF jsonb_array_length(snapshot_doc->'cc')<>3 THEN RAISE EXCEPTION 'Both verified administrator copy addresses are required'; END IF;
 UPDATE sakan_private.invoice_counter SET last_number=last_number+1 WHERE id RETURNING last_number INTO invoice_number;
 INSERT INTO sakan_private.rent_invoices(number,payment_id,person_id,property_id,snapshot)
 VALUES(invoice_number,pay.id,pay.person_id,pay.property_id,snapshot_doc) RETURNING * INTO existing;
 INSERT INTO public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id,reason)
 VALUES(auth.uid()::text,'bond_receipt_historical_queued #'||invoice_number,pay.person_id,
  (SELECT name FROM public.people WHERE id=pay.person_id),'rent_invoice',existing.id::text,
  'Admin verified recorded historical bond payment and receipt recipients');
 RETURN to_jsonb(existing)||jsonb_build_object('existing',false);
END $fn$;

CREATE OR REPLACE FUNCTION public.staff_bond_payment_receipt(
 p_payment uuid,p_action text DEFAULT 'preview',p_expected jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $fn$ SELECT sakan_private.bond_payment_receipt(p_payment,p_action,p_expected) $fn$;
REVOKE ALL ON FUNCTION public.staff_bond_payment_receipt(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_bond_payment_receipt(uuid,text,jsonb) TO authenticated;
