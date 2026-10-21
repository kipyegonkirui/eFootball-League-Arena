-- ADMIN REMOVE PLAYER: an organiser can take a confirmed player out of their slot (e.g. test players), with a reason.
-- The registration becomes 'rejected' (so the phone, username, eFootball ID and transaction code can be used again),
-- the slot and group counter are freed, the entry fee leaves the prize pool and the reason is kept in the audit log.
-- Only allowed while the season is still open for sign-ups: once fixtures exist, removing a player would break them.

-- Slots are now filled lowest-free-first. The old "highest + 1" rule would hand out slot 9 in a group of 8
-- after a player was removed from the middle of the group.
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

  select min(n) into next_slot from generate_series(1, grp.capacity) n
    where not exists (select 1 from registrations x where x.group_id = grp.id and x.slot_number = n);
  if next_slot is null then
    select coalesce(max(slot_number),0) + 1 into next_slot from registrations where group_id = grp.id;
  end if;
  update registrations set status='verified', group_id = grp.id, slot_number = next_slot, verified_at = now() where id = r.id;
  update tournament_groups set verified_count = verified_count + 1, is_full = (verified_count + 1 >= capacity) where id = grp.id;
  update payment_submissions set status='verified' where id = sub.id;
  insert into verification_audit (registration_id, submission_id, actor_id, actor_kind, decision, reason, transaction_code, amount_kes, group_number, slot_number)
    values (r.id, sub.id, _actor, _actor_kind, 'verified', nullif(trim(_reason),''), sub.transaction_code, sub.amount_kes, grp.group_number, next_slot);
  return json_build_object('status','verified','group_number', grp.group_number, 'slot_number', next_slot);
end $$;

create or replace function public.admin_remove_player(_registration_id uuid, _reason text)
returns json language plpgsql security definer set search_path = public as $$
declare r registrations; sub payment_submissions; grp tournament_groups; why text := trim(coalesce(_reason, ''));
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized.' using errcode = '42501'; end if;
  if length(why) < 3 then raise exception 'Enter a reason for removing this player.'; end if;
  if length(why) > 300 then raise exception 'The reason is too long (300 characters max).'; end if;

  -- Same lock order as verification: settings row first, so removals and confirmations never overlap.
  perform 1 from tournament_settings where id = 1 for update;
  select * into r from registrations where id = _registration_id for update;
  if not found then raise exception 'Registration not found.'; end if;
  if r.status <> 'verified' then raise exception 'Only confirmed players can be removed from a slot. Use Reject for pending payments.'; end if;
  if (select status from seasons where id = r.season_id) <> 'registration' then
    raise exception 'This season has already started, so players can no longer be removed.';
  end if;
  if exists (select 1 from fixtures f where f.group_id = r.group_id) then
    raise exception 'This group already has fixtures, so players can no longer be removed.';
  end if;

  select * into grp from tournament_groups where id = r.group_id for update;
  select * into sub from payment_submissions where registration_id = r.id and status = 'verified' order by created_at desc limit 1 for update;

  update registrations set status = 'rejected', group_id = null, slot_number = null where id = r.id;
  update payment_submissions set status = 'rejected' where registration_id = r.id and status = 'verified';
  update tournament_groups set verified_count = greatest(verified_count - 1, 0), is_full = false where id = grp.id;
  insert into verification_audit (registration_id, submission_id, actor_id, actor_kind, decision, reason, transaction_code, amount_kes, group_number, slot_number)
    values (r.id, sub.id, auth.uid(), 'admin', 'rejected', 'Removed by organiser: ' || why, sub.transaction_code, sub.amount_kes, grp.group_number, r.slot_number);
  return json_build_object('status', 'removed', 'group_number', grp.group_number, 'slot_number', r.slot_number);
end $$;
revoke all on function public.admin_remove_player(uuid, text) from public, anon;
grant execute on function public.admin_remove_player(uuid, text) to authenticated;
