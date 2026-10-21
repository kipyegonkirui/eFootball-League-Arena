create type public.app_role as enum ('admin', 'user');
create type public.registration_status as enum ('pending', 'verified', 'rejected');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create policy "Users read own roles" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- Settings (single row)
create table public.tournament_settings (
  id int primary key default 1 check (id = 1),
  name text not null default 'eFootball Arena Kenya Cup',
  description text not null default 'Competitive eFootball tournament for players across Kenya. Groups of 8, knockout glory.',
  fee_kes int not null default 100 check (fee_kes >= 0),
  mpesa_paybill text,
  mpesa_till text,
  mpesa_account_reference text,
  payment_instructions text,
  registration_open boolean not null default true,
  group_capacity int not null default 8 check (group_capacity between 2 and 64),
  max_groups int not null default 4 check (max_groups between 1 and 512),
  start_date text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
grant select, update on public.tournament_settings to authenticated;
grant all on public.tournament_settings to service_role;
alter table public.tournament_settings enable row level security;
create policy "Admins read settings" on public.tournament_settings for select to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "Admins update settings" on public.tournament_settings for update to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
insert into public.tournament_settings (id) values (1);

-- Groups (public safe: no personal data)
create table public.tournament_groups (
  id uuid primary key default gen_random_uuid(),
  group_number int not null unique,
  capacity int not null default 8,
  verified_count int not null default 0,
  is_full boolean not null default false,
  created_at timestamptz not null default now()
);
grant select on public.tournament_groups to anon, authenticated;
grant all on public.tournament_groups to service_role;
alter table public.tournament_groups enable row level security;
create policy "Anyone reads groups" on public.tournament_groups for select to anon, authenticated using (true);

-- Registrations (private)
create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  gamer_tag text not null,
  full_name text not null,
  phone text not null,
  email text,
  platform text not null check (platform in ('Mobile','PlayStation','Xbox','Other')),
  game_mode text not null,
  status registration_status not null default 'pending',
  group_id uuid references public.tournament_groups(id),
  slot_number int,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (group_id, slot_number)
);
create unique index registrations_active_phone on public.registrations (phone) where status <> 'rejected';
create unique index registrations_active_tag on public.registrations (lower(gamer_tag)) where status <> 'rejected';
grant select on public.registrations to authenticated;
grant all on public.registrations to service_role;
alter table public.registrations enable row level security;
create policy "Admins read registrations" on public.registrations for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  payer_phone text not null,
  transaction_code text not null,
  amount_kes int not null,
  expected_fee_kes int not null,
  screenshot_path text,
  method text not null default 'mpesa_manual',
  status registration_status not null default 'pending',
  created_at timestamptz not null default now()
);
create unique index payment_submissions_code on public.payment_submissions (upper(transaction_code)) where status <> 'rejected';
grant select on public.payment_submissions to authenticated;
grant all on public.payment_submissions to service_role;
alter table public.payment_submissions enable row level security;
create policy "Admins read payments" on public.payment_submissions for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.verification_audit (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  submission_id uuid references public.payment_submissions(id) on delete set null,
  actor_id uuid,
  actor_kind text not null default 'admin',
  decision text not null check (decision in ('verified','rejected')),
  reason text,
  transaction_code text,
  amount_kes int,
  group_number int,
  slot_number int,
  created_at timestamptz not null default now()
);
grant select on public.verification_audit to authenticated;
grant all on public.verification_audit to service_role;
alter table public.verification_audit enable row level security;
create policy "Admins read audit" on public.verification_audit for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  gamer_tag text not null,
  phone text not null,
  email text,
  created_at timestamptz not null default now()
);
create unique index waitlist_phone on public.waitlist (phone);
grant select on public.waitlist to authenticated;
grant all on public.waitlist to service_role;
alter table public.waitlist enable row level security;
create policy "Admins read waitlist" on public.waitlist for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- Helpers
create or replace function public.normalize_ke_phone(_p text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(_p,''), '\D', '', 'g');
begin
  if d ~ '^0[17]\d{8}$' then return '254' || substr(d,2);
  elsif d ~ '^254[17]\d{8}$' then return d;
  elsif d ~ '^[17]\d{8}$' then return '254' || d;
  end if;
  return null;
