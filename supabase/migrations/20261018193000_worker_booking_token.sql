-- A least-privilege alternative to deploying Supabase's unrestricted service key.
-- The Worker alone possesses the 32-byte random token; Postgres stores only
-- its SHA-256 digest. Direct public RPC clients cannot pass this check.
-- The wrapper can ONLY submit a pending reservation via existing server logic.

create table if not exists sakan_private.booking_worker_credentials (
  singleton boolean primary key default true check (singleton),
  token_sha256 bytea not null check (octet_length(token_sha256) = 32),
  updated_at timestamptz not null default now()
);

revoke all on table sakan_private.booking_worker_credentials
  from public, anon, authenticated;

create or replace function public.submit_reservation_from_worker(
  p_data jsonb,
  p_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_headers jsonb;
  provided_token text;
begin
  -- PostgREST forwards HTTP headers to this transaction through this GUC.
  request_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  provided_token := request_headers ->> 'x-sakan-reservation-auth';

  if provided_token is null
     or length(provided_token) <> 64
     or provided_token !~ '^[a-f0-9]{64}$'
     or not exists (
       select 1
       from sakan_private.booking_worker_credentials c
       where c.singleton = true
         and c.token_sha256 = extensions.digest(
           pg_catalog.decode(provided_token, 'hex'),
           'sha256'
         )
     )
  then
    raise exception 'Booking gateway not authorized' using errcode = '42501';
  end if;

  -- The existing function checks the off-by-default booking switch, locks the
  -- selected room, validates dates and rates, and inserts only pending requests.
  return sakan_private.submit_request(p_data, p_key, false);
end;
$$;

revoke all on function public.submit_reservation_from_worker(jsonb, uuid)
  from public, authenticated;
grant execute on function public.submit_reservation_from_worker(jsonb, uuid)
  to anon;
