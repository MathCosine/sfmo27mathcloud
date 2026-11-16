#!/usr/bin/env bash
# Loads the migration (twice) into a throwaway system Postgres, to check it
# runs on a real server version like Supabase's, not only on PGlite.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="${bin:+$bin:}$PATH"
dir="$(mktemp -d)"
cleanup() { pg_ctl -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
run() { if [ "$(id -u)" = 0 ]; then chown -R postgres "$dir"; su postgres -s /bin/bash -c "PATH=$PATH $*"; else bash -c "$*"; fi; }
run "initdb -D $dir/data -A trust -U postgres >/dev/null"
run "pg_ctl -D $dir/data -o '-k $dir -p 54329 -c listen_addresses=' -l $dir/log -w start >/dev/null"
cp "$here/supabase/tests/stub_auth.sql" "$here/supabase/migrations/0001_sfmo.sql" "$dir/"
q() { run "psql -h $dir -p 54329 -U postgres -v ON_ERROR_STOP=1 -q -t -A $*"; }
q "-c 'create database sfmo'"
q "-d sfmo -f $dir/stub_auth.sql"
q "-d sfmo -f $dir/0001_sfmo.sql"
q "-d sfmo -f $dir/0001_sfmo.sql"
q "-d sfmo -c \"select postgres_version() \"" 2>/dev/null || true
q "-d sfmo -c \"select version()\""
q "-d sfmo -c \"set role anon; select s_sign_in('{\\\"id\\\":\\\"x\\\",\\\"email\\\":\\\"y\\\"}'::jsonb)\""
echo "migration OK on real Postgres"
