-- League layer: team names, prize settings, fixtures, results, disputes.
-- Layout: 32 players = 4 groups of 8. Home-and-away round robin inside each group (14 matches each).

alter table public.registrations add column team_name text;
create unique index registrations_active_team on public.registrations (lower(team_name)) where status <> 'rejected' and team_name is not null;

alter table public.tournament_settings
  add column prize_percent int not null default 70 check (prize_percent between 0 and 100),
  add column prize_first_pct int not null default 50 check (prize_first_pct between 0 and 100),
  add column prize_second_pct int not null default 30 check (prize_second_pct between 0 and 100),
  add column prize_third_pct int not null default 20 check (prize_third_pct between 0 and 100);

create table public.fixtures (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.tournament_groups(id) on delete cascade,
  round int not null check (round >= 1),
  home_reg uuid not null constraint fixtures_home_reg_fkey references public.registrations(id),
  away_reg uuid not null constraint fixtures_away_reg_fkey references public.registrations(id),
  home_score int check (home_score between 0 and 99),
  away_score int check (away_score between 0 and 99),
  status text not null default 'scheduled' check (status in ('scheduled','confirmed','disputed')),
  recorded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (home_reg <> away_reg),
  check ((home_score is null) = (away_score is null)),
  check (status <> 'confirmed' or home_score is not null),
  unique (group_id, home_reg, away_reg)
);
create index fixtures_group on public.fixtures (group_id, round);
grant select on public.fixtures to authenticated;
grant all on public.fixtures to service_role;
alter table public.fixtures enable row level security;
create policy "Admins read fixtures" on public.fixtures for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.fixture_disputes (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  registration_id uuid not null references public.registrations(id),
  note text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index fixture_disputes_one_open on public.fixture_disputes (fixture_id, registration_id) where status = 'open';
grant select on public.fixture_disputes to authenticated;
grant all on public.fixture_disputes to service_role;
alter table public.fixture_disputes enable row level security;
create policy "Admins read disputes" on public.fixture_disputes for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.fixture_events (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  actor_id uuid,
  action text not null,
  home_score int,
  away_score int,
  note text,
  created_at timestamptz not null default now()
);
grant select on public.fixture_events to authenticated;
grant all on public.fixture_events to service_role;
alter table public.fixture_events enable row level security;
create policy "Admins read fixture events" on public.fixture_events for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- Prize maths: pool = verified collections * prize_percent; 3rd place takes the rounding remainder.
create or replace function public.prize_breakdown()
returns json language sql stable security definer set search_path = public as $$
  with t as (
    select coalesce((select sum(amount_kes) from payment_submissions where status = 'verified'), 0)::int as collected, s.*
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

-- Public snapshot now carries team names and the prize pool (no personal data).
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
        'group_number', g.group_number, 'capacity', g.capacity, 'is_full', g.is_full,
        'players', coalesce((select json_agg(json_build_object('id', r.id, 'slot', r.slot_number, 'gamer_tag', r.gamer_tag, 'team_name', r.team_name, 'platform', r.platform) order by r.slot_number)
                     from registrations r where r.group_id = g.id and r.status='verified'), '[]'::json)
      ) order by g.group_number) from tournament_groups g), '[]'::json)
  ) from tournament_settings s where s.id = 1
$$;

-- Public fixtures + results (confirmed and disputed are visible; disputed is flagged and excluded from standings client-side).
create or replace function public.get_public_fixtures()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', f.id, 'group_number', g.group_number, 'round', f.round,
    'home_id', f.home_reg, 'away_id', f.away_reg,
    'home_score', f.home_score, 'away_score', f.away_score, 'status', f.status
  ) order by g.group_number, f.round, f.created_at), '[]'::json)
  from fixtures f join tournament_groups g on g.id = f.group_id
$$;

