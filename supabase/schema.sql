-- =====================================================================
-- Veyora database schema for Supabase (Postgres).
-- Run this whole file once in: Supabase Dashboard > SQL Editor > New query.
-- Row Level Security (RLS) is what keeps messages private; never disable it.
-- =====================================================================

-- ---------- 1. Profiles (one per registered receiver) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles readable by everyone" on public.profiles for select using (true);
create policy "owner updates own profile" on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Create the profile automatically when someone signs up (works even when email confirmation is on).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'slug', ''), '[^a-z0-9-]', '', 'g'));
  dn text := left(coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(coalesce(new.email, 'user'), '@', 1)), 40);
begin
  if char_length(base) < 3 then base := 'user-' || substr(replace(new.id::text, '-', ''), 1, 8); end if;
  begin
    insert into public.profiles (id, slug, display_name) values (new.id, left(base, 40), dn);
  exception when unique_violation then
    insert into public.profiles (id, slug, display_name)
    values (new.id, 'user-' || substr(replace(new.id::text, '-', ''), 1, 12), dn);
  end;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. Messages: inbox, voice, feedback, mood, time capsule ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'voice')),
  body text check (body is null or char_length(body) <= 1000),
  transcript text check (transcript is null or char_length(transcript) <= 2000),
  audio_path text,
  mood text check (mood in ('happy', 'sad', 'motivation', 'appreciation')),
  category text not null default 'general' check (category in ('general', 'feedback', 'praise', 'question', 'capsule')),
  sentiment text not null default 'neutral' check (sentiment in ('positive', 'constructive', 'neutral')),
  unlock_at timestamptz,
  is_read boolean not null default false,
  sender_token text not null check (char_length(sender_token) between 8 and 64),
  created_at timestamptz not null default now(),
  constraint unlock_not_absurd check (unlock_at is null or unlock_at <= created_at + interval '5 years'),
  constraint content_present check (
    (kind = 'text' and body is not null and char_length(btrim(body)) > 0)
    or (kind = 'voice' and audio_path is not null)
  )
);
create index messages_recipient_idx on public.messages (recipient_id, created_at desc);
create index messages_token_idx on public.messages (sender_token, created_at desc);
alter table public.messages enable row level security;

-- Anyone (no login) can drop a message into an existing inbox. They can never read anything back.
create policy "anyone can send" on public.messages for insert to anon, authenticated
  with check (exists (select 1 from public.profiles p where p.id = recipient_id) and is_read = false);
-- Only the owner reads, and a time capsule stays invisible until its unlock time (enforced here, not in the browser).
create policy "owner reads unlocked" on public.messages for select to authenticated
  using (recipient_id = auth.uid() and (unlock_at is null or unlock_at <= now()));
create policy "owner marks read" on public.messages for update to authenticated
  using (recipient_id = auth.uid() and (unlock_at is null or unlock_at <= now()))
  with check (recipient_id = auth.uid());
create policy "owner deletes" on public.messages for delete to authenticated
  using (recipient_id = auth.uid());
-- The owner may change only the is_read flag, never the message text.
revoke update on public.messages from anon, authenticated;
grant update (is_read) on public.messages to authenticated;

-- Locked capsules: the owner sees that something is waiting (count + unlock date), never the content.
create or replace function public.get_locked_messages()
returns table (id uuid, kind text, unlock_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.kind, m.unlock_at, m.created_at
  from public.messages m
  where m.recipient_id = auth.uid() and m.unlock_at > now()
  order by m.unlock_at;
$$;
revoke all on function public.get_locked_messages() from public, anon;
grant execute on function public.get_locked_messages() to authenticated;

-- Server-side spam protection: max 5 messages per minute per device token.
create or replace function public.limit_message_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.messages
      where sender_token = new.sender_token and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many messages. Please wait a minute and try again.';
  end if;
  return new;
end $$;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.limit_message_rate();

-- ---------- 3. Voice storage (SecretVoice) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', false, 2097152,
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'])
on conflict (id) do nothing;

create policy "anyone can upload voice to an existing inbox" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'voice' and (storage.foldername(name))[1] in (select id::text from public.profiles));
create policy "owner plays unlocked voice" on storage.objects for select to authenticated
  using (bucket_id = 'voice' and exists (
    select 1 from public.messages m
    where m.audio_path = storage.objects.name and m.recipient_id = auth.uid()
      and (m.unlock_at is null or m.unlock_at <= now())));
