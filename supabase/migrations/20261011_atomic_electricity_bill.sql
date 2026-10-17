-- Atomic electricity expense and resident share posting.
create or replace function public.post_electricity_bill(
  p_property_id uuid, p_bill_date date, p_q_start date, p_q_end date,
  p_amount numeric, p_shares jsonb
) returns void
language plpgsql
set search_path = public
as $$
declare item jsonb;
begin
  if p_q_start is null or p_q_end is null or p_q_start > p_q_end then
    raise exception 'Invalid electricity quarter dates';
  end if;
  if p_bill_date is null or p_amount is null or p_amount <= 0
     or p_amount <> round(p_amount, 2) then
    raise exception 'Bill date and a positive two-decimal bill amount are required';
  end if;
  if p_shares is not null and jsonb_typeof(p_shares) <> 'array' then
    raise exception 'Electricity shares must be an array';
  end if;
  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Property not found';
  end if;

  insert into public.expenses(property_id, date, category, amount, note, paid_from, reimbursed)
  values (p_property_id, p_bill_date, 'Electricity', p_amount,
          format('Quarter %s to %s', p_q_start, p_q_end), 'business', false);

  for item in select value from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) as shares(value)
  loop
    if jsonb_typeof(item) <> 'object'
       or (item->>'amount') is null
       or (item->>'amount') !~ '^[0-9]+([.][0-9]{1,2})?$'
       or (item->>'amount')::numeric <= 0 then
      raise exception 'Invalid resident electricity share';
    end if;
    if (item->>'personId') is null or (item->>'personId') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'Invalid resident identifier';
    end if;
    if not exists (
      select 1 from public.people
      where id = (item->>'personId')::uuid and property_id = p_property_id
    ) then
      raise exception 'Electricity share resident does not belong to the selected property';
    end if;
    insert into public.charges(person_id, kind, period_start, period_end, due_date, amount, note)
    values ((item->>'personId')::uuid, 'electricity', p_q_start, p_q_end,
            p_bill_date, (item->>'amount')::numeric,
            format('Electricity over cap: %s of %s nights', item->>'nights', item->>'totalNights'));
  end loop;
end;
$$;

revoke all on function public.post_electricity_bill(uuid, date, date, date, numeric, jsonb) from public;
grant execute on function public.post_electricity_bill(uuid, date, date, date, numeric, jsonb) to authenticated;
