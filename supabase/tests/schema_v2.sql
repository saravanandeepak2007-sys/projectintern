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