create policy "owner deletes own voice" on storage.objects for delete to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 4. Campus Rooms: rooms, live chat, polls, reports ----------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  name text not null check (char_length(name) between 2 and 60),
  topic text not null default 'General Discussion'
    check (topic in ('College Events', 'Hackathons', 'Academics', 'Suggestions', 'General Discussion')),
  is_public boolean not null default true,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
create policy "rooms readable" on public.rooms for select using (true);
create policy "signed-in users create rooms" on public.rooms for insert to authenticated with check (owner_id = auth.uid());
create policy "owner deletes room" on public.rooms for delete to authenticated using (owner_id = auth.uid());

create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  anon_name text not null check (char_length(anon_name) between 2 and 30),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  sender_token text not null check (char_length(sender_token) between 8 and 64),
  created_at timestamptz not null default now()
);
create index room_messages_idx on public.room_messages (room_id, created_at);
alter table public.room_messages enable row level security;
create policy "room messages readable" on public.room_messages for select using (true);
create policy "anyone can post in a room" on public.room_messages for insert to anon, authenticated
  with check (exists (select 1 from public.rooms r where r.id = room_id));
create policy "room owner moderates" on public.room_messages for delete to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_messages.room_id and r.owner_id = auth.uid()));

create or replace function public.limit_room_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.room_messages
      where sender_token = new.sender_token and created_at > now() - interval '30 seconds') >= 8 then
    raise exception 'You are sending too fast. Slow down for a few seconds.';
  end if;
  return new;
end $$;
create trigger room_messages_rate_limit before insert on public.room_messages
  for each row execute function public.limit_room_rate();

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  question text not null check (char_length(question) between 3 and 140),
  options text[] not null check (array_length(options, 1) between 2 and 4),
  created_at timestamptz not null default now()
);
alter table public.polls enable row level security;
create policy "polls readable" on public.polls for select using (true);
create policy "room owner creates polls" on public.polls for insert to authenticated
  with check (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()));
create policy "room owner deletes polls" on public.polls for delete to authenticated
  using (exists (select 1 from public.rooms r where r.id = polls.room_id and r.owner_id = auth.uid()));

create table public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_idx int not null check (option_idx between 0 and 3),
  voter_token text not null check (char_length(voter_token) between 8 and 64),
  created_at timestamptz not null default now(),
  unique (poll_id, voter_token)
);
alter table public.poll_votes enable row level security;
create policy "anyone can vote once" on public.poll_votes for insert to anon, authenticated
  with check (exists (select 1 from public.polls p where p.id = poll_id and option_idx < array_length(p.options, 1)));
-- Votes themselves are not readable; only the totals below.
create view public.poll_counts as
  select poll_id, option_idx, count(*)::int as votes from public.poll_votes group by poll_id, option_idx;
grant select on public.poll_counts to anon, authenticated;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  room_message_id uuid not null references public.room_messages(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 200),
  reporter_token text not null check (char_length(reporter_token) between 8 and 64),
  created_at timestamptz not null default now(),
  unique (room_message_id, reporter_token)
);
alter table public.reports enable row level security;
create policy "anyone can report" on public.reports for insert to anon, authenticated
  with check (exists (select 1 from public.room_messages m where m.id = room_message_id and m.room_id = reports.room_id));
create policy "room owner reads reports" on public.reports for select to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()));
create policy "room owner clears reports" on public.reports for delete to authenticated
  using (exists (select 1 from public.rooms r where r.id = reports.room_id and r.owner_id = auth.uid()));

-- ---------- 5. Realtime ----------
alter publication supabase_realtime add table public.messages, public.room_messages;

