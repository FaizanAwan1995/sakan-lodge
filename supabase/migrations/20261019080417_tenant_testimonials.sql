-- Private submissions; the public API exposes only explicitly published fields.
create schema sakan_reviews;
revoke all on schema sakan_reviews from public;
grant usage on schema sakan_reviews to anon, authenticated, service_role;
create table sakan_reviews.testimonials (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique,
 display_name text not null check(char_length(display_name) between 2 and 60 and display_name !~ E'[\n\r]'),
 email text not null check(char_length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 rating smallint not null check(rating between 1 and 5),
 review text not null check(char_length(review) between 20 and 1200),
 suburb text not null default '' check(suburb in ('','Fulham','Clapham','Oaklands Park')),
 consent boolean not null check(consent),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending' check(status in ('pending','published','hidden','rejected')),
 stay_verified boolean not null default false, revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 moderated_by uuid, published_at timestamptz,
 check(status <> 'published' or (stay_verified and published_at is not null))
);
alter table sakan_reviews.testimonials enable row level security;
revoke all on sakan_reviews.testimonials from public,anon,authenticated,service_role;
create index testimonials_email_time on sakan_reviews.testimonials(email,created_at desc);
create index testimonials_fingerprint_time on sakan_reviews.testimonials(fingerprint,created_at desc);
create index testimonials_published_time on sakan_reviews.testimonials(published_at desc) where status='published';

create function sakan_reviews.published() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.published_at desc),'[]'::jsonb) from (
 select id,display_name,rating,review,suburb,published_at from sakan_reviews.testimonials
 where status='published' and consent and stay_verified order by published_at desc,id limit 20
 ) x;
$$;
revoke all on function sakan_reviews.published() from public,anon,authenticated,service_role;
grant execute on function sakan_reviews.published() to anon,authenticated,service_role;
create function public.published_testimonials() returns jsonb language sql stable security invoker set search_path='' as $$ select sakan_reviews.published() $$;
revoke all on function public.published_testimonials() from public,anon,authenticated,service_role;
grant execute on function public.published_testimonials() to anon,authenticated,service_role;

