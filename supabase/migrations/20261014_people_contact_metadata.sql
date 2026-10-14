alter table public.people
  add column if not exists email text,
  add column if not exists document_url text,
  add column if not exists document_notes text;

-- Keep legacy document storage intact if it exists.
-- The app uses document_url and document_notes for resident files and notes.
