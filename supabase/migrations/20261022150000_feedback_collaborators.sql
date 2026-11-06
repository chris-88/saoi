-- Feedback, collaborators and where arrivals came from (§44, §53).
--
-- Feedback is given from the conversation: a thumbs on one of Saoirse's replies, or a rating and
-- some words about the whole thing from the menu. It is kept against the case and, for a
-- thumbs, the message, so the console shows it beside the turn it was about. A collaborator
-- is somebody who asked to be contacted about working on this, written from the public site
-- by an anonymous visitor with a daily cap in front of it. A case's source is the entry point
-- it arrived through (a QR code, a poster, a link), for the funnel after a show and tell.
alter table public.cases add column source text;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  kind text not null check (kind in ('turn', 'session')),
  -- A thumbs is 1 or -1; a session rating is 1 to 5.
  rating integer not null check (rating between -1 and 5 and rating <> 0),
  comment text,
  reply_to text,
  created_at timestamptz not null default now()
);

create index feedback_case_idx on public.feedback (case_id);

create table public.collaborators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  organisation text,
  role text,
  interest text not null,
  consent boolean not null default false,
  source text,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;
alter table public.collaborators enable row level security;

-- Feedback is read by the console. Collaborators are read by nobody but the console.
create policy feedback_read on public.feedback for select using (public.is_admin());
create policy collaborators_read on public.collaborators for select using (public.is_admin());
