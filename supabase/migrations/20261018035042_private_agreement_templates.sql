-- Private immutable template versions. No source agreement, personal data or signature is seeded.
create table public.agreement_templates (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(title) between 2 and 160),
 terms text not null check(length(terms) between 40 and 30000),
 proprietor jsonb not null,
 approved_by uuid not null,
 approved_at timestamptz not null default now()
);
alter table public.agreement_templates enable row level security;
create policy staff_template_read on public.agreement_templates for select to authenticated using(public.is_sakan_staff());
revoke all on public.agreement_templates from public,anon,authenticated;
grant select on public.agreement_templates to authenticated;

create function sakan_private.approve_agreement_template(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.agreement_templates;
begin
 perform sakan_private.require_staff();
 if p_data->>'confirmation'<>'APPROVE_REUSABLE_TEMPLATE' or p_data->>'confirmation' is null then raise exception 'Review and approve the reusable template'; end if;
 if length(trim(coalesce(p_data->'proprietor'->>'name','')))<2 or length(trim(coalesce(p_data->'proprietor'->>'address','')))<5 or length(trim(coalesce(p_data->'proprietor'->>'phone','')))<5 then raise exception 'Proprietor name, address and contact required'; end if;
 if coalesce(p_data->>'terms','') ~* '(\[(ENTER|VERIFY|ADD|CONFIRM|FORM TEMPLATE|DATE|TIME|AMOUNT|[A-Z]+_[A-Z]+)[^]]*\]|\{\{)' then raise exception 'Resolve template placeholders'; end if;
 if coalesce(p_data->>'terms','') ~* '(\$800|electricity.{0,40}threshold|excess.{0,40}(electricity|utility)|evacuation.{0,40}without.{0,10}notice)' then raise exception 'Review obsolete utility surcharge or immediate-eviction wording before approval'; end if;
 insert into public.agreement_templates(title,terms,proprietor,approved_by) values(trim(p_data->>'title'),trim(p_data->>'terms'),jsonb_build_object('name',p_data->'proprietor'->>'name','address',p_data->'proprietor'->>'address','phone',p_data->'proprietor'->>'phone'),auth.uid()) returning * into t;
 insert into public.audit("by",action) values(auth.uid()::text,'approved private agreement template '||t.id);
 return to_jsonb(t);
end $$;
create function public.approve_agreement_template(p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.approve_agreement_template(p_data)$$;
revoke all on function sakan_private.approve_agreement_template(jsonb),public.approve_agreement_template(jsonb) from public;
grant execute on function sakan_private.approve_agreement_template(jsonb),public.approve_agreement_template(jsonb) to authenticated;

create function sakan_private.create_template_contract(p_res uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reservations; t public.agreement_templates; c public.contracts; names jsonb; rate numeric; bond numeric;
begin
 perform sakan_private.require_staff();
 select * into r from public.reservations where id=p_res for update;
 if not found then raise exception 'Reservation not found'; end if;
 if (p_data->>'revision')::integer is distinct from r.revision then raise exception 'Reservation changed. Refresh before drafting' using errcode='40001'; end if;
 select * into t from public.agreement_templates where id=(p_data->>'template_id')::uuid;
 if not found then raise exception 'Approved private template required'; end if;
 names:=p_data->'resident_names';
 if jsonb_typeof(names) is distinct from 'array' then raise exception 'List every resident'; end if;
 if jsonb_array_length(names)<>r.spaces_requested or exists(select 1 from jsonb_array_elements_text(names) n where length(trim(n))<2) then raise exception 'List every resident'; end if;
 if length(trim(coalesce(p_data->>'premises_address','')))<5 or length(trim(coalesce(p_data->>'term_description','')))<3 then raise exception 'Verified premises and explicit agreement term required'; end if;
 if (p_data->>'first_rent_due')::date is null then raise exception 'First rent due date required'; end if;
 bond:=(p_data->>'bond')::numeric;
 if bond is null or bond<0 or bond::text in ('NaN','Infinity','-Infinity') or round(bond,2)<>bond then raise exception 'Explicit bond amount in cents required'; end if;
 if r.departure_date-r.arrival_date<7 then
  rate:=(p_data->>'nightly_rate')::numeric;
  if rate is null or rate<=0 or rate::text in ('NaN','Infinity','-Infinity') or round(rate,2)<>rate then raise exception 'Explicit nightly rate in cents required'; end if;
 end if;
 c:=jsonb_populate_record(null::public.contracts,sakan_private.manage_contract(p_res,'draft',jsonb_build_object('terms',t.terms,'template_reference',t.title||' / '||t.id)));
 update public.contracts set fields=fields||jsonb_build_object('template_id',t.id,'proprietor',t.proprietor,'email',r.email,'phone',r.phone,'resident_names',names,'premises_address',trim(p_data->>'premises_address'),'room_label',(select label from public.rooms where id=r.room_id),'term_description',trim(p_data->>'term_description'),'bond',bond,'first_rent_due',(p_data->>'first_rent_due')::date,'billing_type',case when rate is null then 'fortnightly' else 'nightly' end,'nightly_rate',rate,'payment_method',case when rate is null then 'Cash or direct transfer; fortnightly rent in advance on the house cycle' else 'Cash or direct transfer; agreed nightly rent in advance' end) where id=c.id returning * into c;
 return to_jsonb(c);
end $$;
create function public.create_template_contract(p_res uuid,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.create_template_contract(p_res,p_data)$$;
revoke all on function sakan_private.create_template_contract(uuid,jsonb),public.create_template_contract(uuid,jsonb) from public;
grant execute on function sakan_private.create_template_contract(uuid,jsonb),public.create_template_contract(uuid,jsonb) to authenticated;
