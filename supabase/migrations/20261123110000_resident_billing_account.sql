alter table public.people add column if not exists billing_account_id uuid references public.people(id) on delete restrict check (billing_account_id <> id);
