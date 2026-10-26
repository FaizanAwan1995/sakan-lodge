begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('room-photos','room-photos',true,5242880,array['image/jpeg','image/png','image/webp']);
create policy room_photo_staff_insert on storage.objects for insert to authenticated with check(bucket_id='room-photos' and public.is_sakan_staff() and exists(select 1 from public.rooms r where r.id::text=split_part(name,'/',1)));
create policy room_photo_staff_select on storage.objects for select to authenticated using(bucket_id='room-photos' and public.is_sakan_staff());
create policy room_photo_staff_delete on storage.objects for delete to authenticated using(bucket_id='room-photos' and public.is_sakan_staff());
create function sakan_private.save_room_photos(p_room uuid,p_photos jsonb,p_revision integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare room public.rooms;profile public.room_profiles;photo jsonb;
begin
 perform sakan_private.require_staff();
 select * into room from public.rooms where id=p_room for update;
 if not found then raise exception 'Room not found';end if;
 select * into profile from public.room_profiles where room_id=p_room for update;
 if profile.room_id is not null and profile.revision is distinct from p_revision or profile.room_id is null and p_revision is not null then raise exception 'Room photos changed. Reload the gallery before saving';end if;
 if p_photos is null or jsonb_typeof(p_photos)<>'array' or jsonb_array_length(p_photos)>20 then raise exception 'Choose up to 20 room photos';end if;
 for photo in select value from jsonb_array_elements(p_photos) loop
  if jsonb_typeof(photo)<>'string' or (photo#>>'{}') !~ '^https://[^[:space:]<>]+$' or length(photo#>>'{}')>2000 then raise exception 'Photo URLs must use HTTPS';end if;
 end loop;
 insert into public.room_profiles(room_id,title,slug,photos,offer_type) values(room.id,room.label,'room-'||room.id::text,p_photos,case when room.capacity>1 then 'shared' else 'private' end)
 on conflict(room_id) do update set photos=excluded.photos,revision=room_profiles.revision+1 returning * into profile;
 insert into public.audit("by",action,entity_table,entity_id,reason) values(auth.uid()::text,'room_photos_updated','rooms',room.id::text,'Admin confirmed photos are suitable for public listing; '||jsonb_array_length(p_photos)||' photos. Publication and readiness unchanged.');
 return to_jsonb(profile);
end $$;
create function public.save_room_photos(p_room uuid,p_photos jsonb,p_revision integer default null) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.save_room_photos(p_room,p_photos,p_revision)$$;
revoke all on function sakan_private.save_room_photos(uuid,jsonb,integer),public.save_room_photos(uuid,jsonb,integer) from public,anon,service_role;
grant execute on function sakan_private.save_room_photos(uuid,jsonb,integer),public.save_room_photos(uuid,jsonb,integer) to authenticated;
commit;
