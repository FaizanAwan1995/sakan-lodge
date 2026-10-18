-- Owner decision: all current ledger vacancies and completed checkouts update
-- approved listings automatically. No fabricated checkout or release records.
-- Content approval/readiness and atomic physical inventory validation remain.
begin;
create or replace function sakan_private.guard_released_publication() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.published and not new.ready then
  raise exception 'Verify readiness before approving publication';
 end if;
 return new;
end $$;

create or replace function sakan_private.catalog() returns jsonb language sql stable security definer set search_path='' as $$
 with eligible as (
  select r.*,rp.slug,rp.title,rp.description,rp.photos,rp.amenities,rp.ready
  from public.rooms r join public.room_profiles rp on rp.room_id=r.id join public.property_profiles pp on pp.property_id=r.property_id
  where rp.published and rp.approved_at is not null and rp.ready and pp.published and pp.approved_at is not null
  and sakan_private.free_spaces(r.id,(now() at time zone 'Australia/Adelaide')::date,(now() at time zone 'Australia/Adelaide')::date+1)>0
 ) select jsonb_build_object('properties',coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.property_id,'slug',p.slug,'name',p.public_name,'suburb',p.suburb,'description',p.description,'photos',p.photos,'amenities',p.amenities
 ) order by p.suburb,p.slug) from public.property_profiles p where p.published and p.approved_at is not null and exists(select 1 from eligible e where e.property_id=p.property_id)),'[]'::jsonb),
 'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'property_id',r.property_id,'slug',r.slug,'title',r.title,'description',r.description,'photos',r.photos,'amenities',r.amenities,'capacity',r.capacity,'offer_type',case when r.capacity=1 then 'private' else 'shared' end,'ready',r.ready)
 order by r.sort,r.slug) from eligible r),'[]'::jsonb));
$$;

create or replace function sakan_private.availability(p_room uuid,p_arrival date,p_departure date) returns jsonb language plpgsql security definer set search_path='' as $$
declare cap integer; free integer; short boolean;
begin
 if p_arrival is null or p_departure is null or p_departure<=p_arrival then raise exception 'Invalid stay dates'; end if;
 select r.capacity into cap from public.rooms r join public.room_profiles rp on rp.room_id=r.id join public.property_profiles pp on pp.property_id=r.property_id
 where r.id=p_room and rp.published and rp.approved_at is not null and rp.ready and pp.published and pp.approved_at is not null;
 if not found then raise exception 'Listing unavailable' using errcode='P0002'; end if;
 short:=p_departure<(p_arrival+interval '2 months')::date;
 if cap>1 and short then raise exception 'Shared rooms require at least two calendar months'; end if;
 free:=sakan_private.free_spaces(p_room,p_arrival,p_departure);
 return jsonb_build_object('spaces',free,'offer_type',case when cap=1 then 'private' else 'shared' end,'stay_type',case when short then 'short' else 'long' end,'weekly_rate',case when cap>1 then 185 when short then 300 else 255 end,'requests_enabled',(select requests_enabled from public.booking_settings where id));
end $$;


