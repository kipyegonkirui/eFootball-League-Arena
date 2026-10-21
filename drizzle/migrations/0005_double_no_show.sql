-- Double no-show: a match recorded 0-0 with NO points for either player (a genuine 0-0 draw still gives 1 point each).
-- Recording a no-show requires a written reason; every record is logged in fixture_events.
alter table public.fixtures
  add column result_type text not null default 'played' check (result_type in ('played','no_show')),
  add column result_reason text,
  add constraint fixtures_no_show_shape check (result_type <> 'no_show' or (home_score = 0 and away_score = 0 and length(coalesce(result_reason,'')) >= 5));

drop function public.admin_record_result(uuid, int, int);
create or replace function public.admin_record_result(_fixture_id uuid, _home int, _away int, _result_type text default 'played', _reason text default null)
returns json language plpgsql security definer set search_path = public as $$
declare f fixtures; why text := nullif(trim(coalesce(_reason, '')), '');
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if _result_type not in ('played', 'no_show') then raise exception 'Unknown result type.'; end if;
  if _result_type = 'no_show' then
    if why is null or length(why) < 5 then raise exception 'Enter the reason for the no-show (at least 5 characters).'; end if;
    _home := 0; _away := 0;
  end if;
  if _home is null or _away is null or _home < 0 or _away < 0 or _home > 99 or _away > 99 then raise exception 'Enter valid scores (0-99).'; end if;
  select * into f from fixtures where id = _fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;
  if f.status = 'disputed' then raise exception 'This fixture is disputed. Resolve the dispute instead.'; end if;
  update fixtures set home_score = _home, away_score = _away, status = 'confirmed', result_type = _result_type, result_reason = why,
    recorded_by = auth.uid(), updated_at = now() where id = f.id;
  insert into fixture_events (fixture_id, actor_id, action, home_score, away_score, note)
    values (f.id, auth.uid(), case when _result_type = 'no_show' then 'no_show' when f.status = 'confirmed' then 'corrected' else 'recorded' end, _home, _away, why);
  return json_build_object('status', 'confirmed', 'result_type', _result_type);
end $$;
revoke execute on function public.admin_record_result(uuid, int, int, text, text) from public, anon;
grant execute on function public.admin_record_result(uuid, int, int, text, text) to authenticated;

create or replace function public.get_public_fixtures()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', f.id, 'group_number', g.group_number, 'round', f.round,
    'home_id', f.home_reg, 'away_id', f.away_reg,
    'home_score', f.home_score, 'away_score', f.away_score, 'status', f.status, 'result_type', f.result_type
  ) order by g.group_number, f.round, f.created_at), '[]'::json)
  from fixtures f join tournament_groups g on g.id = f.group_id
$$;

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
    recorded_by = auth.uid(), updated_at = now(), result_type = 'played', result_reason = null where id = f.id;
  update fixture_disputes set status = 'resolved', resolution = trim(_note), resolved_by = auth.uid(), resolved_at = now() where fixture_id = f.id and status = 'open';
  insert into fixture_events (fixture_id, actor_id, action, home_score, away_score, note) values (f.id, auth.uid(), case when _home is null then 'voided' else 'dispute_resolved' end, _home, _away, trim(_note));
  return json_build_object('status', case when _home is null then 'scheduled' else 'confirmed' end);
end $$;

create or replace function public.admin_league_overview()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  return json_build_object(
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
