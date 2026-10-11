-- Keep the full utility expense and resident-level excess charges atomic.
-- Run this after supabase/schema.sql, including on existing projects.
create or replace function public.post_electricity_bill(
  p_property_id uuid,
  p_bill_date date,
  p_q_start date,
  p_q_end date,
  p_amount numeric,
  p_shares jsonb
) returns void
language plpgsql
set search_path = public
as $$
declare
  item jsonb;
begin
  if p_q_start is null or p_q_end is null or p_q_start > p_q_end then
    raise exception 'Invalid electricity quarter dates';
  end if;
  if p_bill_date is null or p_amount is null or p_amount <= 0 then
    raise exception 'Bill date and a positive bill amount are required';
  end if;

  insert into expenses(property_id, date, category, amount, note, paid_from, reimbursed)
  values (p_property_id, p_bill_date, 'Electricity', p_amount,
          format('Quarter %s to %s', p_q_start, p_q_end), 'business', false);

  for item in
    select value from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) as share_items(value)
  loop
    if (item->>'amount') is null or (item->>'amount')::numeric < 0 then
      raise exception 'Invalid resident electricity share';
    end if;
    insert into charges(person_id, kind, period_start, period_end, due_date, amount, note)
    values (
      (item->>'personId')::uuid,
      'electricity',
      p_q_start,
      p_q_end,
      p_bill_date,
      (item->>'amount')::numeric,
      format('Electricity over cap: %s of %s nights', item->>'nights', item->>'totalNights')
    );
  end loop;
end;
$$;

revoke all on function public.post_electricity_bill(uuid, date, date, date, numeric, jsonb) from public;
grant execute on function public.post_electricity_bill(uuid, date, date, date, numeric, jsonb) to authenticated;