end $$;

create or replace function public.verified_total()
returns int language sql stable security definer set search_path = public
as $$ select count(*)::int from public.registrations where status = 'verified' $$;

-- Public tournament snapshot (no personal data)
create or replace function public.get_public_tournament()
returns json language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'name', s.name, 'description', s.description, 'fee_kes', s.fee_kes,
    'mpesa_paybill', s.mpesa_paybill, 'mpesa_till', s.mpesa_till,
    'mpesa_account_reference', s.mpesa_account_reference,
    'payment_instructions', s.payment_instructions,
    'registration_open', s.registration_open, 'group_capacity', s.group_capacity,
    'max_groups', s.max_groups, 'start_date', s.start_date,
    'verified_count', (select count(*) from registrations where status='verified'),
    'total_capacity', s.group_capacity * s.max_groups,
    'groups', coalesce((select json_agg(json_build_object(
        'group_number', g.group_number, 'capacity', g.capacity, 'is_full', g.is_full,
        'players', coalesce((select json_agg(json_build_object('slot', r.slot_number, 'gamer_tag', r.gamer_tag, 'platform', r.platform) order by r.slot_number)
                     from registrations r where r.group_id = g.id and r.status='verified'), '[]'::json)
      ) order by g.group_number) from tournament_groups g), '[]'::json)
  ) from tournament_settings s where s.id = 1
$$;

-- Submit registration + payment proof (stays pending)
create or replace function public.submit_registration(
  _full_name text, _gamer_tag text, _phone text, _email text, _platform text, _game_mode text,
  _transaction_code text, _amount_kes int, _payer_phone text, _screenshot_path text
) returns json language plpgsql security definer set search_path = public as $$
declare s tournament_settings; ph text; pph text; code text; ref text; reg_id uuid;
begin
  select * into s from tournament_settings where id = 1;
  if not s.registration_open then raise exception 'Registration is currently closed.'; end if;
  if (select count(*) from registrations where status='verified') >= s.group_capacity * s.max_groups then
    raise exception 'All tournament slots are full. Please join the waitlist instead.';
  end if;
  if length(trim(coalesce(_full_name,''))) < 2 or length(_full_name) > 80 then raise exception 'Please enter your full name.'; end if;
  if trim(coalesce(_gamer_tag,'')) !~ '^[A-Za-z0-9_.\- ]{2,24}$' then raise exception 'Gamer tag must be 2-24 letters, numbers, spaces, _ . or -.'; end if;
  ph := normalize_ke_phone(_phone);
  if ph is null then raise exception 'Enter a valid Kenyan phone number (e.g. 0712 345 678).'; end if;
  pph := coalesce(normalize_ke_phone(_payer_phone), ph);
  if _email is not null and _email <> '' and _email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email looks invalid.'; end if;
  if _platform not in ('Mobile','PlayStation','Xbox','Other') then raise exception 'Choose a platform.'; end if;
  if length(trim(coalesce(_game_mode,''))) < 2 then raise exception 'Choose a game mode.'; end if;
  code := upper(trim(coalesce(_transaction_code,'')));
  if code !~ '^[A-Z0-9]{10}$' then raise exception 'M-Pesa transaction code must be 10 letters/numbers (e.g. SJK4XXXXXX).'; end if;
  if _amount_kes is null or _amount_kes <= 0 or _amount_kes > 100000 then raise exception 'Enter the amount you paid.'; end if;
  if exists (select 1 from registrations where phone = ph and status <> 'rejected') then raise exception 'This phone number already has an active registration. Check your status instead.'; end if;
  if exists (select 1 from registrations where lower(gamer_tag) = lower(trim(_gamer_tag)) and status <> 'rejected') then raise exception 'That gamer tag is already taken.'; end if;
  if exists (select 1 from payment_submissions where upper(transaction_code) = code and status <> 'rejected') then raise exception 'This transaction code has already been submitted.'; end if;
  if _screenshot_path is not null and _screenshot_path !~ '^proofs/[A-Za-z0-9\-]+\.(png|jpg|jpeg|webp)$' then raise exception 'Invalid screenshot.'; end if;

  ref := 'EFA-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into registrations (reference, gamer_tag, full_name, phone, email, platform, game_mode)
    values (ref, trim(_gamer_tag), trim(_full_name), ph, nullif(trim(_email),''), _platform, trim(_game_mode))
    returning id into reg_id;
  insert into payment_submissions (registration_id, payer_phone, transaction_code, amount_kes, expected_fee_kes, screenshot_path)
    values (reg_id, pph, code, _amount_kes, s.fee_kes, _screenshot_path);
  return json_build_object('reference', ref, 'status', 'pending');
