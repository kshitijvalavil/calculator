-- RLS isolation between two authenticated users.
-- User A = ...0a, user B = ...0b.
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');

-- B saves one row.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.calculations (expression, result, mode)
values ('7*6', '42', 'standard');

-- Switch to A.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

do $$
declare n int;
begin
  insert into public.calculations (user_id, expression, result, mode, angle)
  values ('00000000-0000-0000-0000-00000000000a', '1+1', '2', 'standard', 'deg');
  insert into public.calculations (expression, result, mode, angle)
  values ('sin(30)', '0.5', 'scientific', 'deg');
  select count(*) into n from public.calculations;
  if n <> 2 then raise exception 'FAIL: A should see exactly 2 own rows, saw %', n; end if;
  raise notice 'PASS: A inserts and reads own rows';
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.calculations
  where user_id = '00000000-0000-0000-0000-00000000000b';
  if n <> 0 then raise exception 'FAIL: A can see % of B''s rows', n; end if;
  raise notice 'PASS: A cannot see B''s rows';
end $$;

do $$
declare n int;
begin
  update public.calculations set label = 'hacked'
  where user_id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A updated % of B''s rows', n; end if;
  raise notice 'PASS: A cannot update B''s rows (0 rows affected)';
end $$;

do $$
declare n int;
begin
  delete from public.calculations
  where user_id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A deleted % of B''s rows', n; end if;
  raise notice 'PASS: A cannot delete B''s rows (0 rows affected)';
end $$;

do $$
begin
  begin
    insert into public.calculations (user_id, expression, result, mode)
    values ('00000000-0000-0000-0000-00000000000b', '2+2', '4', 'standard');
    raise exception 'FAIL: A inserted a row with B''s user_id';
  exception when insufficient_privilege then
    null; -- RLS WITH CHECK violation (42501), as expected
  end;
  raise notice 'PASS: A cannot insert with B''s user_id';
end $$;

do $$
declare u uuid;
begin
  insert into public.calculations (expression, result, mode)
  values ('3*3', '9', 'standard') returning user_id into u;
  if u is distinct from '00000000-0000-0000-0000-00000000000a'::uuid then
    raise exception 'FAIL: user_id defaulted to % instead of auth.uid()', u;
  end if;
  raise notice 'PASS: user_id defaults to auth.uid()';
end $$;

do $$
declare n int;
begin
  delete from public.calculations where expression = '3*3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not delete own row (% rows)', n; end if;
  raise notice 'PASS: A can delete own rows';
end $$;

-- Unfiltered UPDATE/DELETE: with no WHERE reading columns, Postgres skips the
-- SELECT policy, so only the UPDATE/DELETE policies stand between A and B.
do $$
declare n int;
begin
  update public.calculations set label = 'hacked';
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'FAIL: unfiltered update by A touched % rows, expected A''s 2', n; end if;
  update public.calculations set label = null;
  raise notice 'PASS: unfiltered update by A touches only A''s rows';
end $$;

savepoint before_unfiltered_delete;
do $$
declare n int;
begin
  delete from public.calculations;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'FAIL: unfiltered delete by A removed % rows, expected A''s 2', n; end if;
  raise notice 'PASS: unfiltered delete by A removes only A''s rows';
end $$;
rollback to savepoint before_unfiltered_delete;

-- Back to superuser: B's row must be untouched.
reset role;
do $$
declare r record;
begin
  select * into r from public.calculations
  where user_id = '00000000-0000-0000-0000-00000000000b';
  if not found then raise exception 'FAIL: B''s row is gone'; end if;
  if r.label is not null then raise exception 'FAIL: B''s label changed to %', r.label; end if;
  raise notice 'PASS: B''s row is intact after A''s attempts';
end $$;

-- B sees only its own row.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare n int;
begin
  select count(*) into n from public.calculations;
  if n <> 1 then raise exception 'FAIL: B should see 1 row, saw %', n; end if;
  raise notice 'PASS: B sees only its own row';
end $$;

-- No JWT subject: authenticated sees nothing and cannot insert.
set local request.jwt.claim.sub = '';
do $$
declare n int;
begin
  select count(*) into n from public.calculations;
  if n <> 0 then raise exception 'FAIL: no-sub session saw % rows', n; end if;
  begin
    insert into public.calculations (expression, result, mode) values ('1', '1', 'standard');
    raise exception 'FAIL: no-sub session inserted a row';
  exception when not_null_violation or insufficient_privilege then null;
  end;
  raise notice 'PASS: authenticated without a subject sees and inserts nothing';
end $$;

rollback;
