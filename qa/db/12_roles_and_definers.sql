-- Role escalation and SECURITY DEFINER / view bypass surface.
-- run.sh connects as qa_authenticator (LOGIN, NOINHERIT, member of anon + authenticated),
-- mirroring Supabase's authenticator, so SET ROLE checks are real (not superuser session).
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$ declare r text; ok boolean; begin
  foreach r in array array['postgres', 'service_role'] loop
    ok := false;
    begin
      execute format('set local role %I', r);
      ok := true;
      raise exception 'undo';  -- roll back the subtransaction so we stay authenticated
    exception when insufficient_privilege then null;
              when raise_exception then null;
    end;
    if ok then raise notice 'FAIL: authenticated escalated to %', r;
    else raise notice 'PASS: authenticated cannot set role %', r; end if;
  end loop;
  if current_user <> 'authenticated' then raise notice 'FAIL: still running as %', current_user; end if;
end $$;

-- (SET SESSION AUTHORIZATION is not tested: the harness's initial login is superuser, which always allows it.)

do $$ begin
  begin
    execute 'create function public.qa_evil() returns int language sql security definer as $f$ select 1 $f$';
    raise notice 'FAIL: authenticated can create functions in public';
  exception when insufficient_privilege then raise notice 'PASS: authenticated cannot create objects in public';
  end;
  begin
    execute 'create view public.qa_evil_v as select * from public.calculations';
    raise notice 'FAIL: authenticated can create views in public';
  exception when insufficient_privilege then raise notice 'PASS: authenticated cannot create views in public';
  end;
end $$;

-- authenticated must not be able to disable RLS or drop policies.
do $$ begin
  begin
    execute 'alter table public.calculations disable row level security';
    raise notice 'FAIL: authenticated disabled RLS';
  exception when insufficient_privilege then raise notice 'PASS: authenticated cannot disable RLS';
  end;
  begin
    execute 'set row_security = off';
    perform count(*) from public.calculations;
    raise notice 'FAIL: row_security=off did not error for a non-bypass role';
  exception when insufficient_privilege then raise notice 'PASS: row_security=off errors instead of bypassing';
  end;
end $$;

do $$ begin
  begin
    perform public.calculations_only_label_mutable();
    raise notice 'FAIL: authenticated could call trigger function';
  exception when insufficient_privilege then raise notice 'PASS: trigger function not executable by authenticated';
           when feature_not_supported then raise notice 'PASS: trigger function not callable directly (0A000)';
           when others then raise notice 'PASS: trigger function call refused (% )', sqlstate;
  end;
end $$;

