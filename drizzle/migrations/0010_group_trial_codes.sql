-- GROUP FREE TRIAL CODES: a code can be allowed for several players (max_uses, up to 50). Each player still has to be
-- different (one registration per phone and per username). Cancelling stops any remaining uses.
alter table public.free_trial_codes
  add column max_uses int not null default 1 check (max_uses between 1 and 50),
  add column uses int not null default 0;
update public.free_trial_codes set uses = 1 where used_at is not null;

create table public.free_trial_uses (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.free_trial_codes(id) on delete cascade,
  registration_id uuid not null references public.registrations(id),
  created_at timestamptz not null default now()
);
insert into public.free_trial_uses (code_id, registration_id) select id, used_by from public.free_trial_codes where used_by is not null;
grant select on public.free_trial_uses to authenticated;
grant all on public.free_trial_uses to service_role;
alter table public.free_trial_uses enable row level security;
create policy "Admins read trial uses" on public.free_trial_uses for select to authenticated using (public.has_role(auth.uid(), 'admin'));

drop function if exists public.admin_create_trial_codes(int, text, int);
create or replace function public.admin_create_trial_codes(_count int, _label text, _hours int, _max_uses int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare i int; c text; exp timestamptz; out json[] := '{}'; lab text := nullif(trim(coalesce(_label, '')), '');
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if _count is null or _count < 1 or _count > 50 then raise exception 'Create between 1 and 50 codes at a time.'; end if;
  if _hours is null or _hours < 1 or _hours > 720 then raise exception 'Choose an expiry between 1 hour and 30 days.'; end if;
  if _max_uses is null or _max_uses < 1 or _max_uses > 50 then raise exception 'A code can be used by 1 to 50 players.'; end if;
  if lab is not null and length(lab) > 60 then raise exception 'Label is too long (60 characters max).'; end if;
  exp := now() + make_interval(hours => _hours);
  for i in 1 .. _count loop
    loop
      c := 'FT' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      begin
        insert into free_trial_codes (code, label, expires_at, created_by, max_uses) values (c, lab, exp, auth.uid(), _max_uses);
        exit;
      exception when unique_violation then null;
      end;
    end loop;
    out := out || json_build_object('code', public._trial_code_display(c), 'expires_at', exp, 'max_uses', _max_uses)::json;
  end loop;
  return json_build_object('codes', to_json(out), 'expires_at', exp, 'max_uses', _max_uses);
end $$;
grant execute on function public.admin_create_trial_codes(int, text, int, int) to authenticated;
revoke execute on function public.admin_create_trial_codes(int, text, int, int) from anon;

create or replace function public.admin_list_trial_codes()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  return coalesce((select json_agg(json_build_object(
      'code', public._trial_code_display(t.code), 'label', t.label, 'max_uses', t.max_uses, 'uses', t.uses,
      'status', case when t.uses >= t.max_uses then 'used' when t.revoked_at is not null then 'cancelled' when t.expires_at <= now() then 'expired' else 'active' end,
      'expires_at', t.expires_at, 'created_at', t.created_at,
      'used_by', coalesce((select json_agg(r.gamer_tag order by u.created_at) from free_trial_uses u join registrations r on r.id = u.registration_id where u.code_id = t.id), '[]'::json)
    ) order by t.created_at desc, t.code) from (select * from free_trial_codes order by created_at desc limit 300) t), '[]'::json);
end $$;

create or replace function public.admin_revoke_trial_code(_code text)
returns json language plpgsql security definer set search_path = public as $$
declare k text := public._trial_code_key(_code); n int;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  update free_trial_codes set revoked_at = now() where code = k and uses < max_uses and revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That code is already fully used, cancelled or does not exist.'; end if;
  return json_build_object('status', 'cancelled');
end $$;

create or replace function public.submit_registration(
  _full_name text, _gamer_tag text, _efootball_id text, _team_name text, _phone text, _email text, _platform text, _game_mode text,
  _transaction_code text, _amount_kes int, _payer_phone text, _screenshot_path text, _league_format text
) returns json language plpgsql security definer set search_path = public as $$
declare s tournament_settings; sea seasons; tcode text; trial free_trial_codes; is_trial boolean := false; res json; ph text; pph text; code text; ref text; reg_id uuid; team text := nullif(trim(coalesce(_team_name,'')),''); eid text := nullif(trim(coalesce(_efootball_id,'')),'');
begin
  select * into s from tournament_settings where id = 1;
  select * into sea from seasons where status = 'registration';
  if not found then raise exception 'Registration is not open yet. The next season is being prepared.'; end if;
  if not s.registration_open then raise exception 'Registration is currently closed.'; end if;
  if (select count(*) from registrations where status='verified' and season_id = sea.id) >= s.group_capacity * s.max_groups then
    raise exception 'All tournament slots are full. Please join the waitlist instead.';
  end if;
  -- Free trial code: pasted into the M-Pesa code box. Valid codes confirm the player at KES 0.
  tcode := public._trial_code_key(_transaction_code);
  if length(tcode) = 14 and left(tcode, 2) = 'FT' then
    select * into trial from free_trial_codes where free_trial_codes.code = tcode for update;
    if found then
      if trial.revoked_at is not null then raise exception 'This free trial code has been cancelled.'; end if;
      if trial.uses >= trial.max_uses then raise exception '%', case when trial.max_uses = 1 then 'This free trial code has already been used.' else 'This free trial code has already been used by all ' || trial.max_uses || ' players.' end; end if;
      if trial.expires_at <= now() then raise exception 'This free trial code has expired.'; end if;
      is_trial := true;
    end if;
  end if;
  if length(trim(coalesce(_full_name,''))) < 2 or length(_full_name) > 80 then raise exception 'Please enter your full name.'; end if;
  if trim(coalesce(_gamer_tag,'')) !~ '^[A-Za-z0-9_.\- ]{2,24}$' then raise exception 'Gamer tag must be 2-24 letters, numbers, spaces, _ . or -.'; end if;
  if team is null then raise exception 'Enter your team name.'; end if;
  if _league_format is null or _league_format not in ('one_week','two_week') then raise exception 'Choose your preferred league length.'; end if;
  if eid is not null and eid !~ '^[A-Za-z0-9_.\-]{4,30}$' then raise exception 'eFootball user ID looks invalid.'; end if;
  if team !~ '^[A-Za-z0-9_.&'' \-]{2,30}$' then raise exception 'Team name must be 2-30 letters, numbers or spaces.'; end if;
  ph := normalize_ke_phone(_phone);
  if ph is null then raise exception 'Enter a valid Kenyan phone number (e.g. 0712 345 678).'; end if;
  pph := coalesce(normalize_ke_phone(_payer_phone), ph);
  if _email is not null and _email <> '' and _email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email looks invalid.'; end if;
  if _platform not in ('Mobile','PlayStation','Xbox','Other') then raise exception 'Choose a platform.'; end if;
  if length(trim(coalesce(_game_mode,''))) < 2 then raise exception 'Choose a game mode.'; end if;
  if is_trial then
    code := trial.code || '#' || (trial.uses + 1)::text;
  else
    code := upper(trim(coalesce(_transaction_code,'')));
    if code !~ '^[A-Z0-9]{10}$' then raise exception 'M-Pesa transaction code must be 10 letters/numbers (e.g. SJK4XXXXXX).'; end if;
    if _amount_kes is null or _amount_kes <= 0 or _amount_kes > 100000 then raise exception 'Enter the amount you paid.'; end if;
  end if;
  if exists (select 1 from registrations where season_id = sea.id and phone = ph and status <> 'rejected') then raise exception 'This phone number already has an active registration. Check your status instead.'; end if;
  if exists (select 1 from registrations where season_id = sea.id and lower(gamer_tag) = lower(trim(_gamer_tag)) and status <> 'rejected') then raise exception 'That eFootball username is already registered. Each username can only register once.'; end if;
  if eid is not null and exists (select 1 from registrations where season_id = sea.id and lower(efootball_id) = lower(eid) and status <> 'rejected') then raise exception 'That eFootball user ID is already registered.'; end if;
  if exists (select 1 from payment_submissions where upper(transaction_code) = code and status <> 'rejected') then raise exception 'This transaction code has already been submitted.'; end if;
  if _screenshot_path is not null and _screenshot_path !~ '^proofs/[A-Za-z0-9\-]+\.(png|jpg|jpeg|webp)$' then raise exception 'Invalid screenshot.'; end if;

  ref := 'EFA-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into registrations (reference, gamer_tag, efootball_id, team_name, full_name, phone, email, platform, game_mode, league_format, season_id)
    values (ref, trim(_gamer_tag), eid, team, trim(_full_name), ph, nullif(trim(_email),''), _platform, trim(_game_mode), _league_format, sea.id)
    returning id into reg_id;
  if is_trial then
    insert into payment_submissions (registration_id, payer_phone, transaction_code, amount_kes, expected_fee_kes, method)
      values (reg_id, ph, code, 0, s.fee_kes, 'free_trial');
    insert into free_trial_uses (code_id, registration_id) values (trial.id, reg_id);
    update free_trial_codes set uses = uses + 1, used_by = reg_id, used_at = case when uses + 1 >= max_uses then now() else used_at end where id = trial.id;
    res := public._apply_verification(reg_id, 'verified', 'Free trial code', null, 'free_trial');
    return json_build_object('reference', ref, 'status', 'verified', 'free_trial', true,
      'group_number', (res->>'group_number')::int, 'slot_number', (res->>'slot_number')::int);
  end if;
  insert into payment_submissions (registration_id, payer_phone, transaction_code, amount_kes, expected_fee_kes, screenshot_path)
    values (reg_id, pph, code, _amount_kes, s.fee_kes, _screenshot_path);
  return json_build_object('reference', ref, 'status', 'pending');
exception when unique_violation then
  raise exception 'A matching registration or transaction code already exists.';
end $$;
