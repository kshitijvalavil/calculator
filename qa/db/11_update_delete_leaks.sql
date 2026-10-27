-- Update/delete/returning/count leaks as user A.
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$ begin
  begin
    update public.calculations set label = 'x', user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      where id = 'a0000000-0000-4000-8000-000000000001';
    raise notice 'FAIL: user_id changed alongside label';
  exception when insufficient_privilege then raise notice 'PASS: label+user_id update refused';
  end;
end $$;

-- UPDATE ... FROM a subquery that names B's ids: label-only path, still 0 rows.
do $$ declare n int; begin
  update public.calculations c set label = 'from-join'
    from (values ('b0000000-0000-4000-8000-000000000001'::uuid), ('b0000000-0000-4000-8000-000000000002'::uuid)) v(id)
    where c.id = v.id;
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS: UPDATE..FROM cannot reach B''s rows'; else raise notice 'FAIL: UPDATE..FROM touched % B rows', n; end if;
end $$;

-- RETURNING on update/delete aimed at B must leak nothing.
do $$ declare r record; c int := 0; begin
  for r in update public.calculations set label = label where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning * loop c := c + 1; end loop;
  for r in delete from public.calculations where id::text like 'b%' returning * loop c := c + 1; end loop;
  for r in update public.calculations set label = 'z' returning * loop
    if r.user_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then c := c + 100; end if;
  end loop;
  if c = 0 then raise notice 'PASS: update/delete RETURNING leaks no foreign rows'; else raise notice 'FAIL: RETURNING leaked (score %)', c; end if;
end $$;

-- SELECT FOR UPDATE on B's rows.
do $$ declare n int; begin
  select count(*) into n from (select * from public.calculations where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' for update) s;
  if n = 0 then raise notice 'PASS: SELECT FOR UPDATE sees no B rows'; else raise notice 'FAIL: FOR UPDATE saw % B rows', n; end if;
end $$;

-- count(*) and aggregate leaks.
do $$ declare n int; m int; begin
  select count(*) into n from public.calculations;
  select count(distinct user_id) into m from public.calculations;
  if n = 1 and m = 1 then raise notice 'PASS: count(*) = 1 and distinct user_id = 1 for A';
  else raise notice 'FAIL: count leak n=% users=%', n, m; end if;
end $$;

-- Leaky function attack: a non-leakproof function in WHERE must not see B's rows before RLS filters.
create temp table seen(expr text);
create function pg_temp.peek(t text) returns boolean language plpgsql cost 0.0000001 as
$f$ begin insert into seen values (t); return true; end $f$;
do $$ declare n int; begin
  perform * from public.calculations where pg_temp.peek(expression);
  select count(*) into n from seen where expr like 'secret-b%';
  if n = 0 then raise notice 'PASS: cheap leaky function never saw B''s values (security barrier holds)';
  else raise notice 'FAIL: leaky function saw % of B''s expressions', n; end if;
end $$;

-- Error-message side channel: dividing by zero only for B's rows would reveal them.
do $$ begin
  perform * from public.calculations where 1 / (case when expression = 'secret-b-1' then 0 else 1 end) = 1;
  raise notice 'PASS: error-oracle on B''s values did not fire';
exception when division_by_zero then raise notice 'FAIL: error oracle fired on B''s hidden row';
end $$;

-- pg_stats must not expose MCVs from a table with active RLS.
reset role;
analyze public.calculations;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ declare n int; begin
  select count(*) into n from pg_stats where tablename = 'calculations' and schemaname = 'public';
  if n = 0 then raise notice 'PASS: pg_stats hides calculations stats from authenticated';
  else raise notice 'FAIL: pg_stats exposes % column stats rows for calculations', n; end if;
end $$;

-- Informational: catalog row-count estimates are visible to every role (standard Postgres).
do $$ declare t real; begin
  select reltuples into t from pg_class where oid = 'public.calculations'::regclass;
  raise notice 'INFO: authenticated can read pg_class.reltuples = % (total row estimate across all users)', t;
end $$;

-- EXPLAIN ANALYZE "Rows Removed by Filter" count oracle (informational: needs raw SQL access).
do $$ declare l text; leaked boolean := false; begin
  for l in execute 'explain (analyze, costs off, timing off, summary off) select * from public.calculations' loop
    if l like '%Rows Removed by Filter: 2%' then leaked := true; end if;
  end loop;
  if leaked then raise notice 'INFO: EXPLAIN ANALYZE reveals other users'' row count via "Rows Removed by Filter" (needs raw SQL; not reachable via PostgREST by default)';
  else raise notice 'PASS: EXPLAIN ANALYZE did not reveal foreign row count'; end if;
end $$;

-- authenticated must not be able to TRUNCATE (bypasses RLS entirely).
do $$ begin
  begin
    truncate public.calculations;
    raise notice 'FAIL: authenticated could TRUNCATE';
  exception when insufficient_privilege then raise notice 'PASS: authenticated cannot TRUNCATE';
  end;
end $$;

-- B's rows untouched at the end.
reset role;
do $$ declare n int; begin
  select count(*) into n from public.calculations where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and label is not distinct from case when id = 'b0000000-0000-4000-8000-000000000001' then 'b-label' end;
  if n = 2 then raise notice 'PASS: B''s rows intact'; else raise notice 'FAIL: B''s rows changed (% intact)', n; end if;
end $$;