-- submit_registration: add optional team name (replaces the old signature)
drop function public.submit_registration(text,text,text,text,text,text,text,int,text,text);
create or replace function public.submit_registration(
  _full_name text, _gamer_tag text, _team_name text, _phone text, _email text, _platform text, _game_mode text,
  _transaction_code text, _amount_kes int, _payer_phone text, _screenshot_path text
) returns json language plpgsql security definer set search_path = public as $$
declare s tournament_settings; ph text; pph text; code text; ref text; reg_id uuid; team text := nullif(trim(coalesce(_team_name,'')),'');
begin
  select * into s from tournament_settings where id = 1;
  if not s.registration_open then raise exception 'Registration is currently closed.'; end if;
  if (select count(*) from registrations where status='verified') >= s.group_capacity * s.max_groups then
    raise exception 'All tournament slots are full. Please join the waitlist instead.';
  end if;
  if length(trim(coalesce(_full_name,''))) < 2 or length(_full_name) > 80 then raise exception 'Please enter your full name.'; end if;
  if trim(coalesce(_gamer_tag,'')) !~ '^[A-Za-z0-9_.\- ]{2,24}$' then raise exception 'Gamer tag must be 2-24 letters, numbers, spaces, _ . or -.'; end if;
  if team is not null and team !~ '^[A-Za-z0-9_.&'' \-]{2,30}$' then raise exception 'Team name must be 2-30 letters, numbers or spaces.'; end if;
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
  if team is not null and exists (select 1 from registrations where lower(team_name) = lower(team) and status <> 'rejected') then raise exception 'That team name is already taken.'; end if;
  if exists (select 1 from payment_submissions where upper(transaction_code) = code and status <> 'rejected') then raise exception 'This transaction code has already been submitted.'; end if;
  if _screenshot_path is not null and _screenshot_path !~ '^proofs/[A-Za-z0-9\-]+\.(png|jpg|jpeg|webp)$' then raise exception 'Invalid screenshot.'; end if;

  ref := 'EFA-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into registrations (reference, gamer_tag, team_name, full_name, phone, email, platform, game_mode)
    values (ref, trim(_gamer_tag), team, trim(_full_name), ph, nullif(trim(_email),''), _platform, trim(_game_mode))
    returning id into reg_id;
  insert into payment_submissions (registration_id, payer_phone, transaction_code, amount_kes, expected_fee_kes, screenshot_path)
    values (reg_id, pph, code, _amount_kes, s.fee_kes, _screenshot_path);
  return json_build_object('reference', ref, 'status', 'pending');
exception when unique_violation then
  raise exception 'A matching registration, team name or transaction code already exists.';
end $$;
revoke all on function public.submit_registration(text,text,text,text,text,text,text,text,int,text,text) from public;
grant execute on function public.submit_registration(text,text,text,text,text,text,text,text,int,text,text) to anon, authenticated;

-- Status lookup now also returns the player's own fixtures (reference + phone must still match)
create or replace function public.lookup_registration(_reference text, _phone text)
returns json language plpgsql stable security definer set search_path = public as $$
declare r registrations; g int; reason text; fx json;
begin
  select * into r from registrations where reference = upper(trim(_reference)) and phone = normalize_ke_phone(_phone);
  if not found then return null; end if;
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
    'phone_hint', '•••• ' || right(r.phone, 3), 'fixtures', fx);
end $$;

