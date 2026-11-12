begin;
create table public.enquiry_threads(
 id uuid primary key default gen_random_uuid(),gmail_thread_id text unique,website_enquiry_id uuid unique references public.website_enquiries(id),
 source text not null check(source in('email','website')),subject text not null,contact_email text not null,contact_name text not null default '',
 status text not null default 'open' check(status in('open','waiting','closed')),assigned_email text,
 revision integer not null default 1,last_message_at timestamptz not null default now(),created_at timestamptz not null default now()
);
create table public.enquiry_messages(
 id uuid primary key default gen_random_uuid(),thread_id uuid not null references public.enquiry_threads(id),gmail_message_id text unique,
 direction text not null check(direction in('incoming','outgoing')),sender text not null,body text not null,
 rfc_message_id text,attachments jsonb not null default '[]',sent_at timestamptz not null,author_email text
);
create index enquiry_messages_history on public.enquiry_messages(thread_id,sent_at,id);
create index enquiry_threads_recent on public.enquiry_threads(last_message_at desc);
create table public.enquiry_replies(
 id uuid primary key default gen_random_uuid(),thread_id uuid not null references public.enquiry_threads(id),thread_revision integer not null,
 prepared_by uuid not null,author_email text not null,recipient text not null,cc text[] not null,subject text not null,body text not null,
 gmail_thread_id text,rfc_reply_to text,status text not null default 'prepared' check(status in('prepared','sending','sent','uncertain')),
 gmail_message_id text,expires_at timestamptz not null default now()+interval '15 minutes',created_at timestamptz not null default now()
);
alter table public.enquiry_threads enable row level security;
alter table public.enquiry_messages enable row level security;
alter table public.enquiry_replies enable row level security;
revoke all on public.enquiry_threads,public.enquiry_messages,public.enquiry_replies from public,anon,authenticated;
grant select on public.enquiry_threads,public.enquiry_messages,public.enquiry_replies to authenticated;
grant all on public.enquiry_threads,public.enquiry_messages,public.enquiry_replies to service_role;
create policy staff_read on public.enquiry_threads for select to authenticated using((select public.is_sakan_staff()));
create policy staff_read on public.enquiry_messages for select to authenticated using((select public.is_sakan_staff()));
create policy staff_read on public.enquiry_replies for select to authenticated using((select public.is_sakan_staff()));

