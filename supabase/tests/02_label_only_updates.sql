-- Updates may change only label.
begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a');
insert into public.calculations (id, user_id, expression, result, mode)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a',
        '1+1', '2', 'standard');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

do $$
declare n int; l text;
begin
  update public.calculations set label = 'groceries'
  where id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  select label into l from public.calculations where id = '11111111-1111-1111-1111-111111111111';
  if n <> 1 or l is distinct from 'groceries' then
    raise exception 'FAIL: label update affected % rows, label=%', n, l;
  end if;
  update public.calculations set label = null
  where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'PASS: A can update (and clear) label on own row';
end $$;

do $$
declare
  col text;
  stmt text;
begin
  foreach col in array array['expression', 'result', 'mode', 'user_id', 'angle', 'created_at', 'id'] loop
    stmt := case col
      when 'expression' then $q$update public.calculations set expression = '9*9'$q$
      when 'result'     then $q$update public.calculations set result = '81'$q$
      when 'mode'       then $q$update public.calculations set mode = 'scientific'$q$
      when 'angle'      then $q$update public.calculations set angle = 'rad'$q$
      when 'user_id'    then $q$update public.calculations set user_id = '00000000-0000-0000-0000-00000000000a'$q$
      when 'created_at' then $q$update public.calculations set created_at = now() - interval '1 day'$q$
      when 'id'         then $q$update public.calculations set id = gen_random_uuid()$q$
    end || $q$ where id = '11111111-1111-1111-1111-111111111111'$q$;
    begin
      execute stmt;
      raise exception 'FAIL: A was allowed to update %', col;
    exception when insufficient_privilege then null;
    end;
    raise notice 'PASS: A cannot update %', col;
  end loop;
end $$;

-- The trigger also blocks roles with full UPDATE privilege.
reset role;
set local role service_role;
do $$
begin
  begin
    update public.calculations set expression = '9*9'
    where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL: service_role changed expression';
  exception when insufficient_privilege then null;
  end;
  update public.calculations set label = 'ok'
  where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'PASS: trigger blocks non-label changes even for service_role';
end $$;

rollback;
