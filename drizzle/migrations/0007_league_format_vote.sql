-- Players choose a league length when registering: 'one_week' (everyone plays everyone once, 7 rounds)
-- or 'two_week' (home and away, 14 rounds). Each group generates fixtures for the format most of ITS players chose.
-- Tie or no votes -> two_week. Fixtures can only be generated once per group; after that it is locked.
alter table public.registrations add column league_format text check (league_format in ('one_week','two_week'));
alter table public.tournament_groups add column league_format text check (league_format in ('one_week','two_week'));

drop function public.submit_registration(text,text,text,text,text,text,text,text,text,int,text,text);
create or replace function public.submit_registration(
  _full_name text, _gamer_tag text, _efootball_id text, _team_name text, _phone text, _email text, _platform text, _game_mode text,
  _transaction_code text, _amount_kes int, _payer_phone text, _screenshot_path text, _league_format text
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
  if _league_format is null or _league_format not in ('one_week','two_week') then raise exception 'Choose your preferred league length.'; end if;
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
  insert into registrations (reference, gamer_tag, efootball_id, team_name, full_name, phone, email, platform, game_mode, league_format)
    values (ref, trim(_gamer_tag), eid, team, trim(_full_name), ph, nullif(trim(_email),''), _platform, trim(_game_mode), _league_format)
    returning id into reg_id;
  insert into payment_submissions (registration_id, payer_phone, transaction_code, amount_kes, expected_fee_kes, screenshot_path)
    values (reg_id, pph, code, _amount_kes, s.fee_kes, _screenshot_path);
  return json_build_object('reference', ref, 'status', 'pending');
exception when unique_violation then
  raise exception 'A matching registration or transaction code already exists.';
end $$;

revoke all on function public.submit_registration(text,text,text,text,text,text,text,text,text,int,text,text,text) from public;
grant execute on function public.submit_registration(text,text,text,text,text,text,text,text,text,int,text,text,text) to anon, authenticated;

create or replace function public.admin_generate_fixtures()
returns json language plpgsql security definer set search_path = public as $$
declare g tournament_groups; ids uuid[]; n int; r int; i int; a uuid; b uuid; one_v int; two_v int; fmt text; made int; total int := 0; out json[] := '{}';
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  for g in select * from tournament_groups where is_full and not exists (select 1 from fixtures f where f.group_id = tournament_groups.id) order by group_number for update loop
    select array_agg(id order by slot_number), count(*) filter (where league_format = 'one_week'), count(*) filter (where league_format = 'two_week')
      into ids, one_v, two_v from registrations where group_id = g.id and status = 'verified';
    n := coalesce(array_length(ids, 1), 0);
    if n < 2 or n % 2 <> 0 then raise exception 'Group % needs an even number of players (has %).', g.group_number, n; end if;
    fmt := case when one_v > two_v then 'one_week' else 'two_week' end;
    made := 0;
    for r in 0 .. n - 2 loop
      for i in 0 .. n / 2 - 1 loop
        a := ids[i + 1]; b := ids[n - i];
        if (r + i) % 2 = 1 then
          insert into fixtures (group_id, round, home_reg, away_reg) values (g.id, r + 1, b, a);
          if fmt = 'two_week' then insert into fixtures (group_id, round, home_reg, away_reg) values (g.id, r + n, a, b); made := made + 1; end if;
        else
          insert into fixtures (group_id, round, home_reg, away_reg) values (g.id, r + 1, a, b);
          if fmt = 'two_week' then insert into fixtures (group_id, round, home_reg, away_reg) values (g.id, r + n, b, a); made := made + 1; end if;
        end if;
        made := made + 1;
      end loop;
      ids := ids[1:1] || ids[n:n] || ids[2:n - 1];
    end loop;
    update tournament_groups set league_format = fmt where id = g.id;
    total := total + made;
    out := out || json_build_object('group_number', g.group_number, 'format', fmt, 'one_week_votes', one_v, 'two_week_votes', two_v, 'fixtures', made)::json;
  end loop;
  if total = 0 then raise exception 'Fixtures are locked: every full group already has its fixtures, or no group is full yet.'; end if;
  return json_build_object('fixtures', total, 'groups', to_json(out));
end $$;

create or replace function public.get_public_tournament()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'name', s.name, 'description', s.description, 'fee_kes', s.fee_kes,
    'mpesa_paybill', s.mpesa_paybill, 'mpesa_till', s.mpesa_till,
    'mpesa_account_reference', s.mpesa_account_reference,
    'payment_instructions', s.payment_instructions,
    'registration_open', s.registration_open, 'group_capacity', s.group_capacity,
    'max_groups', s.max_groups, 'start_date', s.start_date,
    'verified_count', (select count(*) from registrations where status='verified'),
    'total_capacity', s.group_capacity * s.max_groups,
    'prize', public.prize_breakdown(),
    'groups', coalesce((select json_agg(json_build_object(
        'group_number', g.group_number, 'capacity', g.capacity, 'is_full', g.is_full, 'league_format', g.league_format,
        'players', coalesce((select json_agg(json_build_object('id', r.id, 'slot', r.slot_number, 'gamer_tag', r.gamer_tag, 'team_name', r.team_name, 'platform', r.platform) order by r.slot_number)
                     from registrations r where r.group_id = g.id and r.status='verified'), '[]'::json)
      ) order by g.group_number) from tournament_groups g), '[]'::json)
  ) from tournament_settings s where s.id = 1
$$;

create or replace function public.admin_league_overview()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  return json_build_object(
    'can_generate', exists (select 1 from tournament_groups g where g.is_full and not exists (select 1 from fixtures f where f.group_id = g.id)),
    'groups', coalesce((select json_agg(json_build_object(
        'group_number', g.group_number, 'is_full', g.is_full, 'league_format', g.league_format,
        'has_fixtures', exists (select 1 from fixtures f where f.group_id = g.id),
        'verified', (select count(*) from registrations r where r.group_id = g.id and r.status = 'verified'),
        'one_week_votes', (select count(*) from registrations r where r.group_id = g.id and r.status = 'verified' and r.league_format = 'one_week'),
        'two_week_votes', (select count(*) from registrations r where r.group_id = g.id and r.status = 'verified' and r.league_format = 'two_week')
      ) order by g.group_number) from tournament_groups g), '[]'::json),
    'fixtures', coalesce((select json_agg(json_build_object(
        'id', f.id, 'group_number', g.group_number, 'round', f.round,
        'home_tag', h.gamer_tag, 'away_tag', a.gamer_tag, 'home_score', f.home_score, 'away_score', f.away_score, 'status', f.status,
        'result_type', f.result_type, 'result_reason', f.result_reason
      ) order by g.group_number, f.round, f.created_at)
      from fixtures f join tournament_groups g on g.id = f.group_id
      join registrations h on h.id = f.home_reg join registrations a on a.id = f.away_reg), '[]'::json),
    'disputes', coalesce((select json_agg(json_build_object(
        'id', d.id, 'fixture_id', d.fixture_id, 'raised_by', rr.gamer_tag, 'note', d.note, 'created_at', d.created_at,
        'group_number', g.group_number, 'round', f.round, 'home_tag', h.gamer_tag, 'away_tag', a.gamer_tag,
        'home_score', f.home_score, 'away_score', f.away_score
      ) order by d.created_at)
      from fixture_disputes d join fixtures f on f.id = d.fixture_id join tournament_groups g on g.id = f.group_id
      join registrations h on h.id = f.home_reg join registrations a on a.id = f.away_reg join registrations rr on rr.id = d.registration_id
      where d.status = 'open'), '[]'::json)
  );
end $$;
