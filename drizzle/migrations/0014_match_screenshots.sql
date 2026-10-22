-- MATCH SCREENSHOTS: after a match each player uploads a screenshot of the full-time screen. The organiser compares
-- the two and records the score. Nothing is recorded automatically and no score is typed by players.
-- Screenshots live in a private bucket: only organisers can read them (via signed links).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('match-screenshots', 'match-screenshots', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

create policy "Anyone uploads match screenshots" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'match-screenshots' and name ~ '^shots/[A-Za-z0-9\-]+\.(png|jpg|jpeg|webp)$');
create policy "Admins read match screenshots" on storage.objects for select to authenticated
  using (bucket_id = 'match-screenshots' and public.has_role(auth.uid(), 'admin'));

create table public.match_screenshots (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  registration_id uuid not null references public.registrations(id),
  path text not null,
  created_at timestamptz not null default now(),
  unique (fixture_id, registration_id)
);
grant select on public.match_screenshots to authenticated;
grant all on public.match_screenshots to service_role;
alter table public.match_screenshots enable row level security;
create policy "Admins read match screenshots" on public.match_screenshots for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- Player: attach a screenshot to one of their own unconfirmed matches (uploading again replaces their earlier one).
create or replace function public.submit_match_screenshot(_reference text, _phone text, _fixture_id uuid, _path text)
returns json language plpgsql security definer set search_path = public as $$
declare r registrations; f fixtures;
begin
  r := public.find_registration(_reference, _phone);
  if r.id is null or r.status <> 'verified' then raise exception 'We could not find your registration. Check your details.'; end if;
  if _path is null or _path !~ '^shots/[A-Za-z0-9\-]+\.(png|jpg|jpeg|webp)$' then raise exception 'Invalid screenshot.'; end if;
  select f2.* into f from fixtures f2 where f2.id = _fixture_id and r.id in (f2.home_reg, f2.away_reg);
  if f.id is null then raise exception 'That match is not yours.'; end if;
  if f.status = 'confirmed' then raise exception 'This result has already been recorded.'; end if;
  if not exists (select 1 from tournament_groups g join seasons s on s.id = g.season_id where g.id = f.group_id and s.status = 'running') then
    raise exception 'This season is not running.';
  end if;
  insert into match_screenshots (fixture_id, registration_id, path) values (f.id, r.id, _path)
    on conflict (fixture_id, registration_id) do update set path = excluded.path, created_at = now();
  return json_build_object('ok', true);
end $$;
revoke all on function public.submit_match_screenshot(text, text, uuid, text) from public;
grant execute on function public.submit_match_screenshot(text, text, uuid, text) to anon, authenticated;

-- Player: which of my matches already have screenshots (mine / opponent's). The images themselves are never returned.
create or replace function public.my_match_screenshots(_reference text, _phone text)
returns json language plpgsql stable security definer set search_path = public as $$
declare r registrations;
begin
  r := public.find_registration(_reference, _phone);
  if r.id is null then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object('fixture_id', x.fixture_id, 'mine', x.mine, 'opponent', x.opp))
    from (
      select s.fixture_id, bool_or(s.registration_id = r.id) as mine, bool_or(s.registration_id <> r.id) as opp
      from match_screenshots s join fixtures f on f.id = s.fixture_id
      where r.id in (f.home_reg, f.away_reg)
      group by s.fixture_id
    ) x), '[]'::json);
end $$;
revoke all on function public.my_match_screenshots(text, text) from public;
grant execute on function public.my_match_screenshots(text, text) to anon, authenticated;

-- Organiser: every uploaded screenshot with the player's tag, newest first.
create or replace function public.admin_match_screenshots()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  return coalesce((
    select json_agg(json_build_object('fixture_id', s.fixture_id, 'gamer_tag', r.gamer_tag, 'path', s.path, 'created_at', s.created_at) order by s.created_at desc)
    from (select * from match_screenshots order by created_at desc limit 2000) s join registrations r on r.id = s.registration_id
  ), '[]'::json);
end $$;
revoke all on function public.admin_match_screenshots() from public, anon;
grant execute on function public.admin_match_screenshots() to authenticated;
