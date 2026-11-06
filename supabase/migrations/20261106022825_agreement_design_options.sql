alter table public.agreement_templates add column design jsonb not null default '{}'::jsonb;
alter table public.agreement_templates add constraint agreement_design_valid check (
 jsonb_typeof(design)='object'
 and coalesce(design->>'theme','navy') in ('navy','forest','plum')
 and coalesce(design->>'fontSize','10') in ('10','11','12')
 and coalesce(design->>'title','ROOMING HOUSE AGREEMENT') ~ '^[ -~]{1,32}$'
 and (not design ? 'showLogo' or jsonb_typeof(design->'showLogo')='boolean')
);
create or replace function sakan_private.approve_agreement_template(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.agreement_templates;
begin
 perform sakan_private.require_staff();
 if p_data->>'confirmation'<>'APPROVE_REUSABLE_TEMPLATE' or p_data->>'confirmation' is null then raise exception 'Review and approve the reusable template'; end if;
 if length(trim(coalesce(p_data->'proprietor'->>'name','')))<2 or length(trim(coalesce(p_data->'proprietor'->>'address','')))<5 or length(trim(coalesce(p_data->'proprietor'->>'phone','')))<5 then raise exception 'Proprietor name, address and contact required'; end if;
 if coalesce(p_data->>'terms','') ~* '(\[(ENTER|VERIFY|ADD|CONFIRM|FORM TEMPLATE|DATE|TIME|AMOUNT|[A-Z]+_[A-Z]+)[^]]*\]|\{\{)' then raise exception 'Resolve template placeholders'; end if;
 if coalesce(p_data->>'terms','') ~* '(\$800|electricity.{0,40}threshold|excess.{0,40}(electricity|utility)|evacuation.{0,40}without.{0,10}notice)' then raise exception 'Review obsolete utility surcharge or immediate-eviction wording before approval'; end if;
 insert into public.agreement_templates(title,terms,proprietor,approved_by) values(trim(p_data->>'title'),trim(p_data->>'terms'),jsonb_build_object('name',p_data->'proprietor'->>'name','address',p_data->'proprietor'->>'address','phone',p_data->'proprietor'->>'phone'),auth.uid()) returning * into t;
 insert into public.audit("by",action) values(auth.uid()::text,'approved private agreement template '||t.id);
 update public.agreement_templates set design=coalesce(p_data->'design','{}'::jsonb) where id=t.id returning * into t;
 return to_jsonb(t);
end $$;

create function sakan_private.snapshot_agreement_design() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.fields->>'template_id' is distinct from old.fields->>'template_id' then
  if old.document_path is not null then raise exception 'Generate a new agreement version before changing its design'; end if;
  new.fields := new.fields || jsonb_build_object('design',coalesce((select design from public.agreement_templates where id=(new.fields->>'template_id')::uuid),'{}'::jsonb));
 end if;
 return new;
end $$;
revoke all on function sakan_private.snapshot_agreement_design() from public,anon,authenticated;
create trigger snapshot_agreement_design before update of fields on public.contracts for each row execute function sakan_private.snapshot_agreement_design();