create or replace function sakan_private.save_listing(p_kind text,p_id uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare approved boolean:=coalesce((p_data->>'published')::boolean,false); parent uuid; cap integer; photo jsonb; current_revision integer;
begin
 perform sakan_private.require_staff();
 if coalesce(p_data->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_data->>'slug')>90 then raise exception 'Use a lowercase URL slug'; end if;
 if length(coalesce(p_data->>'description',''))>6000 then raise exception 'Description too long'; end if;
 if jsonb_typeof(coalesce(p_data->'photos','[]'))<>'array' or jsonb_array_length(coalesce(p_data->'photos','[]'))>20 or jsonb_typeof(coalesce(p_data->'amenities','[]'))<>'array' then raise exception 'Invalid photos or amenities'; end if;
 for photo in select value from jsonb_array_elements(coalesce(p_data->'photos','[]')) loop
  if jsonb_typeof(photo)<>'string' or (photo#>>'{}') !~ '^https://[^[:space:]<>]+$' then raise exception 'Photo URLs must use HTTPS'; end if;
 end loop;
 if p_kind='property' then
  perform id from public.properties where id=p_id for update;
  if not found then raise exception 'Property not found'; end if;
  select revision into current_revision from public.property_profiles where property_id=p_id;
  if found and (p_data->>'revision')::integer is distinct from current_revision then raise exception 'Listing changed. Reload before approving' using errcode='40001'; end if;
  if p_data->>'suburb' not in ('Fulham','Clapham','Oaklands Park') then raise exception 'Unsupported public suburb'; end if;
  if approved and (length(trim(coalesce(p_data->>'public_name','')))<3 or length(trim(coalesce(p_data->>'description','')))<20) then raise exception 'Verify public name and description before publishing'; end if;
  insert into public.property_profiles(property_id,slug,public_name,suburb,description,photos,amenities,published,approved_by,approved_at)
  values(p_id,p_data->>'slug',p_data->>'public_name',p_data->>'suburb',p_data->>'description',coalesce(p_data->'photos','[]'),coalesce(p_data->'amenities','[]'),approved,case when approved then auth.uid() end,case when approved then now() end)
  on conflict(property_id) do update set slug=excluded.slug,public_name=excluded.public_name,suburb=excluded.suburb,description=excluded.description,photos=excluded.photos,amenities=excluded.amenities,published=excluded.published,approved_by=excluded.approved_by,approved_at=excluded.approved_at,revision=property_profiles.revision+1;
 elsif p_kind='room' then
  select property_id,capacity into parent,cap from public.rooms where id=p_id;
  perform id from public.properties where id=parent for update;
  perform id from public.rooms where id=p_id for update;
  if cap is null then raise exception 'Room not found'; end if;
  select revision into current_revision from public.room_profiles where room_id=p_id;
  if found and (p_data->>'revision')::integer is distinct from current_revision then raise exception 'Listing changed. Reload before approving' using errcode='40001'; end if;
  if exists(select 1 from public.room_profiles rp join public.rooms r on r.id=rp.room_id where r.property_id=parent and rp.room_id<>p_id and rp.slug=p_data->>'slug') then raise exception 'Room slug already used at this property'; end if;
  if approved and (length(trim(coalesce(p_data->>'title','')))<3 or length(trim(coalesce(p_data->>'description','')))<20) then raise exception 'Verify room title and description before publishing'; end if;
  insert into public.room_profiles(room_id,slug,title,description,photos,amenities,offer_type,ready,published,approved_by,approved_at)
  values(p_id,p_data->>'slug',p_data->>'title',p_data->>'description',coalesce(p_data->'photos','[]'),coalesce(p_data->'amenities','[]'),case when cap=1 then 'private' else 'shared' end,coalesce((p_data->>'ready')::boolean,false),approved,case when approved then auth.uid() end,case when approved then now() end)
  on conflict(room_id) do update set slug=excluded.slug,title=excluded.title,description=excluded.description,photos=excluded.photos,amenities=excluded.amenities,offer_type=excluded.offer_type,ready=excluded.ready,published=excluded.published,approved_by=excluded.approved_by,approved_at=excluded.approved_at,revision=room_profiles.revision+1;
 else raise exception 'Unknown listing type'; end if;
 insert into public.audit("by",action) values(auth.uid()::text,case when approved then 'approved public ' else 'saved draft ' end||p_kind||' profile '||p_id);
end $$;
-- Retire the manual workflow rather than letting an older client unpublish a
-- verified profile or give a misleading impression that withdrawal blocks it.
create or replace function sakan_private.release_listing(p_person uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform sakan_private.require_staff();
 raise exception 'Availability now follows the ledger automatically. Manage readiness and publication in Listings.';
end $$;
create or replace function sakan_private.withdraw_listing_release(p_release uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform sakan_private.require_staff();
 raise exception 'Availability now follows the ledger automatically. Unpublish or mark the room not ready in Listings.';
end $$;
commit;
