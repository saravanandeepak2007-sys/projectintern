#!/usr/bin/env bash
# End-to-end test. Needs: local Postgres, python3 with flask + psycopg2-binary + playwright (and its chromium), node.
set -e
cd "$(dirname "$0")/../../.."
export PGHOST=${PGHOST:-/var/run/postgresql}
DB=wh_e2e
psql -q -X -c "drop database if exists $DB" postgres 2>/dev/null; psql -q -X -c "create database $DB" postgres
psql -v ON_ERROR_STOP=1 -q -X -f supabase/tests/stub.sql $DB 2>/dev/null; psql -v ON_ERROR_STOP=1 -q -X -f supabase/schema.sql $DB 2>/dev/null
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=anon-key-test-0123456789 npx vite build --outDir /tmp/wh_e2e_dist --emptyOutDir >/dev/null
pkill -f mock_supabase.py 2>/dev/null || true; pkill -f "http.server 4173" 2>/dev/null || true
python3 supabase/tests/e2e/mock_supabase.py $DB 54321 >/tmp/mock.log 2>&1 &
(cd /tmp/wh_e2e_dist && python3 -m http.server 4173 >/tmp/static.log 2>&1) &
sleep 2
trap 'pkill -f mock_supabase.py; pkill -f "http.server 4173"' EXIT
python3 supabase/tests/e2e/run_e2e.py
