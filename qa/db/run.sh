#!/usr/bin/env bash
# QA black-box DB tests. Builds a throwaway DB (qa_test) from the same auth stub and
# migrations the builder uses, then runs every qa/db/[0-9]*.sql inside begin/rollback,
# plus a concurrent-insert stress section. Prints PASS/FAIL/INFO lines and a summary.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
QA="$ROOT/qa/db"
DB=qa_test
SOCK="${PGHOST:-/var/run/postgresql}"
as_pg() { if [[ "$(id -u)" -eq 0 ]]; then (cd / && runuser -u postgres -- "$@"); else "$@"; fi; }
psql_db() { as_pg psql -X -q -h "$SOCK" -U postgres -d "$1" "${@:2}"; }
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT

psql_db postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB with (force)" -c "create database $DB" || exit 2
{ cat "$ROOT/supabase/tests/00_auth_stub.sql"; cat "$ROOT"/supabase/migrations/*.sql; } \
  | psql_db $DB -v ON_ERROR_STOP=1 -f - >/dev/null || { echo "setup failed" >&2; exit 2; }

# Non-superuser login role, like Supabase's authenticator, for files that test SET ROLE.
psql_db $DB -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'qa_authenticator') then
    create role qa_authenticator login noinherit;
  end if;
end $$;
grant anon, authenticated to qa_authenticator;
SQL
psql_as() {  # psql_as <role>: postgres or qa_authenticator
  # Local auth is peer-only, so log in as postgres and drop to the role with SET SESSION
  # AUTHORIZATION; SET ROLE membership checks then use qa_authenticator.
  if [[ $1 == postgres ]]; then psql_db $DB -f -; else { echo "set session authorization $1;"; cat; } | psql_db $DB -f -; fi
}
for f in "$QA"/[0-9]*.sql; do
  echo "==> ${f#"$ROOT"/}"
  login=postgres; [[ $(basename "$f") == 12_* ]] && login=qa_authenticator
  { echo "begin;"; [[ $login == postgres ]] && cat "$QA/_seed.sql"; cat "$f"; echo "rollback;"; } \
    | psql_as $login 2>&1 | sed -e 's/^psql:<stdin>:[0-9]*: //' -e 's/^NOTICE:  //' | tee -a "$LOG"
done

echo "==> concurrent inserts / label updates / deletes (20 sessions)"
psql_db $DB -v ON_ERROR_STOP=1 -c "insert into auth.users values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')" >/dev/null
pids=()
for i in $(seq 1 20); do
  if (( i % 2 )); then u=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; else u=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb; fi
  ( for j in $(seq 1 25); do
      echo "begin; set local role authenticated; set local request.jwt.claim.sub = '$u';"
      echo "insert into public.calculations (expression, result, mode) values ('s$i-$j', '$j', 'standard');"
      echo "update public.calculations set label = 'l$i' where expression = 's$i-$j';"
      echo "commit;"
    done
    # each session also tries to delete the *other* user's rows by explicit filter
    other=$([[ $u == a* ]] && echo bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb || echo aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)
    echo "begin; set local role authenticated; set local request.jwt.claim.sub = '$u'; delete from public.calculations where user_id = '$other'; commit;"
  ) | psql_db $DB -v ON_ERROR_STOP=1 -f - >/dev/null 2>"$LOG.err$i" &
  pids+=($!)
done
errs=0; for p in "${pids[@]}"; do wait "$p" || errs=$((errs+1)); done
if (( errs == 0 )); then echo "PASS: 20 concurrent sessions finished without errors (no deadlocks/serialization failures)" | tee -a "$LOG"
else echo "FAIL: $errs concurrent sessions errored: $(cat "$LOG".err* | head -3)" | tee -a "$LOG"; fi
rm -f "$LOG".err*
res=$(psql_db $DB -At -c "select
  (select count(*) from public.calculations) || ',' ||
  (select count(*) from public.calculations where user_id::text like 'a%') || ',' ||
  (select count(*) from public.calculations where user_id::text like 'a%' and expression ~ '^s[0-9]*[13579]-') || ',' ||
  (select count(*) from public.calculations where user_id::text like 'b%' and expression ~ '^s[0-9]*[02468]-') || ',' ||
  (select count(distinct id) from public.calculations)")
IFS=, read total acount aok bok distinct <<<"$res"
if [[ $total == 500 && $acount == 250 && $aok == 250 && $bok == 250 && $distinct == 500 ]]; then
  echo "PASS: 500 rows, 250 per user, every row owned by the session that wrote it, unique ids" | tee -a "$LOG"
else echo "FAIL: concurrency totals total=$total a=$acount aok=$aok bok=$bok distinct=$distinct" | tee -a "$LOG"; fi
cross=$(psql_db $DB -At -c "select count(*) from public.calculations where label is distinct from 'l' || split_part(substr(expression,2),'-',1)")
if [[ $cross == 0 ]]; then echo "PASS: every concurrently written row carries its own session's label" | tee -a "$LOG"
else echo "FAIL: $cross rows have a wrong/missing label after concurrent updates" | tee -a "$LOG"; fi

pass=$(grep -c '^PASS:' "$LOG"); fail=$(grep -c '^FAIL:' "$LOG"); info=$(grep -c '^INFO:' "$LOG")
errors=$(grep -cE '^ERROR:|^psql: error|FATAL' "$LOG")
echo; echo "QA DB SUMMARY: $pass passed, $fail failed, $errors unexpected SQL errors, $info info"
(( fail == 0 && errors == 0 ))
