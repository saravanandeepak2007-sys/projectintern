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