-- =====================================================================
-- 6. Additions: block sender + room reactions
-- (If you already ran sections 1-5 earlier, you can run just this section.)
-- =====================================================================

-- Block: the owner can silence a device. Its future messages are silently dropped,
-- so the blocked person is not told. The owner never types or sees the device code in the UI.
create table public.blocked_senders (
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sender_token text not null,
  created_at timestamptz not null default now(),
  primary key (recipient_id, sender_token)
);
alter table public.blocked_senders enable row level security;
create policy "owner reads blocks" on public.blocked_senders for select to authenticated using (recipient_id = auth.uid());
create policy "owner removes blocks" on public.blocked_senders for delete to authenticated using (recipient_id = auth.uid());

create or replace function public.block_sender(p_message_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.blocked_senders (recipient_id, sender_token)
  select m.recipient_id, m.sender_token from public.messages m
  where m.id = p_message_id and m.recipient_id = auth.uid()
  on conflict do nothing;
$$;
revoke all on function public.block_sender(uuid) from public, anon;
grant execute on function public.block_sender(uuid) to authenticated;

create or replace function public.drop_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.blocked_senders b
             where b.recipient_id = new.recipient_id and b.sender_token = new.sender_token) then
    return null; -- row is skipped, sender still sees "sent"
  end if;
  return new;
end $$;
create trigger messages_blocked_check before insert on public.messages
  for each row execute function public.drop_blocked();

-- Reactions on room messages (one per emoji per device).
create table public.room_reactions (
  id uuid primary key default gen_random_uuid(),
  room_message_id uuid not null references public.room_messages(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '🔥')),
  voter_token text not null check (char_length(voter_token) between 8 and 64),
  created_at timestamptz not null default now(),
  unique (room_message_id, emoji, voter_token)
);
alter table public.room_reactions enable row level security;
create policy "anyone can react" on public.room_reactions for insert to anon, authenticated
  with check (exists (select 1 from public.room_messages m where m.id = room_message_id));
create view public.reaction_counts as
  select room_message_id, emoji, count(*)::int as n from public.room_reactions group by room_message_id, emoji;
grant select on public.reaction_counts to anon, authenticated;

