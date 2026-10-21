-- SEASONS: end one league and start the next.
-- A season is 'registration' (signing up), 'running' (fixtures generated) or 'completed' (archived, results locked).
-- Exactly one season is always open for registration. Starting a league turns it into 'running' and opens the next season.
-- Groups that are not full (and pending payments) carry over to the next season automatically.
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  number int not null unique,
  status text not null check (status in ('registration','running','completed')),
  started_at timestamptz,
  ended_at timestamptz,
  prize jsonb,
  created_at timestamptz not null default now()
);
create unique index seasons_one_registration on public.seasons (status) where status = 'registration';
grant select on public.seasons to anon, authenticated;
grant all on public.seasons to service_role;
alter table public.seasons enable row level security;
create policy "Anyone reads seasons" on public.seasons for select to anon, authenticated using (true);

alter table public.tournament_groups add column season_id uuid references public.seasons(id);
alter table public.registrations add column season_id uuid references public.seasons(id);

create or replace function public._carry_over(_old uuid, _new uuid)
returns json language plpgsql security definer set search_path = public as $$
declare gids uuid[]; pl int := 0; pend int := 0;
begin
  select array_agg(g.id order by g.group_number) into gids from tournament_groups g
    where g.season_id = _old and not exists (select 1 from fixtures f where f.group_id = g.id);
  if gids is not null then
    update tournament_groups g set season_id = _new, group_number = a.ord::int from unnest(gids) with ordinality as a(id, ord) where g.id = a.id;
    update registrations set season_id = _new where group_id = any(gids);
    select count(*) into pl from registrations where group_id = any(gids) and status = 'verified';
  end if;
  update registrations set season_id = _new where season_id = _old and status = 'pending' and group_id is null;
  get diagnostics pend = row_count;
  return json_build_object('groups', coalesce(array_length(gids, 1), 0), 'players', pl, 'pending', pend);
end $$;
revoke all on function public._carry_over(uuid, uuid) from public, anon, authenticated;

-- Backfill: everything that exists today is Season 1 (running if fixtures exist), with Season 2 open for sign-ups.
insert into public.seasons (number, status, started_at)
  select 1, case when exists (select 1 from public.fixtures) then 'running' else 'registration' end,
         (select min(created_at) from public.fixtures);
update public.tournament_groups set season_id = (select id from public.seasons where number = 1);
update public.registrations set season_id = (select id from public.seasons where number = 1);
alter table public.tournament_groups alter column season_id set not null;
alter table public.registrations alter column season_id set not null;
-- Group numbers are now unique per season (must happen before groups are moved between seasons).
alter table public.tournament_groups drop constraint if exists tournament_groups_group_number_key;
alter table public.tournament_groups add constraint tournament_groups_season_number unique (season_id, group_number);
insert into public.seasons (number, status) select 2, 'registration' where exists (select 1 from public.seasons where status = 'running');
select public._carry_over((select id from public.seasons where number = 1), (select id from public.seasons where number = 2))
  where exists (select 1 from public.seasons where number = 2);

-- Uniqueness is now per season, so last season's players can register again.
drop index if exists public.registrations_active_phone;
drop index if exists public.registrations_active_tag;
drop index if exists public.registrations_active_efootball_id;
create unique index registrations_active_phone on public.registrations (season_id, phone) where status <> 'rejected';
create unique index registrations_active_tag on public.registrations (season_id, lower(gamer_tag)) where status <> 'rejected';
create unique index registrations_active_efootball_id on public.registrations (season_id, lower(efootball_id)) where status <> 'rejected' and efootball_id is not null;

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

  if (select status from seasons where id = r.season_id) <> 'registration' then raise exception 'This registration belongs to a season that has already started.'; end if;
  select * into grp from tournament_groups g
    where g.season_id = r.season_id and g.verified_count < g.capacity order by g.group_number limit 1 for update;
  if not found then
    select coalesce(max(group_number),0) + 1 into next_num from tournament_groups where season_id = r.season_id;
    if next_num > s.max_groups then
      raise exception 'All % groups are full. Cannot confirm more players — increase max groups or reject.', s.max_groups;
    end if;
    insert into tournament_groups (season_id, group_number, capacity) values (r.season_id, next_num, s.group_capacity) returning * into grp;
  end if;

  select coalesce(max(slot_number),0) + 1 into next_slot from registrations where group_id = grp.id;
  update registrations set status='verified', group_id = grp.id, slot_number = next_slot, verified_at = now() where id = r.id;
  update tournament_groups set verified_count = verified_count + 1, is_full = (verified_count + 1 >= capacity) where id = grp.id;
  update payment_submissions set status='verified' where id = sub.id;
  insert into verification_audit (registration_id, submission_id, actor_id, actor_kind, decision, reason, transaction_code, amount_kes, group_number, slot_number)
    values (r.id, sub.id, _actor, _actor_kind, 'verified', nullif(trim(_reason),''), sub.transaction_code, sub.amount_kes, grp.group_number, next_slot);
  return json_build_object('status','verified','group_number', grp.group_number, 'slot_number', next_slot);