exception when unique_violation then
  raise exception 'A matching registration or transaction code already exists.';
end $$;

-- Status lookup: reference + phone must match
create or replace function public.lookup_registration(_reference text, _phone text)
returns json language plpgsql stable security definer set search_path = public as $$
declare r registrations; g int; reason text;
begin
  select * into r from registrations where reference = upper(trim(_reference)) and phone = normalize_ke_phone(_phone);
  if not found then return null; end if;
  select group_number into g from tournament_groups where id = r.group_id;
  select a.reason into reason from verification_audit a where a.registration_id = r.id order by created_at desc limit 1;
  return json_build_object('reference', r.reference, 'gamer_tag', r.gamer_tag, 'status', r.status,
    'group_number', g, 'slot_number', r.slot_number, 'submitted_at', r.created_at, 'verified_at', r.verified_at,
    'reason', case when r.status = 'rejected' then reason else null end,
    'phone_hint', '•••• ' || right(r.phone, 3));
end $$;

create or replace function public.join_waitlist(_gamer_tag text, _phone text, _email text)
returns json language plpgsql security definer set search_path = public as $$
declare ph text := normalize_ke_phone(_phone);
begin
  if ph is null then raise exception 'Enter a valid Kenyan phone number.'; end if;
  if trim(coalesce(_gamer_tag,'')) !~ '^[A-Za-z0-9_.\- ]{2,24}$' then raise exception 'Enter a valid gamer tag.'; end if;
  insert into waitlist (gamer_tag, phone, email) values (trim(_gamer_tag), ph, nullif(trim(_email),''))
    on conflict (phone) do nothing;
  return json_build_object('ok', true);
end $$;

