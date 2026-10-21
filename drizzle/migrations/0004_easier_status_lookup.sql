-- Forgiving status lookup: phone + (reference OR eFootball user ID).
-- References are matched ignoring case, spaces and a missing "EFA-" prefix.
create or replace function public.find_registration(_ref text, _phone text)
returns public.registrations language plpgsql stable security definer set search_path = public as $$
declare r registrations; k text := upper(regexp_replace(coalesce(_ref,''), '[\s]', '', 'g')); ph text := normalize_ke_phone(_phone);
begin
  if ph is null or k = '' then return null; end if;
  if k ~ '^[A-Z0-9]{8}$' then k := 'EFA-' || k; end if;
  if k ~ '^EFA[0-9A-Z]{8}$' then k := 'EFA-' || substr(k, 4); end if;
  select * into r from registrations
    where phone = ph and (reference = k or lower(efootball_id) = lower(trim(_ref)))
    order by created_at desc limit 1;
  if not found then return null; end if;
  return r;
end $$;
revoke all on function public.find_registration(text, text) from public, anon, authenticated;

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
    'phone_hint', '•••• ' || right(r.phone, 3), 'fixtures', fx);
end $$;

create or replace function public.raise_dispute(_reference text, _phone text, _fixture_id uuid, _note text)
returns json language plpgsql security definer set search_path = public as $$
declare r registrations; f fixtures; n text := trim(coalesce(_note, ''));
begin
  r := public.find_registration(_reference, _phone);
  if r.id is null or r.status <> 'verified' then raise exception 'Registration not found.'; end if;
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
