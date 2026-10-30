-- Shared, admin-managed marketing galleries; independent of room availability.
create table public.accommodation_segment_photos (
 segment text primary key check(segment in ('men','women','couples')),
 photos jsonb not null default '[]'::jsonb check(jsonb_typeof(photos)='array' and jsonb_array_length(photos)<=20),
 revision integer not null default 1,
 updated_at timestamptz not null default now()
);
alter table public.accommodation_segment_photos enable row level security;
revoke all on public.accommodation_segment_photos from anon,authenticated;
grant select on public.accommodation_segment_photos to anon,authenticated,service_role;
create policy published_segment_photos on public.accommodation_segment_photos for select to anon,authenticated,service_role using(true);
insert into public.accommodation_segment_photos(segment,photos) values
 ('men','["/room-photos/shared-room-twin.webp"]'),
 ('women','["/property-photos/sakan-fulham-women-room-1.webp","/property-photos/sakan-fulham-women-room-2.webp"]'),
 ('couples','["/room-photos/private-room-single.webp"]');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('segment-photos','segment-photos',true,5242880,array['image/jpeg','image/png','image/webp']);
create policy segment_photo_staff_insert on storage.objects for insert to authenticated with check(bucket_id='segment-photos' and (select public.is_sakan_staff()) and name ~ '^(men|women|couples)/[a-f0-9-]{36}\.jpg$');
create policy segment_photo_staff_select on storage.objects for select to authenticated using(bucket_id='segment-photos' and (select public.is_sakan_staff()));

create function public.public_segment_photos() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(segment,photos),'{}'::jsonb) from public.accommodation_segment_photos;
$$;
revoke all on function public.public_segment_photos() from public;
grant execute on function public.public_segment_photos() to anon,authenticated,service_role;

create function sakan_private.save_segment_photos(p_segment text,p_photos jsonb,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare gallery public.accommodation_segment_photos; photo jsonb; url text; path text;
begin
 perform sakan_private.require_staff();
 select * into gallery from public.accommodation_segment_photos where segment=p_segment for update;
 if not found then raise exception 'Choose Men, Women or Couples';end if;
 if gallery.revision is distinct from p_revision then raise exception 'Photos changed. Reload this gallery before saving';end if;
 if p_photos is null or jsonb_typeof(p_photos)<>'array' or jsonb_array_length(p_photos)>20 then raise exception 'Choose up to 20 photos';end if;
 if (select count(distinct value) from jsonb_array_elements(p_photos))<>jsonb_array_length(p_photos) then raise exception 'Duplicate photo';end if;
 for photo in select value from jsonb_array_elements(p_photos) loop
  if jsonb_typeof(photo)<>'string' then raise exception 'Invalid photo';end if;
  url:=photo#>>'{}';
  if url in ('/room-photos/shared-room-twin.webp','/room-photos/private-room-single.webp','/property-photos/sakan-fulham-women-room-1.webp','/property-photos/sakan-fulham-women-room-2.webp') then continue;end if;
  if url !~ ('^https://gpohuctqsmmoikupyfvi\.supabase\.co/storage/v1/object/public/segment-photos/'||p_segment||'/[a-f0-9-]{36}\.jpg$') then raise exception 'Upload a photo to this segment first';end if;
  path:=substring(url from '/segment-photos/(.*)$');
  if not exists(select 1 from storage.objects where bucket_id='segment-photos' and name=path) then raise exception 'Uploaded photo not found';end if;
 end loop;
 update public.accommodation_segment_photos set photos=p_photos,revision=revision+1,updated_at=now() where segment=p_segment returning * into gallery;
 insert into public.audit("by",action,entity_table,entity_id,reason) values(auth.uid()::text,'segment_photos_updated','accommodation_segment_photos',p_segment,'Admin approved public website gallery; '||jsonb_array_length(p_photos)||' photos.');
 return to_jsonb(gallery);
end $$;
create function public.save_segment_photos(p_segment text,p_photos jsonb,p_revision integer) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.save_segment_photos(p_segment,p_photos,p_revision)$$;
revoke all on function sakan_private.save_segment_photos(text,jsonb,integer),public.save_segment_photos(text,jsonb,integer) from public,anon,service_role;
grant execute on function sakan_private.save_segment_photos(text,jsonb,integer),public.save_segment_photos(text,jsonb,integer) to authenticated;