create function sakan_private.enquiry_action(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.enquiry_threads;r public.enquiry_replies;cc text[];by_email text;
begin
 perform sakan_private.require_staff();
 select email into by_email from auth.users where id=auth.uid();
 if p_action in('prepare','update') then
  select * into t from public.enquiry_threads where id=(p_data->>'thread_id')::uuid for update;
  if t.id is null or t.revision is distinct from (p_data->>'revision')::integer then raise exception 'Conversation changed. Refresh before continuing' using errcode='40001';end if;
  if p_action='update' then
   if p_data->>'status' not in('open','waiting','closed') then raise exception 'Invalid enquiry status';end if;
   if coalesce(p_data->>'assigned_email','')<>'' and not lower(p_data->>'assigned_email')=any(sakan_private.staff_emails()) then raise exception 'Choose a current administrator';end if;
   update public.enquiry_threads set status=p_data->>'status',assigned_email=nullif(lower(p_data->>'assigned_email'),''),revision=revision+1 where id=t.id returning * into t;
   insert into public.audit("by",action,entity_table,entity_id,reason) values(by_email,'updated enquiry ownership or status','enquiry_threads',t.id::text,t.status);
   return to_jsonb(t);
  end if;
  if length(trim(coalesce(p_data->>'body',''))) not between 1 and 12000 then raise exception 'Enter a reply (up to 12000 characters)';end if;
  if t.contact_email !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' or lower(t.contact_email)='sakanlodges@gmail.com' then raise exception 'Verify the customer email address';end if;
  cc:=sakan_private.staff_emails();
  if cardinality(cc)<>2 then raise exception 'Verify both administrator email addresses before replying';end if;
  insert into public.enquiry_replies(thread_id,thread_revision,prepared_by,author_email,recipient,cc,subject,body,gmail_thread_id,rfc_reply_to)
  values(t.id,t.revision,auth.uid(),by_email,t.contact_email,cc,case when t.subject ~* '^re:' then t.subject else 'Re: '||t.subject end,trim(p_data->>'body'),t.gmail_thread_id,(select rfc_message_id from public.enquiry_messages where thread_id=t.id and direction='incoming' order by sent_at desc,id desc limit 1)) returning * into r;
  return to_jsonb(r);
 elsif p_action='claim' then
  select * into r from public.enquiry_replies where id=(p_data->>'reply_id')::uuid;
  select * into t from public.enquiry_threads where id=r.thread_id for update;
  select * into r from public.enquiry_replies where id=r.id for update;
  if r.id is null or r.prepared_by is distinct from auth.uid() or r.status<>'prepared' or r.expires_at<now() or t.revision<>r.thread_revision or t.contact_email<>r.recipient or r.cc is distinct from sakan_private.staff_emails() then raise exception 'Reply preview expired or conversation changed. Refresh and preview again' using errcode='40001';end if;
  if exists(select 1 from public.enquiry_replies where thread_id=t.id and status in('sending','uncertain')) then raise exception 'An earlier reply needs delivery confirmation before sending another';end if;
  update public.enquiry_replies set status='sending' where id=r.id returning * into r;return to_jsonb(r);
 end if;
 raise exception 'Unknown enquiry action';
end $$;
revoke all on function sakan_private.enquiry_action(text,jsonb) from public,anon,authenticated,service_role;
create function public.enquiry_action(p_action text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.enquiry_action(p_action,p_data)$$;
revoke all on function public.enquiry_action(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function sakan_private.enquiry_action(text,jsonb),public.enquiry_action(text,jsonb) to authenticated;

create function public.enquiry_inbox_worker(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.enquiry_threads;m jsonb;w public.website_enquiries;r public.enquiry_replies;inserted integer;new_incoming boolean:=false;latest timestamptz;
begin
 if current_user<>'service_role' then raise exception 'Service only' using errcode='42501';end if;
 if p_action='admins' then return to_jsonb(sakan_private.staff_emails());
 elsif p_action='website' then
  for w in select webrow.* from public.website_enquiries webrow where not exists(select 1 from public.enquiry_threads existing_thread where existing_thread.website_enquiry_id=webrow.id) order by created_at limit 100 loop
   insert into public.enquiry_threads(website_enquiry_id,source,subject,contact_email,contact_name,last_message_at,created_at)
    values(w.id,'website','Website enquiry '||w.reference,w.details->>'email',w.details->>'full_name',w.created_at,w.created_at) on conflict do nothing returning * into t;
   if t.id is not null then
    insert into public.enquiry_messages(thread_id,direction,sender,body,sent_at) values(t.id,'incoming',t.contact_email,concat_ws(E'\n',w.details->>'message','Location: '||(w.details->>'location'),'Accommodation: '||(w.details->>'accommodation'),'Move-in: '||(w.details->>'move_in'),'Phone: '||(w.details->>'phone')),w.created_at);
   end if;
  end loop;
  return '{}'::jsonb;
 elsif p_action='import' then
  if coalesce(p_data->>'gmail_thread_id','') !~ '^[a-f0-9]+$' or jsonb_typeof(p_data->'messages')<>'array' or jsonb_array_length(p_data->'messages')>100 or coalesce(p_data->>'contact_email','') !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' then raise exception 'Invalid email conversation';end if;
  insert into public.enquiry_threads(gmail_thread_id,source,subject,contact_email,contact_name) values(p_data->>'gmail_thread_id','email',left(p_data->>'subject',250),p_data->>'contact_email',left(coalesce(p_data->>'contact_name',''),120)) on conflict(gmail_thread_id) do nothing;
  select * into t from public.enquiry_threads where gmail_thread_id=p_data->>'gmail_thread_id' for update;
  for m in select value from jsonb_array_elements(p_data->'messages') loop
   if m->>'id' !~ '^[a-f0-9]+$' or length(coalesce(m->>'body',''))>60000 or m->>'direction' not in('incoming','outgoing') then raise exception 'Invalid email message';end if;
   insert into public.enquiry_messages(thread_id,gmail_message_id,direction,sender,body,rfc_message_id,attachments,sent_at) values(t.id,m->>'id',m->>'direction',left(m->>'sender',254),coalesce(m->>'body',''),m->>'rfc_message_id',coalesce(m->'attachments','[]'),(m->>'sent_at')::timestamptz) on conflict(gmail_message_id) do nothing;
   get diagnostics inserted=row_count;
   if inserted>0 then latest:=greatest(coalesce(latest,t.last_message_at),(m->>'sent_at')::timestamptz);if m->>'direction'='incoming' then new_incoming:=true;end if;end if;
  end loop;
  if latest is not null then update public.enquiry_threads set last_message_at=latest,contact_email=p_data->>'contact_email',contact_name=left(coalesce(p_data->>'contact_name',''),120),revision=revision+1,status=case when p_data->'messages'->(-1)->>'direction'='outgoing' then 'waiting' when new_incoming then 'open' else status end where id=t.id;end if;
  return jsonb_build_object('thread_id',t.id);
 elsif p_action='uncertain' then
  update public.enquiry_replies set status='uncertain' where id=(p_data->>'reply_id')::uuid and status='sending';return '{}';
 elsif p_action='unconfirmed' then
  return coalesce((select jsonb_agg(to_jsonb(q)) from (select id from public.enquiry_replies where status in('sending','uncertain') and created_at<now()-interval '1 minute' order by created_at limit 5)q),'[]');
 elsif p_action='sent' then
  select * into r from public.enquiry_replies where id=(p_data->>'reply_id')::uuid for update;
  if r.id is null or r.status not in('sending','uncertain','sent') or coalesce(p_data->>'message_id','') !~ '^[a-f0-9]+$' or coalesce(p_data->>'thread_id','') !~ '^[a-f0-9]+$' then raise exception 'Invalid delivery confirmation';end if;
  if r.status='sent' then return to_jsonb(r);end if;
  update public.enquiry_replies set status='sent',gmail_message_id=p_data->>'message_id' where id=r.id returning * into r;
  insert into public.enquiry_messages(thread_id,gmail_message_id,direction,sender,body,rfc_message_id,sent_at,author_email) values(r.thread_id,r.gmail_message_id,'outgoing','sakanlodges@gmail.com',r.body,'<enquiry-'||r.id||'@sakanlodge.com>',now(),r.author_email) on conflict(gmail_message_id) do update set author_email=excluded.author_email;
  update public.enquiry_threads set gmail_thread_id=p_data->>'thread_id',last_message_at=greatest(last_message_at,now()),status=case when revision=r.thread_revision then 'waiting' else status end,revision=revision+1 where id=r.thread_id;
  insert into public.audit("by",action,entity_table,entity_id,reason) values(r.author_email,'replied to enquiry','enquiry_threads',r.thread_id::text,'Gmail message '||r.gmail_message_id);
  return to_jsonb(r);
 end if;
 raise exception 'Unknown inbox action';
end $$;
revoke all on function public.enquiry_inbox_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.enquiry_inbox_worker(text,jsonb),sakan_private.staff_emails() to service_role;
commit;
