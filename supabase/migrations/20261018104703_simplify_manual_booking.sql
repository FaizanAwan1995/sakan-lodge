begin;
-- Owner requested a simple manual workflow. Never fabricate a signature receipt or payment.
create function sakan_private.manual_booking(p_id uuid,p_revision integer,p_contract uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reservations; c public.contracts; cap integer; member text; person uuid; first_person uuid; members jsonb:='[]';
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_id for update;
 if not found or r.revision<>p_revision then raise exception 'Reservation changed. Reload before confirming' using errcode='40001'; end if;
 if r.status not in ('pending','review','held') or r.checked_in_person_id is not null then raise exception 'Reservation cannot be confirmed again'; end if;
 if exists(select 1 from public.notification_outbox where reservation_id=r.id and status='sending') then raise exception 'Reconcile the sending email first'; end if;
 select * into c from public.contracts where id=p_contract and reservation_id=r.id;
 if c.id is null or c.status not in ('draft','approved','signed') or c.document_path is null or c.reservation_revision<>r.revision then raise exception 'Generate the current contract PDF first'; end if;
 select capacity into cap from public.rooms where id=r.room_id for update;
 if r.offer_type is distinct from (case when cap=1 then 'private' else 'shared' end) or r.weekly_rate is distinct from (case when cap>1 then 185 when r.departure_date<(r.arrival_date+interval '2 months')::date then 300 else 255 end) then raise exception 'Room capacity changed. Regenerate agreement'; end if;
 if not exists(select 1 from public.room_profiles where room_id=r.room_id and ready) then raise exception 'Room must be ready'; end if;
 if sakan_private.free_spaces(r.room_id,r.arrival_date,r.departure_date,r.id)<r.spaces_requested then raise exception 'Room is no longer available'; end if;
 if jsonb_array_length(c.fields->'resident_names') is distinct from r.spaces_requested then raise exception 'Contract must name every resident'; end if;
 if r.departure_date-r.arrival_date<7 and (c.fields->>'billing_type' is distinct from 'nightly' or coalesce((c.fields->>'nightly_rate')::numeric,0)<=0) then raise exception 'Explicit nightly rate required'; end if;
 update public.reservations set status='assigned',hold_expires_at=null where id=r.id;
 for member in select value from jsonb_array_elements_text(c.fields->'resident_names') loop
  insert into public.people(name,email,phone,property_id,room_id,stay_type,weekly_rate,nightly_rate,start_date,end_date,bond,bond_status)
  values(member,r.email,r.phone,r.property_id,r.room_id,case when c.fields->>'billing_type'='nightly' then 'short' else 'long' end,r.weekly_rate,(c.fields->>'nightly_rate')::numeric,r.arrival_date,r.departure_date,(c.fields->>'bond')::numeric,'not_paid') returning id into person;
  members:=members||jsonb_build_array(person); first_person:=coalesce(first_person,person);
 end loop;
 update public.reservations set confirmed_at=now(),checked_in_person_id=first_person,assigned_people=members,revision=revision+1,updated_at=now() where id=r.id returning * into r;
 insert into public.reservation_events(reservation_id,action,actor,details) values(r.id,'manually_confirmed_and_assigned',auth.uid()::text,jsonb_build_object('people',members,'contract_id',c.id,'payments_recorded',false));
 return to_jsonb(r);
end $$;
create function public.confirm_manual_booking(p_id uuid,p_revision integer,p_contract uuid) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.manual_booking(p_id,p_revision,p_contract)$$;
revoke all on function public.confirm_manual_booking(uuid,integer,uuid),sakan_private.manual_booking(uuid,integer,uuid) from public,anon,service_role;
grant execute on function public.confirm_manual_booking(uuid,integer,uuid),sakan_private.manual_booking(uuid,integer,uuid) to authenticated;
create or replace function sakan_private.booking_offer(p_id uuid,p_revision integer,p_contract uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.reservations; c public.contracts; n public.notification_outbox; msg text;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_id for update;
 if not found or r.revision<>p_revision then raise exception 'Reservation changed. Reload before sending' using errcode='40001'; end if;
 select * into c from public.contracts where id=p_contract and reservation_id=r.id;
 if r.status not in ('pending','review','held') or c.id is null or c.status not in ('draft','approved','signed') or c.document_path is null or c.reservation_revision<>r.revision then raise exception 'Review the current generated PDF first'; end if;
 select * into n from public.notification_outbox where reservation_id=r.id and kind='provisional_offer' and payload->>'contract_id'=c.id::text and status<>'superseded' order by created_at desc limit 1;
 if found then return to_jsonb(n); end if;
 perform sakan_private.manage_contract(r.id,'approve',jsonb_build_object('id',c.id)) where c.status='draft';
 msg:='Hello '||r.full_name||E',\n\nThank you for choosing SAKAN Lodge. We have reviewed your request and attached your accommodation agreement for review and signature.\n\nReservation reference: '||r.reservation_code||E'\nArrival: '||r.arrival_date||E'\nDeparture: '||r.departure_date||E'\nRoom: '||(c.fields->>'room_label')||E'\nRent per fortnight: AUD $'||(r.weekly_rate*2)||case when r.offer_type='shared' then ' per person' else '' end||E'\nBond required: AUD $'||((c.fields->>'bond')::numeric*r.spaces_requested)||E' total\n\nThis is a provisional booking notice, not final confirmation. To proceed:\n1. Pay the bond to our PayID: 0426721787. Use your reservation reference as the payment reference.\n2. Reply to sakanlodges@gmail.com with the signed agreement and your payment receipt.\n\nYour booking will be confirmed after our team verifies the bond payment, the required signatures and room availability. Remaining rent can be paid on arrival.\nElectricity, water, gas and internet are included without additional charges.\n\nKind regards,\nSAKAN Lodge\nsakanlodges@gmail.com\n0426 721 787';
 if c.fields->>'billing_type'='nightly' then msg:=replace(msg,E'\nRent per fortnight: AUD $'||(r.weekly_rate*2),E'\nAgreed rent per night: AUD $'||(c.fields->>'nightly_rate')); end if;
 insert into public.notification_outbox(reservation_id,recipient,kind,payload) values(r.id,r.email,'provisional_offer',jsonb_build_object('subject','SAKAN Lodge - booking notice and agreement - '||r.reservation_code,'body',msg,'revision',r.revision,'contract_id',c.id,'document_path',c.document_path)) returning * into n;
 return to_jsonb(n);
end $$;

-- Freeze owner-authorised proprietor artwork only into NEW contracts, not historical agreements.
do $$declare src text; begin
 select pg_get_functiondef('sakan_private.booking_contract(uuid,integer,jsonb)'::regprocedure) into src;
 src:=replace(src, ' return jsonb_build_object(''reservation'',to_jsonb(r),''contract'',c);',
 ' update public.contracts set fields=fields||jsonb_build_object(''proprietor_signature'',(select proprietor - ''address'' - ''phone'' - ''name'' from public.contract_defaults where property_id=r.property_id),''proprietor_signature_date'',(now() at time zone ''Australia/Adelaide'')::date) where id=(c->>''id'')::uuid returning to_jsonb(contracts.*) into c;
 return jsonb_build_object(''reservation'',to_jsonb(r),''contract'',c);');
 execute src;
end $$;
update public.contract_defaults set draft_terms=$terms$1. Application of the Act and Regulations
The proprietor and the resident are legally bound to comply with the provisions of the Residential Tenancies Act 1995 and associated Regulations. An agreement or arrangement that is inconsistent with this Act or purports to exclude, modify or restrict the operation of this Act, is (unless the inconsistency, exclusion, modification or restriction is expressly permitted under the Act) to that extent void.

2. House rules
The proprietor may make written rules about conduct or behaviour of the residents, known as house rules. Any house rules in operation will be taken to be terms of this agreement. A copy of the house rules will be on display in a prominent place at all times. On request, the proprietor will provide a copy of the house rules to the resident. The proprietor will only make house rules that are reasonable and that help maintain the health and safety of persons or the safety of property. The proprietor will give the resident seven days notice of any change to the house rules.

3. Proprietor’s obligation to repair and keep premises clean
The proprietor will hand over the room in a reasonable state of cleanliness, maintain the room and ancillary property in a reasonable state of repair and abide by all legal requirements affecting the rooming house. These include any new or replacement appliances, fittings or fixtures meeting required energy and water efficiency standards. The proprietor will ensure that all shared facilities are kept in a reasonable state of cleanliness. The proprietor will give the resident not less than 14 days notice of renovations to the rooming house and will minimise inconvenience to the resident if carrying out renovations to shared bathroom, toilet or laundry facilities.

4. Maintenance of room - resident
The resident will keep the room in a reasonable state of cleanliness and will notify the proprietor of any damage to the rooming house or any state of disrepair that arises during the agreement. The resident will not intentionally or negligently cause or permit damage to the rooming house or ancillary property. The resident will keep the room in a condition that does not give rise to a fire or health hazard.

6. Use of the rooming house
The resident will not use, allow or cause the rooming house to be used for any illegal purpose. The resident will not cause or permit an interference with the reasonable peace, comfort or privacy of other residents of the rooming house. The resident will not keep an animal on the premises without the proprietor’s consent.

7. Resident's right to peace comfort and privacy
The proprietor will not unreasonably restrict or interfere with the quiet enjoyment of the resident’s room or facilities at the rooming house by the resident or the reasonable peace, comfort or privacy of the resident in their use of the room or facilities at the rooming house. The proprietor will ensure that the resident has reasonable access at all times to the resident’s room and to the toilet and bathroom facilities.

8. Proprietor's right of entry
The resident is required to give the proprietor reasonable access to the room. The proprietor will exercise his or her right of access to the resident's room in a reasonable manner and will not stay in the room longer than is necessary to achieve the purpose of entry without the resident's consent.

9. Security of personal property
The proprietor will provide and maintain the locks and other devices that are necessary to ensure the resident may make his or her room reasonably secure. Neither the proprietor nor the resident will alter, remove or add a lock or security device without the consent of the other. Neither the proprietor nor the resident will unreasonably withhold his or her consent to the alteration or removal of a lock or security device by the other. The proprietor will take reasonable steps to ensure the security of personal property of each resident of the rooming house and will provide the resident with a lockable cupboard or other facility to keep personal property secure.

10. Statutory charges
The proprietor must bear all statutory charges imposed in respect of the accommodation. However, the proprietor may require the resident to make a payment for rates and charges for water supply; or for the provision of electricity, gas or telephone services at the premises; or for meals or other facilities or services (such as meals, cleaning and laundry of linen) provided by the proprietor. The proprietor will, before the facilities or services are made available or provided to the resident, inform the resident in writing of the basis on which charges for those facilities or services will be made.

11. Sale of the rooming house
The proprietor will give the resident written notice of the proprietor’s intention to sell the rooming house not later than 14 days after entering into a sales agency agreement for the sale of the premises. The rooming house will not be advertised for sale or made available for inspection by prospective purchasers until 14 days after the resident is notified of the proprietor’s intention to sell the rooming house. If the rooming house is sold, the proprietor will give the resident written notice of the name of the purchaser and the date from which rent is to be paid to him or her.

Additional SAKAN terms
Electricity, water, gas and internet are included in the agreed rent without additional charges. No utility threshold or excess surcharge applies.

House conduct
Bullying, harassment, smoking and alcohol or other intoxication are not permitted in the house. Overnight visitors require advance permission from management. Any enforcement or termination must follow the Residential Tenancies Act 1995 and applicable notice requirements.

Payment arrangements
Pay the agreed bond using PayID 0426721787 and reply to sakanlodges@gmail.com with the signed agreement and payment receipt. Remaining rent may be paid on arrival. Rent is payable fortnightly in advance unless an explicit nightly arrangement is stated in the agreement. Bond money is to be lodged with Consumer and Business Services as required.

Source
Standard clauses adapted from Consumer and Business Services, Rooming house agreement, September 2025, available via sa.gov.au/renting. SAKAN Lodge is independent of government.$terms$;
commit;
