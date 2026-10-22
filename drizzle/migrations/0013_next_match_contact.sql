-- NEXT MATCH CONTACT: lets a verified player message their next opponent on WhatsApp.
-- The opponent's phone number is released ONLY for the caller's next scheduled match in a running season, and only
-- after the caller proves who they are (their own reference / username + their own registration phone).
-- It is never part of the public data and is not returned by lookup_registration.
create or replace function public.get_next_match_contact(_reference text, _phone text)
returns json language plpgsql stable security definer set search_path = public as $$
declare r registrations; f fixtures; o registrations;
begin
  r := public.find_registration(_reference, _phone);
  if r.id is null or r.status <> 'verified' then return null; end if;

  select f2.* into f
    from fixtures f2
    join tournament_groups g on g.id = f2.group_id
    join seasons s on s.id = g.season_id
    where r.id in (f2.home_reg, f2.away_reg) and f2.status = 'scheduled' and s.status = 'running'
    order by f2.round, f2.created_at
    limit 1;
  if f.id is null then return null; end if;

  select * into o from registrations where id = case when f.home_reg = r.id then f.away_reg else f.home_reg end;
  if o.id is null or o.status <> 'verified' then return null; end if;

  return json_build_object('fixture_id', f.id, 'round', f.round, 'opponent', o.gamer_tag, 'phone', o.phone);
end $$;
revoke all on function public.get_next_match_contact(text, text) from public;
grant execute on function public.get_next_match_contact(text, text) to anon, authenticated;
