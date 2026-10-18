-- Return only the customer request gate flag. Never expose booking_settings
-- or resident data to anonymous clients.
create or replace function public.customer_requests_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.requests_enabled from public.booking_settings b where b.id = true),
    false
  )
$$;

revoke all on function public.customer_requests_enabled() from public;
grant execute on function public.customer_requests_enabled() to anon, authenticated;
