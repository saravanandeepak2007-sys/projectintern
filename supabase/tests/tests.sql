-- Behaviour tests for the Veyora database rules. Runs on plain Postgres with tests/stub.sql.
create table public.t_ids (k text primary key, v text);
create function public.t_eq(actual bigint, expected bigint, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL: % (got %, expected %)', label, actual, expected; end if;
  raise notice 'ok   %', label;
end $$;
create function public.t_fail(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok   % (blocked: %)', label, left(sqlerrm, 60); return; end;
  raise exception 'FAIL: % (statement succeeded but should have been refused)', label;
end $$;
create function public.t_who(sub text, hdr text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), false);
  perform set_config('request.headers', coalesce(hdr, ''), false);
end $$;

-- users (profiles come from the signup trigger)
insert into auth.users (email, raw_user_meta_data) values ('alice@x.io', '{"slug":"alice-1","display_name":"Alice"}'), ('bob@x.io', '{"slug":"bob-1","display_name":"Bob"}');
insert into public.t_ids select 'alice', id::text from auth.users where email = 'alice@x.io';
insert into public.t_ids select 'bob', id::text from auth.users where email = 'bob@x.io';
select public.t_eq((select count(*) from public.profiles), 2, 'signup trigger created profiles');

---------------------------------------------------------------- inbox
set role anon; select public.t_who(null);
insert into public.messages (recipient_id, body, sender_token, category) select v::uuid, 'hello alice', 'RAWTOKEN-111', 'general' from public.t_ids where k = 'alice';
select public.t_eq((select count(*) from public.messages), 0, 'anon cannot read any message');
select public.t_fail($q$insert into public.messages (recipient_id, body, sender_token) values (gen_random_uuid(), 'x', 'RAWTOKEN-111')$q$, 'cannot send to a non-existent inbox');
select public.t_fail($q$update public.messages set body = 'hacked'$q$, 'anon cannot update messages');
reset role;
select public.t_eq((select count(*) from public.messages where sender_token = 'RAWTOKEN-111'), 0, 'raw device code is never stored (inbox)');
select public.t_eq((select length(sender_token) from public.messages limit 1), 64, 'stored code is a 64-char hash');

set role authenticated; select public.t_who((select v from public.t_ids where k='alice'));
select public.t_eq((select count(*) from public.messages), 1, 'alice reads her message');
select public.t_fail($q$update public.messages set body = 'edited'$q$, 'owner cannot edit message text');
update public.messages set is_read = true;
select public.t_eq((select count(*) from public.messages where is_read), 1, 'owner can mark read');
select public.t_who((select v from public.t_ids where k='bob'));
select public.t_eq((select count(*) from public.messages), 0, 'bob cannot see alice''s inbox');
reset role;

---------------------------------------------------------------- time capsule
set role anon; select public.t_who(null);
insert into public.messages (recipient_id, body, sender_token, category, unlock_at) select v::uuid, 'secret future', 'RAWTOKEN-222', 'capsule', now() + interval '2 days' from public.t_ids where k = 'alice';
select public.t_fail($q$insert into public.messages (recipient_id, body, sender_token, unlock_at) select v::uuid, 'x', 'RAWTOKEN-222', now() + interval '9 years' from public.t_ids where k='alice'$q$, 'unlock date more than 5 years away is refused');
reset role;
set role authenticated; select public.t_who((select v from public.t_ids where k='alice'));
select public.t_eq((select count(*) from public.messages where body = 'secret future'), 0, 'locked capsule hidden from owner');
select public.t_eq((select count(*) from public.get_locked_messages()), 1, 'owner sees that 1 capsule is sealed');
reset role;
update public.messages set unlock_at = now() - interval '1 minute' where body = 'secret future';
set role authenticated; select public.t_who((select v from public.t_ids where k='alice'));
select public.t_eq((select count(*) from public.messages where body = 'secret future'), 1, 'capsule appears after unlock time');
reset role;

---------------------------------------------------------------- block
set role authenticated; select public.t_who((select v from public.t_ids where k='bob'));
select public.block_sender((select id from public.messages limit 1));   -- bob has no access: nothing happens
reset role;
select public.t_eq((select count(*) from public.blocked_senders), 0, 'bob cannot block alice''s senders');
set role authenticated; select public.t_who((select v from public.t_ids where k='alice'));
select public.block_sender((select id from public.messages where body = 'hello alice'));
reset role;
select public.t_eq((select count(*) from public.blocked_senders), 1, 'alice blocked a sender');
set role anon; select public.t_who(null);
select public.t_eq((select case when public.can_deliver((select v::uuid from public.t_ids where k='alice'), 'RAWTOKEN-111') then 1 else 0 end), 0, 'can_deliver is false for blocked device');
select public.t_eq((select case when public.can_deliver((select v::uuid from public.t_ids where k='alice'), 'RAWTOKEN-999') then 1 else 0 end), 1, 'can_deliver is true for others');
insert into public.messages (recipient_id, body, sender_token) select v::uuid, 'blocked tries again', 'RAWTOKEN-111' from public.t_ids where k = 'alice';
insert into public.messages (recipient_id, body, sender_token) select v::uuid, 'other person', 'RAWTOKEN-999' from public.t_ids where k = 'alice';
reset role;
select public.t_eq((select count(*) from public.messages where body = 'blocked tries again'), 0, 'blocked sender''s message is silently dropped (no error)');
select public.t_eq((select count(*) from public.messages where body = 'other person'), 1, 'other senders still get through');
select public.t_eq((select count(*) from public.messages m join public.messages n on n.sender_token = m.sender_token where m.body='other person' and n.id <> m.id), 0, 'hash differs between inbox rows of different devices');

---------------------------------------------------------------- spam limits
set role anon; select public.t_who(null);
do $$ begin for i in 1..5 loop insert into public.messages (recipient_id, body, sender_token) select v::uuid, 'spam '||i, 'SPAMTOKEN-1' from public.t_ids where k='alice'; end loop; end $$;
select public.t_fail($q$insert into public.messages (recipient_id, body, sender_token) select v::uuid, 'spam 6', 'SPAMTOKEN-1' from public.t_ids where k='alice'$q$, 'per-device limit: 6th message in a minute refused');
-- rotating device codes from ONE network is still stopped by the IP bucket
select public.t_who(null, '{"x-forwarded-for":"9.9.9.9, 10.0.0.1"}');
select public.t_fail($q$do $d$ begin for i in 1..25 loop insert into public.messages (recipient_id, body, sender_token) select v::uuid, 'rot '||i, 'ROTATING-TOKEN-'||i from public.t_ids where k='alice'; end loop; end $d$$q$, 'IP limit: rotating device codes does not bypass spam limits');
select public.t_who(null, '{"x-forwarded-for":"8.8.8.8"}');
insert into public.messages (recipient_id, body, sender_token) select v::uuid, 'ip probe', 'PROBE-TOKEN-1' from public.t_ids where k='alice';
select public.t_eq((select count(*) from public.rate_hits), 0, 'rate_hits shows zero rows through the API');
reset role;
select public.t_eq((select case when count(*) > 0 then 1 else 0 end from public.rate_hits), 1, 'rate_hits is being filled server-side');
select public.t_eq((select count(*) from public.rate_hits where who like '%8.8.8.8%' or who like '%9.9.9.9%'), 0, 'raw IP address is never stored');

---------------------------------------------------------------- rooms
set role authenticated; select public.t_who((select v from public.t_ids where k='alice'));
insert into public.rooms (code, name, is_public) values ('PUB111', 'Public room', true), ('PRV222', 'Private room', false);
reset role;
set role anon; select public.t_who(null);
select public.t_eq((select count(*) from public.rooms), 1, 'anon can list only public rooms');
select public.t_eq((select count(*) from public.find_room('prv222')), 1, 'anyone with the code can open a private room');
select public.t_eq((select count(*) from public.find_room('NOPE00')), 0, 'unknown code returns nothing');
insert into public.room_messages (room_id, anon_name, body, sender_token) select id, 'Blue Falcon', 'hi private', 'RAWTOKEN-111' from public.find_room('PRV222');
insert into public.room_messages (room_id, anon_name, body, sender_token) select id, 'Blue Falcon', 'hi public', 'RAWTOKEN-111' from public.find_room('PUB111');
select public.t_eq((select count(*) from public.room_messages), 1, 'anon can read public-room messages only via the table');
select public.t_eq((select count(*) from public.room_feed((select id from public.find_room('PUB111')))), 1, 'room_feed works for public room');
reset role;
select public.t_eq((select count(*) from public.room_messages where sender_token = 'RAWTOKEN-111'), 0, 'raw device code is never stored (rooms)');
select public.t_eq((select count(*) from public.room_messages r join public.messages m on m.sender_token = r.sender_token), 0, 'same browser cannot be linked between an inbox and a room');
set role anon; select public.t_who(null);
select public.t_eq((select count(*) from public.room_feed((select id from public.find_room('PRV222')))), 1, 'private room feed readable with the room id');
select public.t_eq((select count(*) from public.room_messages where body = 'hi private'), 0, 'private room messages cannot be listed through the table');
reset role;

-- polls
set role authenticated; select public.t_who((select v from public.t_ids where k='alice'));
insert into public.polls (room_id, question, options) select id, 'Pizza?', array['Yes','No'] from public.find_room('PRV222');
select public.t_who((select v from public.t_ids where k='bob'));
select public.t_fail($q$insert into public.polls (room_id, question, options) select id, 'Hijack', array['a','b'] from public.find_room('PRV222')$q$, 'non-owner cannot create polls');
reset role;
set role anon; select public.t_who(null);
select public.t_eq((select count(*) from public.polls), 0, 'private polls not listable');
select public.t_eq((select count(*) from public.room_polls((select id from public.find_room('PRV222')))), 1, 'private polls readable via room_polls');
insert into public.poll_votes (poll_id, option_idx, voter_token) select id, 0, 'VOTER-TOKEN-1' from public.room_polls((select id from public.find_room('PRV222')));
select public.t_fail($q$insert into public.poll_votes (poll_id, option_idx, voter_token) select id, 1, 'VOTER-TOKEN-1' from public.room_polls((select id from public.find_room('PRV222')))$q$, 'double vote refused');
select public.t_fail($q$insert into public.poll_votes (poll_id, option_idx, voter_token) select id, 3, 'VOTER-TOKEN-2' from public.room_polls((select id from public.find_room('PRV222')))$q$, 'fake poll option refused');
select public.t_eq((select votes from public.poll_counts limit 1), 1, 'poll totals visible');
select public.t_eq((select count(*) from public.poll_votes), 0, 'individual votes are not readable');
-- reactions + reports
insert into public.room_reactions (room_message_id, emoji, voter_token) select id, '🔥', 'VOTER-TOKEN-1' from public.room_messages limit 1;
select public.t_fail($q$insert into public.room_reactions (room_message_id, emoji, voter_token) select id, '🔥', 'VOTER-TOKEN-1' from public.room_messages limit 1$q$, 'duplicate reaction refused');
select public.t_fail($q$insert into public.room_reactions (room_message_id, emoji, voter_token) select id, '💩', 'VOTER-TOKEN-1' from public.room_messages limit 1$q$, 'unknown emoji refused');
insert into public.reports (room_id, room_message_id, reporter_token) select room_id, id, 'REPORTER-1' from public.room_messages limit 1;
select public.t_fail($q$insert into public.reports (room_id, room_message_id, reporter_token) select (select id from public.find_room('PRV222')), id, 'REPORTER-2' from public.room_messages limit 1$q$, 'report with mismatched room refused');
select public.t_eq((select count(*) from public.reports), 0, 'anon cannot read reports');
reset role;
-- moderation
select public.t_eq((select count(*) from public.room_messages), 2, 'two room messages exist before moderation');
set role authenticated; select public.t_who((select v from public.t_ids where k='bob'));
delete from public.room_messages;
reset role;
select public.t_eq((select count(*) from public.room_messages), 2, 'non-owner cannot remove room messages');
set role authenticated; select public.t_who((select v from public.t_ids where k='alice'));
select public.t_eq((select count(*) from public.reports), 1, 'room owner reads reports');
delete from public.room_messages;
reset role;
select public.t_eq((select count(*) from public.room_messages), 0, 'room owner removes messages');

---------------------------------------------------------------- locked-capsule audio path
set role anon; select public.t_who(null);
insert into public.messages (recipient_id, kind, audio_path, sender_token, unlock_at) select v::uuid, 'voice', v || '/a.webm', 'RAWTOKEN-333', now() + interval '1 day' from public.t_ids where k='alice';
reset role;
set role authenticated; select public.t_who((select v from public.t_ids where k='alice'));
select public.t_eq((select count(*) from public.get_locked_messages() where audio_path is not null), 1, 'sealed voice note returns its file path for clean-up');
reset role;
do $$ begin raise notice 'DB TESTS DONE'; end $$;
