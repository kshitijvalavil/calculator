-- Length checks with multi-byte and multi-codepoint text.
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$ declare l text; begin
  l := repeat('😀', 80);
  update public.calculations set label = l where id = 'a0000000-0000-4000-8000-000000000001';
  raise notice 'PASS: 80 emoji label accepted (80 code points, % bytes, 160 UTF-16 units)', octet_length(l);
exception when check_violation then raise notice 'FAIL: 80 emoji label rejected (byte counting?)';
end $$;

do $$ begin
  update public.calculations set label = repeat('😀', 81) where id = 'a0000000-0000-4000-8000-000000000001';
  raise notice 'FAIL: 81 emoji label accepted';
exception when check_violation then raise notice 'PASS: 81 emoji label rejected';
end $$;

-- ZWJ family = 5 code points, renders as one glyph. 16 glyphs = 80 code points (ok), 17 = 85 (rejected).
do $$ declare fam text := '👨‍👩‍👧'; begin
  update public.calculations set label = repeat(fam, 16) where id = 'a0000000-0000-4000-8000-000000000001';
  begin
    update public.calculations set label = repeat(fam, 17) where id = 'a0000000-0000-4000-8000-000000000001';
    raise notice 'FAIL: 85 code-point label accepted';
  exception when check_violation then
    raise notice 'INFO: limit counts code points: 16 ZWJ-family glyphs ok, 17 rejected (UI must count the same way; JS .length gives 128/136)';
  end;
end $$;

do $$ begin
  insert into public.calculations (expression, result, mode) values (repeat('×', 500), '1', 'standard');
  raise notice 'PASS: 500 multi-byte expression accepted';
  begin
    insert into public.calculations (expression, result, mode) values (repeat('×', 501), '1', 'standard');
    raise notice 'FAIL: 501 char expression accepted';
  exception when check_violation then raise notice 'PASS: 501 char expression rejected';
  end;
end $$;

-- Whitespace-only and empty label/expression.
do $$ begin
  insert into public.calculations (expression, result, mode) values (' ', '1', 'standard');
  raise notice 'INFO: whitespace-only expression is accepted by the DB (API must reject EMPTY)';
exception when check_violation then raise notice 'PASS: whitespace expression rejected';
end $$;
do $$ begin
  update public.calculations set label = '' where id = 'a0000000-0000-4000-8000-000000000001';
  raise notice 'INFO: empty-string label stored as '''' (contract says API maps "" to cleared; DB does not normalise)';
end $$;

-- NUL byte cannot be stored in text: the API must reject it before the DB with a 400, not a 500.
do $$ begin
  update public.calculations set label = convert_from('\x6100'::bytea, 'UTF8') where id = 'a0000000-0000-4000-8000-000000000001';
  raise notice 'FAIL: NUL stored';
exception when others then raise notice 'INFO: NUL in label raises % (API must pre-validate)', sqlstate;
end $$;

-- mode/angle are case-sensitive.
do $$ begin
  insert into public.calculations (expression, result, mode, angle) values ('1', '1', 'Standard', 'deg');
  raise notice 'FAIL: mode Standard accepted';
exception when check_violation then raise notice 'PASS: mode is case-sensitive';
end $$;
do $$ begin
  insert into public.calculations (expression, result, mode, angle) values ('1', '1', 'standard', 'grad');
  raise notice 'FAIL: angle grad accepted';
exception when check_violation then raise notice 'PASS: angle grad rejected';
end $$;
