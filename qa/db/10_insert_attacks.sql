-- Insert-path attacks as user A.
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$ begin
  begin
    insert into public.calculations (user_id, expression, result, mode) values (null, 'x', '1', 'standard');
    raise notice 'FAIL: explicit user_id = null was accepted';
  exception when not_null_violation then raise notice 'PASS: explicit user_id = null rejected (not null)';
           when insufficient_privilege then raise notice 'PASS: explicit user_id = null rejected (RLS)';
           when others then raise notice 'FAIL: user_id=null unexpected error % %', sqlstate, sqlerrm;
  end;
end $$;

do $$ begin
  begin
    insert into public.calculations (id, expression, result, mode) values ('b0000000-0000-4000-8000-000000000001', 'x', '1', 'standard');
    raise notice 'FAIL: A could choose the id';
  exception when insufficient_privilege then raise notice 'PASS: A cannot choose id (column grant)';
           when others then raise notice 'FAIL: explicit id unexpected % %', sqlstate, sqlerrm;
  end;
end $$;

do $$ begin
  begin
    insert into public.calculations (created_at, expression, result, mode) values ('2000-01-01', 'x', '1', 'standard');
    raise notice 'FAIL: A could backdate created_at';
  exception when insufficient_privilege then raise notice 'PASS: A cannot set created_at';
           when others then raise notice 'FAIL: created_at unexpected % %', sqlstate, sqlerrm;
  end;
end $$;

-- Upsert: ON CONFLICT DO UPDATE needs a conflict target; id is not insertable, so it must not
-- become a way to touch B's row.
do $$ declare n int; begin
  begin
    insert into public.calculations (id, expression, result, mode) values ('b0000000-0000-4000-8000-000000000001','x','1','standard')
      on conflict (id) do update set label = 'pwned';
    raise notice 'FAIL: upsert on B''s id went through';
  exception when insufficient_privilege then raise notice 'PASS: upsert on B''s id refused';
           when others then raise notice 'FAIL: upsert unexpected % %', sqlstate, sqlerrm;
  end;
end $$;

-- MERGE (PG15+): matched update against B's row, not-matched insert with B's user_id.
do $$ declare n int; begin
  merge into public.calculations c
    using (select 'b0000000-0000-4000-8000-000000000001'::uuid as id) s on c.id = s.id
    when matched then update set label = 'merged';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS: MERGE cannot update B''s row (0 rows)';
  else raise notice 'FAIL: MERGE updated % of B''s rows', n; end if;
exception when insufficient_privilege then raise notice 'PASS: MERGE update on B refused (42501)';
end $$;

do $$ begin
  begin
    merge into public.calculations c
      using (select 1) s on false
      when not matched then insert (user_id, expression, result, mode)
        values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'x', '1', 'standard');
    raise notice 'FAIL: MERGE inserted with B''s user_id';
  exception when insufficient_privilege then raise notice 'PASS: MERGE insert with B''s user_id refused';
           when others then raise notice 'FAIL: MERGE insert unexpected % %', sqlstate, sqlerrm;
  end;
end $$;

-- INSERT ... SELECT from the table must only copy rows A can see.
do $$ declare n int; begin
  insert into public.calculations (expression, result, mode)
    select expression, result, mode from public.calculations;
  get diagnostics n = row_count;
  if n = 1 then raise notice 'PASS: INSERT..SELECT only copies A''s visible rows';
  else raise notice 'FAIL: INSERT..SELECT copied % rows (A owns 1)', n; end if;
end $$;

-- Insert RETURNING must only ever return the new row.
do $$ declare r record; c int := 0; begin
  for r in insert into public.calculations (expression, result, mode) values ('ret', '1', 'standard') returning * loop
    c := c + 1;
    if r.user_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then raise notice 'FAIL: returning gave foreign row'; end if;
  end loop;
  if c = 1 then raise notice 'PASS: insert returning yields exactly the new row'; else raise notice 'FAIL: returning rows=%', c; end if;
end $$;

-- Garbage JWT subject must error, not bypass.
do $$ declare n int; begin
  perform set_config('request.jwt.claim.sub', 'not-a-uuid', true);
  begin
    select count(*) into n from public.calculations;
    raise notice 'FAIL: garbage sub returned % rows instead of erroring', n;
  exception when invalid_text_representation then raise notice 'PASS: garbage sub errors (22P02), no rows';
  end;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
end $$;

-- Subject for a user that does not exist in auth.users: insert must fail on FK, not orphan a row.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  begin
    insert into public.calculations (expression, result, mode) values ('x','1','standard');
    raise notice 'FAIL: orphan row inserted for non-existent user';
  exception when foreign_key_violation then raise notice 'PASS: non-existent user cannot insert (FK)';
           when insufficient_privilege then raise notice 'FAIL: FK check needs REFERENCES/SELECT on auth.users? got 42501 %', sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
end $$;

-- anon with a forged sub claim still gets nothing.
reset role;
set local role anon;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ declare n int; begin
  begin
    select count(*) into n from public.calculations;
    raise notice 'FAIL: anon with B''s sub saw % rows', n;
  exception when insufficient_privilege then raise notice 'PASS: anon with forged sub denied select';
  end;
  begin
    truncate public.calculations;
    raise notice 'FAIL: anon truncated';
  exception when insufficient_privilege then raise notice 'PASS: anon cannot truncate';
  end;
end $$;
