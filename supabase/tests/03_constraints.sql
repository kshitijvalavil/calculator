-- Check constraints and defaults.
begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

do $$
declare r record;
begin
  insert into public.calculations (expression, result, mode)
  values ('2+2', '4', 'standard') returning * into r;
  if r.id is null or r.angle <> 'deg' or r.label is not null or r.created_at is null then
    raise exception 'FAIL: defaults wrong: %', row_to_json(r);
  end if;
  raise notice 'PASS: defaults (id, angle=deg, label null, created_at)';
end $$;

do $$
begin
  insert into public.calculations (expression, result, mode, label)
  values (repeat('1', 500), repeat('9', 2000), 'scientific', repeat('x', 80));
  raise notice 'PASS: boundary values accepted (500-char expression, 2000-char result, 80-char label)';
end $$;

do $$
declare
  cases text[][] := array[
    array['bad mode',              $q$insert into public.calculations (expression, result, mode) values ('1', '1', 'graphing')$q$],
    array['bad angle',             $q$insert into public.calculations (expression, result, mode, angle) values ('1', '1', 'standard', 'grad')$q$],
    array['empty expression',      $q$insert into public.calculations (expression, result, mode) values ('', '1', 'standard')$q$],
    array['501-char expression',   $q$insert into public.calculations (expression, result, mode) values (repeat('1', 501), '1', 'standard')$q$],
    array['81-char label',         $q$insert into public.calculations (expression, result, mode, label) values ('1', '1', 'standard', repeat('x', 81))$q$],
    array['empty result',          $q$insert into public.calculations (expression, result, mode) values ('1', '', 'standard')$q$],
    array['2001-char result',      $q$insert into public.calculations (expression, result, mode) values ('1', repeat('9', 2001), 'standard')$q$]
  ];
  i int;
begin
  for i in 1 .. array_length(cases, 1) loop
    begin
      execute cases[i][2];
      raise exception 'FAIL: % was accepted', cases[i][1];
    exception when check_violation then null;
    end;
    raise notice 'PASS: check constraint rejects %', cases[i][1];
  end loop;
end $$;

do $$
begin
  begin
    insert into public.calculations (expression, result) values ('1', '1');
    raise exception 'FAIL: missing mode was accepted';
  exception when not_null_violation then null;
  end;
  raise notice 'PASS: mode is required';
end $$;

-- An over-long label via UPDATE is rejected too.
do $$
begin
  begin
    update public.calculations set label = repeat('x', 81) where expression = '2+2';
    raise exception 'FAIL: 81-char label accepted on update';
  exception when check_violation then null;
  end;
  raise notice 'PASS: check constraint rejects 81-char label on update';
end $$;

rollback;
