-- Team names may repeat; the eFootball username is what makes a player unique.
-- Status lookup: phone + (reference OR M-Pesa transaction code OR eFootball username).
drop index if exists public.registrations_active_team;

create or replace function public.submit_registration(
  _full_name text, _gamer_tag text, _efootball_id text, _team_name text, _phone text, _email text, _platform text, _game_mode text,
  _transaction_code text, _amount_kes int, _payer_phone text, _screenshot_path text
) returns json language plpgsql security definer set search_path = public as $$
declare s tournament_settings; ph text; pph text; code text; ref text; reg_id uuid; team text := nullif(trim(coalesce(_team_name,'')),''); eid text := nullif(trim(coalesce(_efootball_id,'')),'');
begin
  select * into s from tournament_settings where id = 1;
  if not s.registration_open then raise exception 'Registration is currently closed.'; end if;
  if (select count(*) from registrations where status='verified') >= s.group_capacity * s.max_groups then
    raise exception 'All tournament slots are full. Please join the waitlist instead.';
  end if;
  if length(trim(coalesce(_full_name,''))) < 2 or length(_full_name) > 80 then raise exception 'Please enter your full name.'; end if;
  if trim(coalesce(_gamer_tag,'')) !~ '^[A-Za-z0-9_.\- ]{2,24}$' then raise exception 'Gamer tag must be 2-24 letters, numbers, spaces, _ . or -.'; end if;
  if team is null then raise exception 'Enter your team name.'; end if;
  if eid is not null and eid !~ '^[A-Za-z0-9_.\-]{4,30}$' then raise exception 'eFootball user ID looks invalid.'; end if;
  if team !~ '^[A-Za-z0-9_.&'' \-]{2,30}$' then raise exception 'Team name must be 2-30 letters, numbers or spaces.'; end if;
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
  if exists (select 1 from registrations where lower(gamer_tag) = lower(trim(_gamer_tag)) and status <> 'rejected') then raise exception 'That eFootball username is already registered. Each username can only register once.'; end if;
  if eid is not null and exists (select 1 from registrations where lower(efootball_id) = lower(eid) and status <> 'rejected') then raise exception 'That eFootball user ID is already registered.'; end if;
  if exists (select 1 from payment_submissions where upper(transaction_code) = code and status <> 'rejected') then raise exception 'This transaction code has already been submitted.'; end if;
  if _screenshot_path is not null and _screenshot_path !~ '^proofs/[A-Za-z0-9\-]+\.(png|jpg|jpeg|webp)$' then raise exception 'Invalid screenshot.'; end if;

  ref := 'EFA-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into registrations (reference, gamer_tag, efootball_id, team_name, full_name, phone, email, platform, game_mode)
    values (ref, trim(_gamer_tag), eid, team, trim(_full_name), ph, nullif(trim(_email),''), _platform, trim(_game_mode))
    returning id into reg_id;
  insert into payment_submissions (registration_id, payer_phone, transaction_code, amount_kes, expected_fee_kes, screenshot_path)
    values (reg_id, pph, code, _amount_kes, s.fee_kes, _screenshot_path);
  return json_build_object('reference', ref, 'status', 'pending');
exception when unique_violation then
  raise exception 'A matching registration or transaction code already exists.';
end $$;

create or replace function public.find_registration(_ref text, _phone text)
returns public.registrations language plpgsql stable security definer set search_path = public as $$
declare r registrations; raw text := trim(coalesce(_ref,'')); k text := upper(regexp_replace(coalesce(_ref,''), '[\s]', '', 'g')); ph text := normalize_ke_phone(_phone);
begin
  if ph is null or k = '' then return null; end if;
  if k ~ '^EFA[0-9A-Z]{8}$' then k := 'EFA-' || substr(k, 4); end if;
  select r2.* into r from registrations r2
    where r2.phone = ph and (
      r2.reference = k
      or (k ~ '^[A-Z0-9]{8}$' and r2.reference = 'EFA-' || k)
      or lower(r2.gamer_tag) = lower(raw)
      or lower(r2.efootball_id) = lower(raw)
      or exists (select 1 from payment_submissions p where p.registration_id = r2.id and upper(p.transaction_code) = k)
    )
    order by r2.created_at desc limit 1;
  if not found then return null; end if;
  return r;
end $$;
revoke all on function public.find_registration(text, text) from public, anon, authenticated;