-- Settings: prize split fields (split must total 100)
create or replace function public.admin_update_settings(_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare s tournament_settings;
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
    prize_percent = coalesce((_patch->>'prize_percent')::int, prize_percent),
    prize_first_pct = coalesce((_patch->>'prize_first_pct')::int, prize_first_pct),
    prize_second_pct = coalesce((_patch->>'prize_second_pct')::int, prize_second_pct),
    prize_third_pct = coalesce((_patch->>'prize_third_pct')::int, prize_third_pct),
    updated_at = now(), updated_by = auth.uid()
  where id = 1 returning * into s;
  if s.prize_first_pct + s.prize_second_pct + s.prize_third_pct <> 100 then
    raise exception 'Prize split must add up to 100%% (currently %).', s.prize_first_pct + s.prize_second_pct + s.prize_third_pct;
  end if;
  update tournament_groups set capacity = s.group_capacity where verified_count = 0;
end $$;

-- Fixture generation: double round robin (circle method) for every FULL group that has none yet.
create or replace function public.admin_generate_fixtures()
returns json language plpgsql security definer set search_path = public as $$
declare g tournament_groups; ids uuid[]; n int; r int; i int; a uuid; b uuid; made int := 0; groups_done int := 0;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  for g in select * from tournament_groups where is_full and not exists (select 1 from fixtures f where f.group_id = tournament_groups.id) order by group_number for update loop
    select array_agg(id order by slot_number) into ids from registrations where group_id = g.id and status = 'verified';
    n := coalesce(array_length(ids, 1), 0);
    if n < 2 or n % 2 <> 0 then raise exception 'Group % needs an even number of players (has %).', g.group_number, n; end if;
    for r in 0 .. n - 2 loop
      for i in 0 .. n / 2 - 1 loop
        a := ids[i + 1]; b := ids[n - i];
        if (r + i) % 2 = 1 then
          insert into fixtures (group_id, round, home_reg, away_reg) values (g.id, r + 1, b, a);
          insert into fixtures (group_id, round, home_reg, away_reg) values (g.id, r + n, a, b);
        else
          insert into fixtures (group_id, round, home_reg, away_reg) values (g.id, r + 1, a, b);
          insert into fixtures (group_id, round, home_reg, away_reg) values (g.id, r + n, b, a);
        end if;
        made := made + 2;
      end loop;
      ids := ids[1:1] || ids[n:n] || ids[2:n - 1];
    end loop;
    groups_done := groups_done + 1;
  end loop;
  if groups_done = 0 then raise exception 'No full groups without fixtures. Fixtures are only generated once a group has all its players verified.'; end if;
  return json_build_object('groups', groups_done, 'fixtures', made);
end $$;

create or replace function public.admin_record_result(_fixture_id uuid, _home int, _away int)
returns json language plpgsql security definer set search_path = public as $$
declare f fixtures;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if _home is null or _away is null or _home < 0 or _away < 0 or _home > 99 or _away > 99 then raise exception 'Enter valid scores (0-99).'; end if;
  select * into f from fixtures where id = _fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;
  if f.status = 'disputed' then raise exception 'This fixture is disputed. Resolve the dispute instead.'; end if;
  update fixtures set home_score = _home, away_score = _away, status = 'confirmed', recorded_by = auth.uid(), updated_at = now() where id = f.id;
  insert into fixture_events (fixture_id, actor_id, action, home_score, away_score) values (f.id, auth.uid(), case when f.status = 'confirmed' then 'corrected' else 'recorded' end, _home, _away);
  return json_build_object('status', 'confirmed');
end $$;

create or replace function public.raise_dispute(_reference text, _phone text, _fixture_id uuid, _note text)
returns json language plpgsql security definer set search_path = public as $$
declare r registrations; f fixtures; n text := trim(coalesce(_note, ''));
begin
  select * into r from registrations where reference = upper(trim(_reference)) and phone = normalize_ke_phone(_phone) and status = 'verified';
  if not found then raise exception 'Registration not found.'; end if;
  select * into f from fixtures where id = _fixture_id for update;
  if not found or r.id not in (f.home_reg, f.away_reg) then raise exception 'That is not one of your fixtures.'; end if;
  if f.status = 'scheduled' then raise exception 'No result has been recorded for this match yet.'; end if;
  if length(n) < 5 or length(n) > 500 then raise exception 'Describe the problem (5-500 characters).'; end if;
  insert into fixture_disputes (fixture_id, registration_id, note) values (f.id, r.id, n);
  update fixtures set status = 'disputed', updated_at = now() where id = f.id;
  insert into fixture_events (fixture_id, action, home_score, away_score, note) values (f.id, 'disputed', f.home_score, f.away_score, n);
  return json_build_object('status', 'disputed');
exception when unique_violation then
  raise exception 'You already have an open dispute on this match.';
end $$;

-- Resolve: give final scores, or pass nulls to void the result and send the match back to "scheduled" for a replay.
create or replace function public.admin_resolve_dispute(_fixture_id uuid, _home int, _away int, _note text)
returns json language plpgsql security definer set search_path = public as $$
declare f fixtures;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if coalesce(trim(_note), '') = '' then raise exception 'A resolution note is required.'; end if;
  if (_home is null) <> (_away is null) then raise exception 'Enter both scores, or neither to void the result.'; end if;
  if _home is not null and (_home < 0 or _away < 0 or _home > 99 or _away > 99) then raise exception 'Enter valid scores (0-99).'; end if;
  select * into f from fixtures where id = _fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;
  if f.status <> 'disputed' then raise exception 'This fixture has no open dispute.'; end if;
  update fixtures set home_score = _home, away_score = _away, status = case when _home is null then 'scheduled' else 'confirmed' end,
    recorded_by = auth.uid(), updated_at = now() where id = f.id;
  update fixture_disputes set status = 'resolved', resolution = trim(_note), resolved_by = auth.uid(), resolved_at = now() where fixture_id = f.id and status = 'open';
  insert into fixture_events (fixture_id, actor_id, action, home_score, away_score, note) values (f.id, auth.uid(), case when _home is null then 'voided' else 'dispute_resolved' end, _home, _away, trim(_note));
  return json_build_object('status', case when _home is null then 'scheduled' else 'confirmed' end);
end $$;

-- Admin overview of fixtures and open disputes (tags, never phone numbers)
create or replace function public.admin_league_overview()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  return json_build_object(
    'fixtures', coalesce((select json_agg(json_build_object(
        'id', f.id, 'group_number', g.group_number, 'round', f.round,
        'home_tag', h.gamer_tag, 'away_tag', a.gamer_tag, 'home_score', f.home_score, 'away_score', f.away_score, 'status', f.status
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

grant execute on function public.get_public_fixtures() to anon, authenticated;
grant execute on function public.prize_breakdown() to anon, authenticated;
grant execute on function public.raise_dispute(text, text, uuid, text) to anon, authenticated;
grant execute on function public.admin_generate_fixtures() to authenticated;
grant execute on function public.admin_record_result(uuid, int, int) to authenticated;
grant execute on function public.admin_resolve_dispute(uuid, int, int, text) to authenticated;
grant execute on function public.admin_league_overview() to authenticated;
revoke execute on function public.admin_generate_fixtures() from anon;
revoke execute on function public.admin_record_result(uuid, int, int) from anon;
revoke execute on function public.admin_resolve_dispute(uuid, int, int, text) from anon;
revoke execute on function public.admin_league_overview() from anon;

alter publication supabase_realtime add table public.fixtures;
