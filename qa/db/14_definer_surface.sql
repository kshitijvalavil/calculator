-- Runs as postgres (superuser).
-- No SECURITY DEFINER functions or owner-rights views over calculations in exposed schemas.
do $$ declare n int; begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('public') and p.prosecdef;
  if n = 0 then raise notice 'PASS: no SECURITY DEFINER functions in public';
  else raise notice 'FAIL: % SECURITY DEFINER function(s) in public', n; end if;

  select count(*) into n from pg_views where schemaname = 'public';
  if n = 0 then raise notice 'PASS: no views in public that could bypass RLS';
  else raise notice 'FAIL: % view(s) in public (check security_invoker)', n; end if;

  select count(*) into n from pg_matviews where schemaname = 'public';
  if n = 0 then raise notice 'PASS: no materialized views in public';
  else raise notice 'FAIL: % matview(s) in public', n; end if;
end $$;

-- Sanity: a SECURITY DEFINER function owned by postgres WOULD bypass RLS (proves the check above matters).
create function public.qa_probe_definer() returns bigint language sql security definer set search_path = '' as
$f$ select count(*) from public.calculations $f$;
set local role authenticated;
do $$ declare n bigint; begin
  select public.qa_probe_definer() into n;
  if n = 3 then raise notice 'INFO: default privileges auto-grant EXECUTE on new public functions to authenticated/anon; any future SECURITY DEFINER function would leak all rows (saw %)', n;
  else raise notice 'INFO: definer probe saw %', n; end if;
exception when insufficient_privilege then raise notice 'PASS: new public functions not auto-executable';
end $$;
reset role;
set local role anon;
do $$ declare n bigint; begin
  select public.qa_probe_definer() into n;
  raise notice 'INFO: anon can also execute new public functions by default (saw % rows)', n;
exception when insufficient_privilege then raise notice 'PASS: anon cannot execute new public functions';
end $$;
