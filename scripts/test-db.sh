#!/usr/bin/env bash
# Database tests for public.calculations against plain Postgres 16.
#
# Creates a throwaway database, applies supabase/tests/00_auth_stub.sql, every
# migration in supabase/migrations (in filename order), then every other
# supabase/tests/*.sql file. Stops on the first error with a non-zero exit.
#
# Connection:
#   DATABASE_URL set   -> used as-is for admin work (CI: postgres service, user postgres);
#                         the test database replaces its database name.
#   DATABASE_URL unset -> local socket as the postgres user. If running as root,
#                         the local 16/main cluster is started when it is down.
#
# TEST_DB_NAME overrides the throwaway database name (default calc_test).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
TESTS_DIR="$ROOT/supabase/tests"
STUB="$TESTS_DIR/00_auth_stub.sql"
DB_NAME="${TEST_DB_NAME:-calc_test}"

if [[ ! "$DB_NAME" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "TEST_DB_NAME must be a simple lowercase identifier" >&2
  exit 2
fi

PSQL_OPTS=(-X -q -v ON_ERROR_STOP=1)

if [[ -n "${DATABASE_URL:-}" ]]; then
  ADMIN_URL="$DATABASE_URL"
  # Swap the database name in the URL path, keeping any ?query string.
  base="${DATABASE_URL%%\?*}"
  query=""
  [[ "$DATABASE_URL" == *\?* ]] && query="?${DATABASE_URL#*\?}"
  TEST_URL="${base%/*}/${DB_NAME}${query}"
  admin_psql() { psql "${PSQL_OPTS[@]}" "$ADMIN_URL" "$@"; }
  test_psql()  { psql "${PSQL_OPTS[@]}" "$TEST_URL" "$@"; }
else
  if [[ "$(id -u)" -eq 0 ]] && command -v pg_lsclusters >/dev/null 2>&1; then
    if pg_lsclusters 16 main 2>/dev/null | grep -q ' down '; then
      echo "Starting local PostgreSQL 16/main cluster..."
      pg_ctlcluster 16 main start
    fi
  fi
  SOCKET_DIR="${PGHOST:-/var/run/postgresql}"
  run_as_pg() {
    if [[ "$(id -un)" == "postgres" ]]; then "$@"
    elif [[ "$(id -u)" -eq 0 ]]; then
      # cd so psql isn't stuck in a directory postgres can't read.
      (cd / && runuser -u postgres -- "$@")
    else "$@"
    fi
  }
  admin_psql() { run_as_pg psql "${PSQL_OPTS[@]}" -h "$SOCKET_DIR" -U postgres -d postgres "$@"; }
  test_psql()  { run_as_pg psql "${PSQL_OPTS[@]}" -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" "$@"; }
fi

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

# Feed files on stdin so the postgres user needn't be able to read the repo.
apply() {
  local label="$1" file="$2"
  echo "==> $label: ${file#"$ROOT"/}"
  if ! test_psql -f - < "$file" 2>&1 | tee -a "$LOG" | sed -e 's/^psql:<stdin>:[0-9]*: //' -e 's/^NOTICE:  //'; then
    echo
    echo "FAILED in ${file#"$ROOT"/} ($(grep -c 'PASS:' "$LOG" || true) assertions passed before the failure)" >&2
    exit 1
  fi
}

echo "==> Recreating database $DB_NAME"
admin_psql -c "drop database if exists $DB_NAME with (force)"
admin_psql -c "create database $DB_NAME"

apply "stub" "$STUB"

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)
tests=()
for f in "$TESTS_DIR"/*.sql; do
  [[ "$f" == "$STUB" ]] || tests+=("$f")
done

if (( ${#migrations[@]} == 0 )); then echo "No migrations found" >&2; exit 1; fi
if (( ${#tests[@]} == 0 )); then echo "No test files found" >&2; exit 1; fi

for f in "${migrations[@]}"; do apply "migration" "$f"; done
for f in "${tests[@]}"; do apply "test" "$f"; done

passed=$(grep -c 'PASS:' "$LOG" || true)
echo
echo "SUMMARY: ${#migrations[@]} migration(s), ${#tests[@]} test file(s), $passed assertions passed, 0 failed"