end $$;

create or replace function public.submit_registration(
  _full_name text, _gamer_tag text, _efootball_id text, _team_name text, _phone text, _email text, _platform text, _game_mode text,
  _transaction_code text, _amount_kes int, _payer_phone text, _screenshot_path text, _league_format text
) returns json language plpgsql security definer set search_path = public as $$
declare s tournament_settings; sea seasons; ph text; pph text; code text; ref text; reg_id uuid; team text := nullif(trim(coalesce(_team_name,'')),''); eid text := nullif(trim(coalesce(_efootball_id,'')),'');
begin
  select * into s from tournament_settings where id = 1;
  select * into sea from seasons where status = 'registration';
  if not found then raise exception 'Registration is not open yet. The next season is being prepared.'; end if;
  if not s.registration_open then raise exception 'Registration is currently closed.'; end if;
  if (select count(*) from registrations where status='verified' and season_id = sea.id) >= s.group_capacity * s.max_groups then
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
  if exists (select 1 from registrations where season_id = sea.id and phone = ph and status <> 'rejected') then raise exception 'This phone number already has an active registration. Check your status instead.'; end if;
  if exists (select 1 from registrations where season_id = sea.id and lower(gamer_tag) = lower(trim(_gamer_tag)) and status <> 'rejected') then raise exception 'That eFootball username is already registered. Each username can only register once.'; end if;
  if eid is not null and exists (select 1 from registrations where season_id = sea.id and lower(efootball_id) = lower(eid) and status <> 'rejected') then raise exception 'That eFootball user ID is already registered.'; end if;
  if exists (select 1 from payment_submissions where upper(transaction_code) = code and status <> 'rejected') then raise exception 'This transaction code has already been submitted.'; end if;
  if _screenshot_path is not null and _screenshot_path !~ '^proofs/[A-Za-z0-9\-]+\.(png|jpg|jpeg|webp)$' then raise exception 'Invalid screenshot.'; end if;

  ref := 'EFA-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into registrations (reference, gamer_tag, efootball_id, team_name, full_name, phone, email, platform, game_mode, league_format, season_id)
    values (ref, trim(_gamer_tag), eid, team, trim(_full_name), ph, nullif(trim(_email),''), _platform, trim(_game_mode), _league_format, sea.id)
    returning id into reg_id;
  insert into payment_submissions (registration_id, payer_phone, transaction_code, amount_kes, expected_fee_kes, screenshot_path)
    values (reg_id, pph, code, _amount_kes, s.fee_kes, _screenshot_path);
  return json_build_object('reference', ref, 'status', 'pending');
exception when unique_violation then
  raise exception 'A matching registration or transaction code already exists.';
end $$;

create or replace function public.lookup_registration(_reference text, _phone text)
returns json language plpgsql stable security definer set search_path = public as $$
declare r registrations; g int; reason text; fx json;
begin
  r := public.find_registration(_reference, _phone);
  if r.id is null then return null; end if;
  select group_number into g from tournament_groups where id = r.group_id;
  select a.reason into reason from verification_audit a where a.registration_id = r.id order by created_at desc limit 1;
  select coalesce(json_agg(json_build_object(
      'id', f.id, 'round', f.round, 'is_home', f.home_reg = r.id,
      'opponent', o.gamer_tag, 'opponent_team', o.team_name,
      'home_score', f.home_score, 'away_score', f.away_score, 'status', f.status,
      'my_dispute_open', exists (select 1 from fixture_disputes d where d.fixture_id = f.id and d.registration_id = r.id and d.status = 'open')
    ) order by f.round), '[]'::json) into fx
  from fixtures f join registrations o on o.id = case when f.home_reg = r.id then f.away_reg else f.home_reg end
  where r.id in (f.home_reg, f.away_reg);
  return json_build_object('reference', r.reference, 'gamer_tag', r.gamer_tag, 'team_name', r.team_name, 'status', r.status,
    'group_number', g, 'slot_number', r.slot_number, 'submitted_at', r.created_at, 'verified_at', r.verified_at,
    'reason', case when r.status = 'rejected' then reason else null end,
    'season_number', (select s.number from seasons s where s.id = r.season_id), 'season_status', (select s.status from seasons s where s.id = r.season_id),
    'phone_hint', '•••• ' || right(r.phone, 3), 'fixtures', fx);
