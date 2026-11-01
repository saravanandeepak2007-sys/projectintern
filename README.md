# WhisperHub: Anonymous Communication Platform

One website with six anonymous-messaging modules, built for the Renza recruitment task
("build an anonymous messaging website and host it on GitHub").

| Module | What it does |
|---|---|
| **Anonymous Inbox** | Every receiver gets a link (`#/u/deepak-a82x`). Anyone can write with no account; only the owner can read. |
| **SecretVoice** | Record a voice note in the browser, with live voice-to-text where the browser supports it (English, Tamil, Hindi). |
| **TruthBox** | Feedback and praise categories, separate Positive / Suggestions columns, tone tagging, sentiment chart. |
| **TimeCapsule** | Sender picks an unlock date. The **database** hides the message until then, even from the owner. Also "message to my future self". |
| **MoodPing** | A mood on every message (happy, sad, motivation, appreciation), mood bars and a 7-day chart. |
| **CampusWhisper** | Anonymous live rooms (listed or unlisted), random names, polls, emoji reactions, reports, owner moderation. |
| **Safety tools** | Block sender, delete, report, per-device and per-network rate limits, honeypot, profanity masking. |
| **Alerts** | Unread count in the tab title and an optional desktop pop-up for new messages and capsules that just opened. |

**Stack:** React 18 + Vite, React Router (HashRouter, so it works on GitHub Pages), Supabase (Postgres, Auth, Realtime, Storage).
No server to run: the whole site is static files on GitHub Pages.

> Why Supabase and not Node + Express + MongoDB? GitHub Pages only serves static files, and free Node hosts go to sleep
> (a 30-60 s first load for the reviewer). Supabase gives the same features with no sleeping server.

---

## Commands: first-time setup

You need Node 20+ and a free account at https://supabase.com.

**1. Create the database** (in the Supabase dashboard)
1. New project, then **SQL Editor > New query**, paste the whole of `supabase/schema.sql`, click **Run**.
2. **Authentication > Providers > Email**: turn **off** "Confirm email".
3. **Project Settings > API**: copy the *Project URL* and the *anon public* key.

**2. Run it on your computer**
```bash
cd whisperhub
npm install
cp .env.example .env          # Windows: copy .env.example .env
# open .env and paste VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                   # open http://localhost:5173
```

**3. Check the code (optional but quick)**
```bash
npm test                      # unit tests: sentiment, profanity filter, codes, helpers
npm run build                 # production build into dist/
```

**4. Put it on GitHub Pages**
```bash
git init
git add .
git commit -m "WhisperHub"
git branch -M main
git remote add origin https://github.com/YOUR-USER/whisperhub.git     # create the empty repo on github.com first
git push -u origin main
```
Then on github.com, in the repo:
1. **Settings > Secrets and variables > Actions > New repository secret**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. **Settings > Pages > Source: GitHub Actions**.
3. **Actions** tab: open the "Deploy to GitHub Pages" run (or click *Run workflow*). When it is green your site is at
   `https://YOUR-USER.github.io/whisperhub/`. Submit that link in the Google Form.

## Commands: you already ran an older schema.sql
Open **SQL Editor** and run only `supabase/patch_v3.sql` (safe to run twice), then pull the new code.
Blocks you made before the upgrade stop matching (device codes are now hashed), so block again if needed.

## Demo script for the reviewer
1. Sign up, copy your inbox link from the dashboard.
2. Open the link in a private window and send a text, a voice note, and a capsule with a date a few minutes ahead.
3. Back on the dashboard, watch the mood and sentiment charts. The capsule shows as sealed, then appears when time is up.
4. Create a room, untick "public list", open its code in another window, chat, react, post a poll, report a message.

Do **not** test the Block button on your own message from the same browser you use for the dashboard unless you want to
block yourself as a sender. (Future-self notes are safe: they use a fresh code each time.)

---

## Tests (what is checked, and how to run it)

| Command | What it checks | Needs |
|---|---|---|
| `npm test` | Sentiment, profanity filter, id and code helpers | Node only |
| `npm run test:db` | 51 behaviour checks on the database rules, on a fresh install and on the upgrade path | local PostgreSQL 14+ |
| `bash supabase/tests/contract.sh wh_fresh` | Every table, function and column the app uses exists in the schema | after `test:db` |
| `bash supabase/tests/e2e/run.sh` | 39-step browser run of every module as three separate people | PostgreSQL, Python (flask, psycopg2-binary, playwright), Chromium |

The database and browser tests run the real `schema.sql` on real Postgres. They stand in for Supabase's login and storage
servers only; they have **not** been run against a hosted Supabase project, so do the demo script once after deploying.

## How anonymity works (and where it stops)
- Senders never give a name, email or phone number.
- Each browser makes a separate random code per purpose (inbox, room, votes). The server hashes it again per inbox and per room
  before storing it, so receivers never get a usable code and the same browser cannot be linked between places.
- To slow spam the server also counts requests per network address using a one-way hash that is deleted after an hour and never stored with a message.
- Unlisted rooms cannot be listed or read through the API; you need the room code.
- This is **not** absolute anonymity: hosting providers keep ordinary network logs, and writing style or a voice can identify someone.
  The in-app "How anonymity works" page says so.

## Folder layout
```
supabase/schema.sql        everything in one file (fresh install)
supabase/patch_v3.sql      only the v3 hardening, for projects that ran an older schema
supabase/tests/            database tests, contract check, browser end-to-end test
src/pages/                 Home, AuthPage, SendPage, Dashboard, Rooms, Room, Privacy
src/lib/                   auth context, helpers (sentiment, profanity filter, codes)
tests/                     unit tests (npm test)
.github/workflows/         automatic test + build + GitHub Pages deploy
```

## Known limits (honest list)
- "Sentiment" is a keyword scorer with whole-word matching and simple negation, not machine learning. Real AI needs a paid API key.
- Voice-to-text depends on the browser (Chrome, Edge, Safari yes; Firefox no). The audio is still sent.
- Free Supabase projects pause after a week of inactivity: open the dashboard to wake yours before sharing the link.
- Alerts only work while the dashboard tab is open. Emailing people when a capsule opens needs a scheduled server job, which GitHub Pages cannot run.
- No CAPTCHA (it needs a server-side check). Spam is limited by a honeypot, cooldowns, per-device limits and per-network limits.
  Someone behind a shared network (a campus) shares one network limit.
- Blocking works per browser: a sender who clears their data can write again.
- An audio file can stay in storage if a voice upload succeeds but the message then fails (for example a rate limit).
