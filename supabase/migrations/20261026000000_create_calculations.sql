-- Calculator pilot: saved calculations history.
-- Spec: contract/CONTRACT.md, "Database (public.calculations)".
-- Relies on what Supabase provides: the auth schema, auth.users, auth.uid(),
-- and the anon / authenticated / service_role roles. Do not create them here.

create table public.calculations (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,
  expression  text        not null,
  result      text        not null,
  mode        text        not null,
  angle       text        not null default 'deg',
  label       text        null,
  created_at  timestamptz not null default now(),

  constraint calculations_expression_length check (char_length(expression) between 1 and 500),
  constraint calculations_result_length     check (char_length(result) between 1 and 2000),
  constraint calculations_mode_valid        check (mode in ('standard', 'scientific')),
  constraint calculations_angle_valid       check (angle in ('deg', 'rad')),
  constraint calculations_label_length      check (label is null or char_length(label) <= 80)
);

comment on table public.calculations is
  'Saved calculator results. One row per evaluation, owned by auth.users(id). Only label is mutable.';

-- History is read as: where user_id = auth.uid() order by created_at desc limit n
create index calculations_user_id_created_at_idx
  on public.calculations (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.calculations enable row level security;
-- Apply policies to the table owner too. Roles with BYPASSRLS (service_role,
-- and postgres on Supabase) and FK cascades are unaffected.
alter table public.calculations force row level security;

create policy calculations_select_own on public.calculations
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy calculations_insert_own on public.calculations
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy calculations_update_own on public.calculations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy calculations_delete_own on public.calculations
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Privileges
-- Supabase's default privileges grant ALL on new public tables to anon,
-- authenticated and service_role. Take that back and grant only what the
-- contract allows.
-- ---------------------------------------------------------------------------
revoke all on table public.calculations from public, anon, authenticated;

grant select, delete on table public.calculations to authenticated;
-- id and created_at are always server-generated.
grant insert (user_id, expression, result, mode, angle, label)
  on table public.calculations to authenticated;
-- Only label may change.
grant update (label) on table public.calculations to authenticated;

-- service_role keeps full table privileges from Supabase's defaults; the
-- trigger below still keeps every column except label immutable.

-- ---------------------------------------------------------------------------
-- Immutability trigger: defence in depth behind the column grants, and it
-- also covers roles that hold full UPDATE (service_role).
-- ---------------------------------------------------------------------------
create function public.calculations_only_label_mutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id         is distinct from old.id
  or new.user_id    is distinct from old.user_id
  or new.expression is distinct from old.expression
  or new.result     is distinct from old.result
  or new.mode       is distinct from old.mode
  or new.angle      is distinct from old.angle
  or new.created_at is distinct from old.created_at
  then
    raise exception 'only label can be updated on public.calculations'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.calculations_only_label_mutable() from public, anon, authenticated;

create trigger calculations_only_label_mutable
  before update on public.calculations
  for each row execute function public.calculations_only_label_mutable();