-- Core: atomic verification (admin) — designed so a future Daraja callback can call the same internal routine
create or replace function public._apply_verification(_registration_id uuid, _decision text, _reason text, _actor uuid, _actor_kind text)
returns json language plpgsql security definer set search_path = public as $$
declare s tournament_settings; r registrations; sub payment_submissions; grp tournament_groups; next_slot int; next_num int;
begin
  -- Serialize all verifications on the settings row
  select * into s from tournament_settings where id = 1 for update;
  select * into r from registrations where id = _registration_id for update;
  if not found then raise exception 'Registration not found.'; end if;
  if r.status <> 'pending' then raise exception 'Registration already %.', r.status; end if;
  select * into sub from payment_submissions where registration_id = r.id and status = 'pending' order by created_at desc limit 1 for update;

  if _decision = 'rejected' then
    if coalesce(trim(_reason),'') = '' then raise exception 'A rejection reason is required.'; end if;
    update registrations set status = 'rejected' where id = r.id;
    update payment_submissions set status = 'rejected' where id = sub.id;
    insert into verification_audit (registration_id, submission_id, actor_id, actor_kind, decision, reason, transaction_code, amount_kes)
      values (r.id, sub.id, _actor, _actor_kind, 'rejected', trim(_reason), sub.transaction_code, sub.amount_kes);
    return json_build_object('status','rejected');
  elsif _decision <> 'verified' then
    raise exception 'Invalid decision.';
  end if;

  if sub.id is null then raise exception 'No pending payment proof to verify.'; end if;

  select * into grp from tournament_groups g
    where g.verified_count < g.capacity order by g.group_number limit 1 for update;
  if not found then
    select coalesce(max(group_number),0) + 1 into next_num from tournament_groups;
    if next_num > s.max_groups then
      raise exception 'All % groups are full. Cannot confirm more players — increase max groups or reject.', s.max_groups;
    end if;
    insert into tournament_groups (group_number, capacity) values (next_num, s.group_capacity) returning * into grp;
  end if;

  select coalesce(max(slot_number),0) + 1 into next_slot from registrations where group_id = grp.id;
  update registrations set status='verified', group_id = grp.id, slot_number = next_slot, verified_at = now() where id = r.id;
  update tournament_groups set verified_count = verified_count + 1, is_full = (verified_count + 1 >= capacity) where id = grp.id;
  update payment_submissions set status='verified' where id = sub.id;
  insert into verification_audit (registration_id, submission_id, actor_id, actor_kind, decision, reason, transaction_code, amount_kes, group_number, slot_number)
    values (r.id, sub.id, _actor, _actor_kind, 'verified', nullif(trim(_reason),''), sub.transaction_code, sub.amount_kes, grp.group_number, next_slot);
  return json_build_object('status','verified','group_number', grp.group_number, 'slot_number', next_slot);
end $$;
revoke all on function public._apply_verification(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public._apply_verification(uuid, text, text, uuid, text) to service_role;

create or replace function public.admin_decide_registration(_registration_id uuid, _decision text, _reason text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  return public._apply_verification(_registration_id, _decision, _reason, auth.uid(), 'admin');
end $$;

create or replace function public.admin_update_settings(_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  update tournament_settings set
    name = coalesce(_patch->>'name', name),
    description = coalesce(_patch->>'description', description),
    fee_kes = coalesce((_patch->>'fee_kes')::int, fee_kes),
    mpesa_paybill = case when _patch ? 'mpesa_paybill' then nullif(_patch->>'mpesa_paybill','') else mpesa_paybill end,
    mpesa_till = case when _patch ? 'mpesa_till' then nullif(_patch->>'mpesa_till','') else mpesa_till end,
    mpesa_account_reference = case when _patch ? 'mpesa_account_reference' then nullif(_patch->>'mpesa_account_reference','') else mpesa_account_reference end,
    payment_instructions = case when _patch ? 'payment_instructions' then nullif(_patch->>'payment_instructions','') else payment_instructions end,
    start_date = case when _patch ? 'start_date' then nullif(_patch->>'start_date','') else start_date end,
    registration_open = coalesce((_patch->>'registration_open')::boolean, registration_open),
    group_capacity = coalesce((_patch->>'group_capacity')::int, group_capacity),
    max_groups = coalesce((_patch->>'max_groups')::int, max_groups),
    updated_at = now(), updated_by = auth.uid()
  where id = 1;
  -- Capacity change applies to groups not yet started
  update tournament_groups set capacity = (select group_capacity from tournament_settings where id=1)
    where verified_count = 0;
end $$;

revoke all on function public.submit_registration(text,text,text,text,text,text,text,int,text,text) from public;
grant execute on function public.get_public_tournament() to anon, authenticated;
grant execute on function public.submit_registration(text,text,text,text,text,text,text,int,text,text) to anon, authenticated;
grant execute on function public.lookup_registration(text, text) to anon, authenticated;
grant execute on function public.join_waitlist(text, text, text) to anon, authenticated;
grant execute on function public.admin_decide_registration(uuid, text, text) to authenticated;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
revoke execute on function public.admin_decide_registration(uuid, text, text) from anon;
revoke execute on function public.admin_update_settings(jsonb) from anon;

alter publication supabase_realtime add table public.tournament_groups;
