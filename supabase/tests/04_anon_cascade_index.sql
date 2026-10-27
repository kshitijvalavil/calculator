-- anon has no access; auth user deletion cascades; history index exists.
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');
insert into public.calculations (user_id, expression, result, mode) values
  ('00000000-0000-0000-0000-00000000000a', '1+1', '2', 'standard'),
  ('00000000-0000-0000-0000-00000000000a', '2+2', '4', 'standard'),
  ('00000000-0000-0000-0000-00000000000b', '3+3', '6', 'standard');

set local role anon;
-- Even with a subject claim, anon must get nothing.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

do $$
begin
  begin
    perform 1 from public.calculations;
    raise exception 'FAIL: anon can select';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon cannot select';
end $$;

do $$
begin
  begin
    insert into public.calculations (expression, result, mode) values ('1', '1', 'standard');
    raise exception 'FAIL: anon can insert';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon cannot insert';
end $$;

do $$
begin
  begin
    update public.calculations set label = 'x';
    raise exception 'FAIL: anon can update';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.calculations;
    raise exception 'FAIL: anon can delete';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon cannot update or delete';
end $$;

reset role;

do $$
declare n int;
begin
  delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
  select count(*) into n from public.calculations
  where user_id = '00000000-0000-0000-0000-00000000000a';
  if n <> 0 then raise exception 'FAIL: % rows left after deleting auth user', n; end if;
  select count(*) into n from public.calculations
  where user_id = '00000000-0000-0000-0000-00000000000b';
  if n <> 1 then raise exception 'FAIL: cascade removed other users'' rows'; end if;
  raise notice 'PASS: deleting an auth user cascades to their calculations only';
end $$;

do $$
declare def text;
begin
  select pg_get_indexdef(i.indexrelid) into def
  from pg_index i
  join pg_class t on t.oid = i.indrelid
  join pg_namespace s on s.oid = t.relnamespace
  where s.nspname = 'public' and t.relname = 'calculations'
    and pg_get_indexdef(i.indexrelid) like '%(user_id, created_at DESC)%';
  if def is null then raise exception 'FAIL: index on (user_id, created_at desc) missing'; end if;
  raise notice 'PASS: history index exists: %', def;
end $$;

do $$
declare rls bool; forced bool;
begin
  select relrowsecurity, relforcerowsecurity into rls, forced
  from pg_class where oid = 'public.calculations'::regclass;
  if not rls then raise exception 'FAIL: RLS not enabled'; end if;
  if not forced then raise exception 'FAIL: RLS not forced'; end if;
  raise notice 'PASS: RLS enabled and forced';
end $$;

do $$
declare n int;
begin
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'calculations'
    and 'authenticated' = any(roles)
    and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if n <> 4 then raise exception 'FAIL: expected 4 per-command policies for authenticated, found %', n; end if;
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'calculations'
    and ('anon' = any(roles) or 'public' = any(roles));
  if n <> 0 then raise exception 'FAIL: % policies grant anon/public access', n; end if;
  raise notice 'PASS: separate select/insert/update/delete policies, none for anon';
end $$;

rollback;
