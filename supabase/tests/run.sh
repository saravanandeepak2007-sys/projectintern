#!/usr/bin/env bash
# Usage: supabase/tests/run.sh   (needs a local Postgres 14+; see README "Database tests")
set -e
cd "$(dirname "$0")"
PG="psql -v ON_ERROR_STOP=1 -q -X ${PGCONN:-}"
for mode in fresh upgrade; do
  echo "=== $mode ==="
  DB=wh_$mode
  psql -q -X -c "drop database if exists $DB" postgres >/dev/null 2>&1 || true
  psql -q -X -c "create database $DB" postgres
  P="psql -v ON_ERROR_STOP=1 -q -X $DB"
  $P -f stub.sql
  if [ $mode = fresh ]; then $P -f ../schema.sql; else $P -f schema_v2.sql; $P -f ../patch_v3.sql; fi
  $P -f tests.sql
done
echo "ALL DATABASE TESTS PASSED"