create function sakan_reviews.submit(p_data jsonb,p_key uuid,p_fingerprint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing sakan_reviews.testimonials; v_name text:=btrim(p_data->>'display_name'); v_email text:=lower(btrim(p_data->>'email')); v_review text:=btrim(p_data->>'review'); v_suburb text:=coalesce(p_data->>'suburb',''); v_rating smallint;
begin
 if p_key is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or
  v_name is null or char_length(v_name) not between 2 and 60 or v_name ~ E'[\n\r]' or
  v_email is null or char_length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or
  v_review is null or char_length(v_review) not between 20 and 1200 or
  v_suburb not in ('','Fulham','Clapham','Oaklands Park') or coalesce(p_data->'consent','null'::jsonb)<>'true'::jsonb or coalesce(p_data->>'rating','') !~ '^[1-5]$'
 then raise sqlstate 'PT400' using message='Invalid review'; end if;
 v_rating:=(p_data->>'rating')::smallint;
 perform pg_advisory_xact_lock(hashtextextended('review-request:'||p_key::text,0));
 select * into v_existing from sakan_reviews.testimonials where request_key=p_key;
 if found then
  if row(v_existing.display_name,v_existing.email,v_existing.review,v_existing.suburb,v_existing.rating) is distinct from row(v_name,v_email,v_review,v_suburb,v_rating) then raise sqlstate 'PT409' using message='Request changed';end if;
  return jsonb_build_object('received',true);
 end if;
 -- Consistent lock ordering serializes limits even for parallel requests.
 perform pg_advisory_xact_lock(hashtextextended('review-ip:'||p_fingerprint,0));
 perform pg_advisory_xact_lock(hashtextextended('review-email:'||v_email,0));
 if (select count(*) from sakan_reviews.testimonials where fingerprint=p_fingerprint and created_at>now()-interval '1 hour')>=5
 or exists(select 1 from sakan_reviews.testimonials where email=v_email and created_at>now()-interval '1 day') then
 raise sqlstate 'PT429' using message='Review limit reached';end if;
 insert into sakan_reviews.testimonials(request_key,display_name,email,rating,review,suburb,consent,fingerprint)
 values(p_key,v_name,v_email,v_rating,v_review,v_suburb,true,p_fingerprint);
 return jsonb_build_object('received',true);
end $$;
revoke all on function sakan_reviews.submit(jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function sakan_reviews.submit(jsonb,uuid,text) to service_role;
create function public.submit_testimonial(p_data jsonb,p_key uuid,p_fingerprint text) returns jsonb language sql security invoker set search_path='' as $$ select sakan_reviews.submit(p_data,p_key,p_fingerprint) $$;
revoke all on function public.submit_testimonial(jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_testimonial(jsonb,uuid,text) to service_role;

create function sakan_reviews.staff_list(p_status text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_sakan_staff() then raise insufficient_privilege using message='Staff access required';end if;
 if p_status not in ('all','pending','published','hidden','rejected') then raise sqlstate 'PT400' using message='Invalid filter';end if;
 return (select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (
 select id,display_name,email,rating,review,suburb,status,stay_verified,revision,created_at,updated_at from sakan_reviews.testimonials
 where p_status='all' or status=p_status order by created_at desc,id limit 200) x);
end $$;
revoke all on function sakan_reviews.staff_list(text) from public,anon,authenticated,service_role;
grant execute on function sakan_reviews.staff_list(text) to authenticated;
create function public.staff_testimonials(p_status text default 'pending') returns jsonb language sql stable security invoker set search_path='' as $$select sakan_reviews.staff_list(p_status)$$;
revoke all on function public.staff_testimonials(text) from public,anon,authenticated,service_role;
grant execute on function public.staff_testimonials(text) to authenticated;

create function sakan_reviews.moderate(p_id uuid,p_revision integer,p_status text,p_verify_stay boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row sakan_reviews.testimonials;
begin
 if auth.uid() is null or not public.is_sakan_staff() then raise insufficient_privilege using message='Staff access required';end if;
 if p_status is null or p_status not in ('published','hidden','rejected') then raise sqlstate 'PT400' using message='Invalid status';end if;
 select * into v_row from sakan_reviews.testimonials where id=p_id for update;
 if not found then raise sqlstate 'PT404' using message='Review not found';end if;
 if p_revision is distinct from v_row.revision then raise sqlstate 'PT409' using message='Review changed. Refresh before trying again.';end if;
 if p_status='published' and p_verify_stay is distinct from true then raise sqlstate 'PT400' using message='Confirm this was a resident before publishing';end if;
 if v_row.status=p_status then return jsonb_build_object('updated',true);end if;
 update sakan_reviews.testimonials set status=p_status, stay_verified=case when p_status='published' then true else stay_verified end,
 published_at=case when p_status='published' then now() else published_at end,
 updated_at=now(),moderated_by=auth.uid(),revision=revision+1 where id=p_id;
 insert into public.audit("by",action) values(auth.uid()::text,'Testimonial '||p_id::text||' changed to '||p_status);
 return jsonb_build_object('updated',true);
end $$;
revoke all on function sakan_reviews.moderate(uuid,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function sakan_reviews.moderate(uuid,integer,text,boolean) to authenticated;
create function public.moderate_testimonial(p_id uuid,p_revision integer,p_status text,p_verify_stay boolean default false) returns jsonb language sql security invoker set search_path='' as $$select sakan_reviews.moderate(p_id,p_revision,p_status,p_verify_stay)$$;
revoke all on function public.moderate_testimonial(uuid,integer,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.moderate_testimonial(uuid,integer,text,boolean) to authenticated;
