-- ANY MATCH CONTACT: lets a verified player message the opponent of ANY of their own matches still to play, so they
-- can play whichever opponent is ready first instead of waiting for the next round in order.
-- The number is released only for the caller's own scheduled fixture in a running season, after the caller proves who
-- they are (own reference / username + own registration phone). It is never public data.
create or replace function public.get_match_contact(_reference text, _phone text, _fixture_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare r registrations; f fixtures; o registrations;
begin
  r := public.find_registration(_reference, _phone);
  if r.id is null or r.status <> 'verified' then return null; end if;

  select f2.* into f
    from fixtures f2
    join tournament_groups g on g.id = f2.group_id
    join seasons s on s.id = g.season_id
    where f2.id = _fixture_id and r.id in (f2.home_reg, f2.away_reg) and f2.status = 'scheduled' and s.status = 'running';
  if f.id is null then return null; end if;

  select * into o from registrations where id = case when f.home_reg = r.id then f.away_reg else f.home_reg end;
  if o.id is null or o.status <> 'verified' then return null; end if;

  return json_build_object('fixture_id', f.id, 'round', f.round, 'opponent', o.gamer_tag, 'phone', o.phone);
end $$;
revoke all on function public.get_match_contact(text, text, uuid) from public;
grant execute on function public.get_match_contact(text, text, uuid) to anon, authenticated;
