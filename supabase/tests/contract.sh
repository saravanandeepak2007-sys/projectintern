#!/usr/bin/env bash
# Checks that every table, RPC function and column the app calls exists in the database. Run after run.sh.
set -e
cd "$(dirname "$0")/../.."
DB=${1:-wh_fresh}
fail=0
for t in $(grep -rhoE "from\('[a-z_]+'\)" src | sed -E "s/from\('([a-z_]+)'\)/\1/" | sort -u); do
  [ "$t" = voice ] && continue   # storage bucket, not a table
  n=$(psql -X -Atc "select count(*) from information_schema.tables where table_schema='public' and table_name='$t'" $DB)
  [ "$n" = 1 ] && echo "ok   table  $t" || { echo "FAIL table  $t"; fail=1; }
done
for f in $(grep -rhoE "rpc\('[a-z_]+'" src | sed -E "s/rpc\('([a-z_]+)'/\1/" | sort -u); do
  n=$(psql -X -Atc "select count(*) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname='$f'" $DB)
  [ "$n" -ge 1 ] && echo "ok   rpc    $f" || { echo "FAIL rpc    $f"; fail=1; }
done
cols=$(grep -oE "const COLS = '[^']+'" src/pages/Dashboard.jsx | sed -E "s/.*'([^']+)'/\1/")
for c in ${cols//,/ }; do
  n=$(psql -X -Atc "select count(*) from information_schema.columns where table_name='messages' and column_name='$c'" $DB)
  [ "$n" = 1 ] && echo "ok   column messages.$c" || { echo "FAIL column messages.$c"; fail=1; }
done
exit $fail