end $$;


create or replace function public.verified_total()
returns int language sql stable security definer set search_path = public
as $$ select count(*)::int from public.registrations r join public.seasons s on s.id = r.season_id where r.status = 'verified' and s.status = 'registration' $$;

-- Prize pool per season (verified entry fees of that season's players)
drop function if exists public.prize_breakdown();
create or replace function public.prize_breakdown(_season uuid default null)
returns json language sql stable security definer set search_path = public as $$
  with sid as (select coalesce(_season, (select id from seasons where status = 'registration')) as id),
  t as (
    select coalesce((select sum(p.amount_kes) from payment_submissions p join registrations r on r.id = p.registration_id
                     where p.status = 'verified' and r.season_id = (select id from sid)), 0)::int as collected, s.*
    from tournament_settings s where s.id = 1
  ), p as (
    select t.*, floor(t.collected * t.prize_percent / 100.0)::int as pool from t
  )
  select json_build_object(
    'collected_kes', collected, 'prize_percent', prize_percent, 'prize_pool_kes', pool,
    'first_pct', prize_first_pct, 'second_pct', prize_second_pct, 'third_pct', prize_third_pct,
    'first_kes', floor(pool * prize_first_pct / 100.0)::int,
    'second_kes', floor(pool * prize_second_pct / 100.0)::int,
    'third_kes', pool - floor(pool * prize_first_pct / 100.0)::int - floor(pool * prize_second_pct / 100.0)::int
  ) from p
$$;

-- Home / Groups / Register show the season that is open for registration.
create or replace function public.get_public_tournament()
returns json language sql stable security definer set search_path = public as $$
  with sea as (select id, number from seasons where status = 'registration')
  select json_build_object(
    'name', s.name, 'description', s.description, 'fee_kes', s.fee_kes,
    'mpesa_paybill', s.mpesa_paybill, 'mpesa_till', s.mpesa_till,
    'mpesa_account_reference', s.mpesa_account_reference,
    'payment_instructions', s.payment_instructions,
    'registration_open', s.registration_open, 'group_capacity', s.group_capacity,
    'max_groups', s.max_groups, 'start_date', s.start_date,
    'season_number', (select number from sea),
    'verified_count', (select count(*) from registrations r where r.status = 'verified' and r.season_id = (select id from sea)),
    'total_capacity', s.group_capacity * s.max_groups,
    'prize', public.prize_breakdown((select id from sea)),
    'groups', coalesce((select json_agg(json_build_object(
        'group_number', g.group_number, 'capacity', g.capacity, 'is_full', g.is_full, 'league_format', g.league_format,
        'players', coalesce((select json_agg(json_build_object('id', r.id, 'slot', r.slot_number, 'gamer_tag', r.gamer_tag, 'team_name', r.team_name, 'platform', r.platform) order by r.slot_number)
                     from registrations r where r.group_id = g.id and r.status = 'verified'), '[]'::json)
      ) order by g.group_number) from tournament_groups g where g.season_id = (select id from sea)), '[]'::json)
  ) from tournament_settings s where s.id = 1
$$;

-- League page: any season's groups, fixtures and prize. Default = latest running, else latest completed, else the open one.
create or replace function public.get_public_league(_season int default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare sea seasons;
begin
  if _season is not null then
    select * into sea from seasons where number = _season;
  else
    select * into sea from seasons where status = 'running' order by number desc limit 1;
    if not found then select * into sea from seasons where status = 'completed' order by number desc limit 1; end if;
    if not found then select * into sea from seasons where status = 'registration' limit 1; end if;
  end if;
  if sea.id is null then return null; end if;
  return json_build_object(
    'seasons', coalesce((select json_agg(json_build_object('number', x.number, 'status', x.status, 'started_at', x.started_at, 'ended_at', x.ended_at) order by x.number desc) from seasons x where x.status <> 'registration'), '[]'::json),
    'season', json_build_object('number', sea.number, 'status', sea.status, 'started_at', sea.started_at, 'ended_at', sea.ended_at),
    'prize', case when sea.status = 'completed' and sea.prize is not null then sea.prize::json else public.prize_breakdown(sea.id) end,
    'groups', coalesce((select json_agg(json_build_object(
        'group_number', g.group_number, 'capacity', g.capacity, 'is_full', g.is_full, 'league_format', g.league_format,
        'players', coalesce((select json_agg(json_build_object('id', r.id, 'slot', r.slot_number, 'gamer_tag', r.gamer_tag, 'team_name', r.team_name, 'platform', r.platform) order by r.slot_number)
                     from registrations r where r.group_id = g.id and r.status = 'verified'), '[]'::json)
      ) order by g.group_number) from tournament_groups g where g.season_id = sea.id), '[]'::json),
    'fixtures', coalesce((select json_agg(json_build_object(
        'id', f.id, 'group_number', g.group_number, 'round', f.round, 'home_id', f.home_reg, 'away_id', f.away_reg,
        'home_score', f.home_score, 'away_score', f.away_score, 'status', f.status, 'result_type', f.result_type
      ) order by g.group_number, f.round, f.created_at) from fixtures f join tournament_groups g on g.id = f.group_id where g.season_id = sea.id), '[]'::json)
  );
end $$;
grant execute on function public.get_public_league(int) to anon, authenticated;

create or replace function public.admin_generate_fixtures()
returns json language plpgsql security definer set search_path = public as $$
declare sea seasons; nextsea seasons; carry json; g tournament_groups; ids uuid[]; n int; r int; i int; a uuid; b uuid; one_v int; two_v int; fmt text; made int; total int := 0; out json[] := '{}';
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  select * into sea from seasons where status = 'registration' for update;
  if not found then raise exception 'No season is open for registration.'; end if;
  for g in select * from tournament_groups where season_id = sea.id and is_full and not exists (select 1 from fixtures f where f.group_id = tournament_groups.id) order by group_number for update loop
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
  if total = 0 then raise exception 'No full group yet. A group needs all its players verified before the league can start.'; end if;
  update seasons set status = 'running', started_at = now() where id = sea.id;
  insert into seasons (number, status) values (sea.number + 1, 'registration') returning * into nextsea;
  carry := public._carry_over(sea.id, nextsea.id);
  return json_build_object('fixtures', total, 'groups', to_json(out), 'season', sea.number, 'next_season', nextsea.number, 'carried', carry);
end $$;


-- End a running season: every match must be finished. Freezes the prize pool and winners, then locks results.
create or replace function public.admin_end_season(_season int)
returns json language plpgsql security definer set search_path = public as $$
declare sea seasons; open_n int; pz json; winners json; snap jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  select * into sea from seasons where number = _season for update;
  if not found then raise exception 'Season not found.'; end if;
  if sea.status <> 'running' then raise exception 'Only a running season can be ended.'; end if;
  select count(*) into open_n from fixtures f join tournament_groups g on g.id = f.group_id where g.season_id = sea.id and f.status <> 'confirmed';
  if open_n > 0 then raise exception '% match(es) are not finished yet. Record every result (or mark a no-show) first.', open_n; end if;
  pz := public.prize_breakdown(sea.id);
  with fx as (
    select f.home_reg as h, f.away_reg as a, f.home_score as hs, f.away_score as aw
    from fixtures f join tournament_groups g on g.id = f.group_id
    where g.season_id = sea.id and f.status = 'confirmed' and f.result_type = 'played'
  ), side as (
    select h as reg, hs as gf, aw as ga from fx union all select a, aw, hs from fx
  ), agg as (
    select reg, sum(case when gf > ga then 3 when gf = ga then 1 else 0 end)::int as pts, sum(gf - ga)::int as gd, sum(gf)::int as gf from side group by reg
  ), ranked as (
    select r.gamer_tag, r.team_name, coalesce(a.pts, 0) as pts, coalesce(a.gd, 0) as gd, coalesce(a.gf, 0) as gf,
           row_number() over (order by coalesce(a.pts, 0) desc, coalesce(a.gd, 0) desc, coalesce(a.gf, 0) desc, r.gamer_tag) as place
    from registrations r join tournament_groups g on g.id = r.group_id and g.season_id = sea.id
    left join agg a on a.reg = r.id where r.status = 'verified'
  )
  select json_agg(json_build_object('place', place, 'gamer_tag', gamer_tag, 'team_name', team_name, 'points', pts, 'gd', gd, 'gf', gf,
           'prize_kes', case place when 1 then (pz->>'first_kes')::int when 2 then (pz->>'second_kes')::int else (pz->>'third_kes')::int end) order by place)
    into winners from ranked where place <= 3;
  snap := pz::jsonb || jsonb_build_object('winners', coalesce(winners, '[]'::json)::jsonb);
  update seasons set status = 'completed', ended_at = now(), prize = snap where id = sea.id;
  return json_build_object('season', sea.number, 'winners', winners, 'prize', snap);
end $$;
grant execute on function public.admin_end_season(int) to authenticated;
revoke execute on function public.admin_end_season(int) from anon;

-- Results of a completed season are locked.
create or replace function public._lock_completed_season()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from tournament_groups g join seasons s on s.id = g.season_id where g.id = old.group_id and s.status = 'completed') then
    raise exception 'This season has ended. Its results are locked.';
  end if;
  return new;
end $$;
create trigger fixtures_lock_completed before update on public.fixtures for each row execute function public._lock_completed_season();

-- Admin overview: next-season votes, all seasons with progress, and fixtures/disputes for the selected season.
drop function if exists public.admin_league_overview();
create or replace function public.admin_league_overview(_season int default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare sel seasons; reg seasons;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  select * into reg from seasons where status = 'registration';
  if _season is not null then select * into sel from seasons where number = _season;
  else
    select * into sel from seasons where status = 'running' order by number limit 1;
    if not found then select * into sel from seasons where status = 'completed' order by number desc limit 1; end if;
  end if;
  return json_build_object(
    'registration_season', reg.number,
    'can_generate', exists (select 1 from tournament_groups g where g.season_id = reg.id and g.is_full and not exists (select 1 from fixtures f where f.group_id = g.id)),
    'selected', sel.number,
    'groups', coalesce((select json_agg(json_build_object(
        'group_number', g.group_number, 'is_full', g.is_full, 'league_format', g.league_format,
        'has_fixtures', exists (select 1 from fixtures f where f.group_id = g.id),
        'verified', (select count(*) from registrations r where r.group_id = g.id and r.status = 'verified'),
        'capacity', g.capacity,
        'one_week_votes', (select count(*) from registrations r where r.group_id = g.id and r.status = 'verified' and r.league_format = 'one_week'),
        'two_week_votes', (select count(*) from registrations r where r.group_id = g.id and r.status = 'verified' and r.league_format = 'two_week')
      ) order by g.group_number) from tournament_groups g where g.season_id = reg.id), '[]'::json),
    'seasons', coalesce((select json_agg(json_build_object(
        'number', s.number, 'status', s.status, 'started_at', s.started_at, 'ended_at', s.ended_at, 'prize', s.prize,
        'fixtures_total', (select count(*) from fixtures f join tournament_groups g on g.id = f.group_id where g.season_id = s.id),
        'fixtures_done', (select count(*) from fixtures f join tournament_groups g on g.id = f.group_id where g.season_id = s.id and f.status = 'confirmed')
      ) order by s.number desc) from seasons s where s.status <> 'registration'), '[]'::json),
    'fixtures', coalesce((select json_agg(json_build_object(
        'id', f.id, 'group_number', g.group_number, 'round', f.round,
        'home_tag', h.gamer_tag, 'away_tag', a.gamer_tag, 'home_score', f.home_score, 'away_score', f.away_score, 'status', f.status,
        'result_type', f.result_type, 'result_reason', f.result_reason
      ) order by g.group_number, f.round, f.created_at)
      from fixtures f join tournament_groups g on g.id = f.group_id
      join registrations h on h.id = f.home_reg join registrations a on a.id = f.away_reg where g.season_id = sel.id), '[]'::json),
    'disputes', coalesce((select json_agg(json_build_object(
        'id', d.id, 'fixture_id', d.fixture_id, 'raised_by', rr.gamer_tag, 'note', d.note, 'created_at', d.created_at,
        'season', s.number, 'group_number', g.group_number, 'round', f.round, 'home_tag', h.gamer_tag, 'away_tag', a.gamer_tag,
        'home_score', f.home_score, 'away_score', f.away_score
      ) order by d.created_at)
      from fixture_disputes d join fixtures f on f.id = d.fixture_id join tournament_groups g on g.id = f.group_id join seasons s on s.id = g.season_id
      join registrations h on h.id = f.home_reg join registrations a on a.id = f.away_reg join registrations rr on rr.id = d.registration_id
      where d.status = 'open'), '[]'::json)
  );
end $$;
grant execute on function public.admin_league_overview(int) to authenticated;
revoke execute on function public.admin_league_overview(int) from anon;
