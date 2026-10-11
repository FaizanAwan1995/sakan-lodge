-- Keep the audit trigger callable by triggers, but not directly through the API.
revoke execute on function public.log_change() from public, anon, authenticated;

-- Index foreign keys used for joins, deletes, and property/room filters.
create index if not exists rooms_property_id_idx on rooms(property_id);
create index if not exists people_property_id_idx on people(property_id);
create index if not exists people_room_id_idx on people(room_id);
create index if not exists charges_person_id_idx on charges(person_id);
create index if not exists payments_person_id_idx on payments(person_id);
create index if not exists payments_property_id_idx on payments(property_id);
create index if not exists expenses_property_id_idx on expenses(property_id);
create index if not exists maintenance_property_id_idx on maintenance(property_id);
create index if not exists maintenance_room_id_idx on maintenance(room_id);
create index if not exists audit_at_idx on audit(at desc);
