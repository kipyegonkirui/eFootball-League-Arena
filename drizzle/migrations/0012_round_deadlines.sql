-- ROUND DEADLINES: the organiser sets the date each round must be played by. Players see it next to their fixtures.
-- One deadline per round per season (every group plays the same round on the same dates).
create table public.round_deadlines (
  season_id uuid not null references public.seasons(id) on delete cascade,
  round int not null check (round >= 1),
  due_at timestamptz not null,
  primary key (season_id, round)
);
grant all on public.round_deadlines to service_role;
alter table public.round_deadlines enable row level security;
-- No direct table access for the browser: everything goes through the two functions below.

-- Organiser: set every round's deadline from the first one. Round n is due (n - 1) * _days days after round 1.
-- Running it again replaces the previous deadlines for that season.
create or replace function public.admin_set_round_deadlines(_season int, _first_due timestamptz, _days int)
returns json language plpgsql security definer set search_path = public as $$
declare sea seasons; maxr int;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if _first_due is null then raise exception 'Choose the date and time round 1 is due.'; end if;
  if _days is null or _days < 1 or _days > 30 then raise exception 'Days between rounds must be from 1 to 30.'; end if;
  select * into sea from seasons where number = _season;
  if not found then raise exception 'Season not found.'; end if;
  if sea.status = 'completed' then raise exception 'This season has ended, so its deadlines can no longer be changed.'; end if;
  select max(f.round) into maxr from fixtures f join tournament_groups g on g.id = f.group_id where g.season_id = sea.id;
  if maxr is null then raise exception 'This season has no fixtures yet. Start the league first.'; end if;
  delete from round_deadlines where season_id = sea.id;
  insert into round_deadlines (season_id, round, due_at)
    select sea.id, r, _first_due + make_interval(days => (r - 1) * _days) from generate_series(1, maxr) r;
  return json_build_object('rounds', maxr, 'first_due', _first_due, 'last_due', _first_due + make_interval(days => (maxr - 1) * _days));
end $$;
revoke all on function public.admin_set_round_deadlines(int, timestamptz, int) from public, anon;
grant execute on function public.admin_set_round_deadlines(int, timestamptz, int) to authenticated;

-- Public: the deadlines for one season, as [{round, due_at}]. Empty until the organiser sets them.
create or replace function public.get_round_deadlines(_season int)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('round', d.round, 'due_at', d.due_at) order by d.round), '[]'::json)
  from round_deadlines d join seasons s on s.id = d.season_id where s.number = _season
$$;
grant execute on function public.get_round_deadlines(int) to anon, authenticated;
