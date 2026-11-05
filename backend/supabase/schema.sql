-- Contact form storage used by POST /api/contact (backend/src/routes/contact.js).
-- Run once in the Supabase SQL editor.
--
-- The backend writes with the service-role key, which bypasses RLS. RLS is
-- enabled with no policies so the public anon key (shipped to the browser for
-- Realtime cursors) can neither read nor write submissions.

create table if not exists public.contact_submissions (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 2 and 100),
  email       text not null check (char_length(email) <= 254),
  message     text not null check (char_length(message) between 10 and 2000),
  ip_hash     text not null              -- sha256 of the sender IP, never the raw IP
);

alter table public.contact_submissions enable row level security;

create index if not exists contact_submissions_created_at_idx
  on public.contact_submissions (created_at desc);
