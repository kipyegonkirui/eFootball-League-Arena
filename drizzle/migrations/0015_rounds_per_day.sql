-- ROUNDS PER DAY: the organiser sets how many rounds share each daily deadline, instead of the days between rounds.
-- Example: first deadline 06:00 tomorrow with 7 rounds per day means rounds 1-7 are all due at that 06:00 (a 6am-to-6am
-- window), and for a 14-round league rounds 8-14 are due at 06:00 the following day. 1 round per day behaves as before.
drop function if exists public.admin_set_round_deadlines(int, timestamptz, int);
create or replace function public.admin_set_round_deadlines(_season int, _first_due timestamptz, _rounds_per_day int)
returns json language plpgsql security definer set search_path = public as $$
declare sea seasons; maxr int;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if _first_due is null then raise exception 'Choose the date and time the first deadline falls.'; end if;
  if _rounds_per_day is null or _rounds_per_day < 1 or _rounds_per_day > 30 then raise exception 'Rounds per day must be from 1 to 30.'; end if;
  select * into sea from seasons where number = _season;
  if not found then raise exception 'Season not found.'; end if;
  if sea.status = 'completed' then raise exception 'This season has ended, so its deadlines can no longer be changed.'; end if;
  select max(f.round) into maxr from fixtures f join tournament_groups g on g.id = f.group_id where g.season_id = sea.id;
  if maxr is null then raise exception 'This season has no fixtures yet. Start the league first.'; end if;
  delete from round_deadlines where season_id = sea.id;
  insert into round_deadlines (season_id, round, due_at)
    select sea.id, r, _first_due + make_interval(days => (r - 1) / _rounds_per_day) from generate_series(1, maxr) r;
  return json_build_object('rounds', maxr, 'first_due', _first_due, 'last_due', _first_due + make_interval(days => (maxr - 1) / _rounds_per_day));
end $$;
revoke all on function public.admin_set_round_deadlines(int, timestamptz, int) from public, anon;
grant execute on function public.admin_set_round_deadlines(int, timestamptz, int) to authenticated;
