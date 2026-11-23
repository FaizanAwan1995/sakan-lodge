alter table public.incoming_alert_deliveries
  add column cleaning_receipt_key uuid,
  add column cleaning_confirmed_at timestamptz;
create unique index incoming_cleaning_receipt_key on public.incoming_alert_deliveries(cleaning_receipt_key)
  where cleaning_receipt_key is not null;

create function sakan_private.attach_cleaning_receipt() returns trigger
language plpgsql set search_path='' as $$
begin
  new.cleaning_receipt_key := gen_random_uuid();
  new.body := new.body || E'\n\nPlease confirm you received this reminder:\nhttps://sakanlodge.com/cleaning-receipt/' || new.cleaning_receipt_key::text;
  return new;
end $$;
create trigger attach_cleaning_receipt before insert or update of body on public.incoming_alert_deliveries
  for each row when (new.kind='cleaning' and new.status='pending' and new.cleaning_receipt_key is null)
  execute function sakan_private.attach_cleaning_receipt();
update public.incoming_alert_deliveries set body=body where kind='cleaning' and status='pending' and cleaning_receipt_key is null;

create function public.confirm_cleaning_receipt(receipt_key uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.incoming_alert_deliveries d
     set cleaning_confirmed_at=coalesce(d.cleaning_confirmed_at,now())
   where d.cleaning_receipt_key=receipt_key and d.kind='cleaning' and d.status<>'cancelled'
     and exists(select 1 from public.cleaning_shifts s where s.delivery_key=d.source_id);
  return found;
end $$;
revoke all on function public.confirm_cleaning_receipt(uuid) from public,anon,authenticated;
grant execute on function public.confirm_cleaning_receipt(uuid) to service_role;

create function public.cleaning_reminder_receipts()
returns table(shift_id uuid,recipient text,status text,confirmation_available boolean,confirmed_at timestamptz)
language sql stable security definer set search_path='' as $$
  select s.id,d.recipient,d.status,d.cleaning_receipt_key is not null,d.cleaning_confirmed_at
    from public.cleaning_shifts s join public.incoming_alert_deliveries d on d.source_id=s.delivery_key and d.kind='cleaning'
    where public.is_sakan_staff();
$$;
revoke all on function public.cleaning_reminder_receipts() from public,anon;
grant execute on function public.cleaning_reminder_receipts() to authenticated;
