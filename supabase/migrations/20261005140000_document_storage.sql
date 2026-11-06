-- Document upload (§6 Stage 7, §10).
--
-- A private bucket. Nothing is readable from a browser: the customer uploads through the
-- `upload` function under the service role, and only the presenter console ever reads a
-- document back, through `admin`. No RLS policies are added for `anon`, which is deliberate —
-- a signed URL from an Edge Function is the only way bytes come out.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

-- The original filename, kept so the customer and the presenter see what was actually sent
-- rather than a uuid.
alter table public.documents
  add column if not exists file_name text;

comment on column public.documents.file_name is
  'The name the file had on the customer''s device. Display only.';