-- =====================================================================
-- 7. Hardening (v3). Safe to re-run. If you already ran sections 1-6, run ONLY this section.
--    * private rooms are really private (unlisted rooms can't be listed or read through the API)
--    * device codes are hashed on the server, per inbox / per room, so nothing can be linked across places
--    * spam limits also use a hashed, auto-deleted IP bucket, so rotating device codes no longer bypasses them
--    * helper RPCs: can_deliver, find_room, room_feed, room_polls
-- =====================================================================

-- ---------- 7a. Helper predicates (security definer so private rooms still work for people who hold the code) ----------
create or replace function public.room_exists(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.rooms where id = p_room) $$;
create or replace function public.room_is_public(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$ select coalesce((select is_public from public.rooms where id = p_room), false) $$;
create or replace function public.room_is_owned(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.rooms where id = p_room and owner_id = auth.uid()) $$;
create or replace function public.poll_option_ok(p_poll uuid, p_idx int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.polls p where p.id = p_poll and p_idx >= 0 and p_idx < array_length(p.options, 1)) $$;
create or replace function public.room_message_in_room(p_msg uuid, p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_messages m where m.id = p_msg and m.room_id = p_room) $$;
create or replace function public.room_message_exists(p_msg uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.room_messages where id = p_msg) $$;
grant execute on function public.room_exists(uuid), public.room_is_public(uuid), public.room_is_owned(uuid),
  public.poll_option_ok(uuid, int), public.room_message_in_room(uuid, uuid), public.room_message_exists(uuid) to anon, authenticated;

-- ---------- 7b. Private rooms ----------
drop policy if exists "rooms readable" on public.rooms;
drop policy if exists "listed or own rooms" on public.rooms;
create policy "listed or own rooms" on public.rooms for select using (is_public or owner_id = auth.uid());

drop policy if exists "room messages readable" on public.room_messages;
drop policy if exists "public room messages readable" on public.room_messages;
create policy "public room messages readable" on public.room_messages for select
  using (public.room_is_public(room_id) or public.room_is_owned(room_id));
drop policy if exists "anyone can post in a room" on public.room_messages;
create policy "anyone can post in a room" on public.room_messages for insert to anon, authenticated
  with check (public.room_exists(room_id));
drop policy if exists "room owner moderates" on public.room_messages;
create policy "room owner moderates" on public.room_messages for delete to authenticated using (public.room_is_owned(room_id));

drop policy if exists "polls readable" on public.polls;
drop policy if exists "public polls readable" on public.polls;
create policy "public polls readable" on public.polls for select using (public.room_is_public(room_id) or public.room_is_owned(room_id));
drop policy if exists "room owner creates polls" on public.polls;
create policy "room owner creates polls" on public.polls for insert to authenticated with check (public.room_is_owned(room_id));
drop policy if exists "room owner deletes polls" on public.polls;
create policy "room owner deletes polls" on public.polls for delete to authenticated using (public.room_is_owned(room_id));

drop policy if exists "anyone can vote once" on public.poll_votes;
create policy "anyone can vote once" on public.poll_votes for insert to anon, authenticated
  with check (public.poll_option_ok(poll_id, option_idx));

drop policy if exists "anyone can report" on public.reports;
create policy "anyone can report" on public.reports for insert to anon, authenticated
  with check (public.room_message_in_room(room_message_id, room_id));
drop policy if exists "room owner reads reports" on public.reports;
create policy "room owner reads reports" on public.reports for select to authenticated using (public.room_is_owned(room_id));
drop policy if exists "room owner clears reports" on public.reports;
create policy "room owner clears reports" on public.reports for delete to authenticated using (public.room_is_owned(room_id));

drop policy if exists "anyone can react" on public.room_reactions;
create policy "anyone can react" on public.room_reactions for insert to anon, authenticated
  with check (public.room_message_exists(room_message_id));

-- Whoever holds the code can open a room, listed or not. These return no device codes.
create or replace function public.find_room(p_code text)
returns table (id uuid, code text, name text, topic text, is_public boolean, owner_id uuid)
language sql stable security definer set search_path = public as $$
  select r.id, r.code, r.name, r.topic, r.is_public, r.owner_id from public.rooms r where r.code = upper(p_code) $$;
create or replace function public.room_feed(p_room uuid)
returns table (id uuid, anon_name text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (select m.id, m.anon_name, m.body, m.created_at from public.room_messages m
                 where m.room_id = p_room order by m.created_at desc limit 100) x order by x.created_at $$;
create or replace function public.room_polls(p_room uuid)
returns setof public.polls
language sql stable security definer set search_path = public as $$
  select * from public.polls where room_id = p_room order by created_at desc $$;
revoke all on function public.find_room(text), public.room_feed(uuid), public.room_polls(uuid) from public;
grant execute on function public.find_room(text), public.room_feed(uuid), public.room_polls(uuid) to anon, authenticated;

-- ---------- 7c. Hash device codes on the server ----------
-- The code is replaced by sha256(code + where it was sent). The same browser looks different in every inbox and room,
-- and the raw code is never stored or returned.
create or replace function public.hash_message_token() returns trigger language plpgsql as $$
begin
  new.sender_token := encode(sha256(convert_to(new.sender_token || ':inbox:' || new.recipient_id::text, 'UTF8')), 'hex');
  return new;
end $$;
drop trigger if exists messages_a_hash on public.messages;
create trigger messages_a_hash before insert on public.messages for each row execute function public.hash_message_token();

create or replace function public.hash_room_token() returns trigger language plpgsql as $$
begin
  new.sender_token := encode(sha256(convert_to(new.sender_token || ':room:' || new.room_id::text, 'UTF8')), 'hex');
  return new;
end $$;
drop trigger if exists room_messages_a_hash on public.room_messages;
create trigger room_messages_a_hash before insert on public.room_messages for each row execute function public.hash_room_token();

-- Block check must run AFTER hashing (trigger names run in alphabetical order: a_hash, b_blocked, rate_limit).
drop trigger if exists messages_blocked_check on public.messages;
drop trigger if exists messages_b_blocked on public.messages;
create trigger messages_b_blocked before insert on public.messages for each row execute function public.drop_blocked();

-- Used by the send page to skip uploading audio for blocked senders. The sender is never told.
create or replace function public.can_deliver(p_recipient uuid, p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.blocked_senders b where b.recipient_id = p_recipient
    and b.sender_token = encode(sha256(convert_to(p_token || ':inbox:' || p_recipient::text, 'UTF8')), 'hex')) $$;
revoke all on function public.can_deliver(uuid, text) from public;
grant execute on function public.can_deliver(uuid, text) to anon, authenticated;

-- ---------- 7d. IP-bucket spam limits (hashed, deleted after an hour, never stored with a message) ----------
create table if not exists public.rate_hits (bucket text not null, who text not null, at timestamptz not null default now());
create index if not exists rate_hits_idx on public.rate_hits (bucket, who, at desc);
alter table public.rate_hits enable row level security;   -- no policies: nobody can read it through the API

create or replace function public.ip_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p_bucket text := tg_argv[0]; p_max int := tg_argv[1]::int; p_secs int := tg_argv[2]::int;
  hdrs json; ip text; v_who text; n int;
begin
  begin hdrs := nullif(current_setting('request.headers', true), '')::json; exception when others then hdrs := null; end;
  ip := nullif(btrim(split_part(coalesce(hdrs->>'x-forwarded-for', ''), ',', 1)), '');
  if ip is null then return new; end if;  -- no header (SQL editor, tests): per-device limits still apply
  v_who := encode(sha256(convert_to(ip || ':' || p_bucket || ':whisperhub-v3', 'UTF8')), 'hex');
  if random() < 0.02 then delete from public.rate_hits where at < now() - interval '1 hour'; end if;
  select count(*) into n from public.rate_hits h
    where h.bucket = p_bucket and h.who = v_who and h.at > now() - make_interval(secs => p_secs);
  if n >= p_max then raise exception 'Too many requests from this network. Please wait a minute and try again.'; end if;
  insert into public.rate_hits (bucket, who) values (p_bucket, v_who);
  return new;
end $$;

drop trigger if exists messages_z_ip_limit on public.messages;
create trigger messages_z_ip_limit before insert on public.messages for each row execute function public.ip_limit('inbox', 20, 60);
drop trigger if exists room_messages_z_ip_limit on public.room_messages;
create trigger room_messages_z_ip_limit before insert on public.room_messages for each row execute function public.ip_limit('room', 40, 60);
drop trigger if exists poll_votes_ip_limit on public.poll_votes;
create trigger poll_votes_ip_limit before insert on public.poll_votes for each row execute function public.ip_limit('vote', 30, 60);
drop trigger if exists reports_ip_limit on public.reports;
create trigger reports_ip_limit before insert on public.reports for each row execute function public.ip_limit('report', 10, 60);
drop trigger if exists room_reactions_ip_limit on public.room_reactions;
create trigger room_reactions_ip_limit before insert on public.room_reactions for each row execute function public.ip_limit('react', 60, 60);

-- ---------- 7e. Locked capsules: also return the audio path so a deleted sealed voice note can be cleaned up ----------
drop function if exists public.get_locked_messages();
create function public.get_locked_messages()
returns table (id uuid, kind text, unlock_at timestamptz, created_at timestamptz, audio_path text)
language sql stable security definer set search_path = public as $$
  select m.id, m.kind, m.unlock_at, m.created_at, m.audio_path
  from public.messages m where m.recipient_id = auth.uid() and m.unlock_at > now() order by m.unlock_at $$;
revoke all on function public.get_locked_messages() from public, anon;
grant execute on function public.get_locked_messages() to authenticated;
