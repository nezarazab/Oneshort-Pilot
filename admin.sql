-- OneShort pilot — ADMIN add-on
-- Run this in Supabase > SQL Editor AFTER schema.sql.
-- STEP 1: change the password on the last line of this file first! (use a long one)

-- Allow a "removed" status (removed by admin)
alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status in ('open','cancelled','removed'));
alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests add constraint requests_status_check
  check (status in ('pending','approved','declined','withdrawn','removed'));
alter table public.games add column if not exists removed_reason text;

-- Admin password (stored only as a hash)
create table if not exists public.admin_settings (
  id int primary key default 1 check (id = 1),
  password_hash text not null
);
alter table public.admin_settings enable row level security;
revoke all on public.admin_settings from anon, authenticated;

create or replace function public._is_admin(p_key text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from admin_settings
                 where p_key is not null and password_hash = crypt(p_key, password_hash));
$$;

-- Everything the admin sees: all games (also past/removed) with all requests
create or replace function public.admin_overview(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not _is_admin(p_key) then raise exception 'Wrong admin password.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'sport', g.sport, 'location', g.location, 'starts_at', g.starts_at,
      'spots_needed', g.spots_needed, 'level', g.level, 'host_name', g.host_name,
      'host_contact', g.host_contact, 'notes', g.notes, 'cost_per_player', g.cost_per_player,
      'status', g.status, 'removed_reason', g.removed_reason, 'created_at', g.created_at,
      'spots_filled', _filled(g.id),
      'requests', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'player_name', r.player_name, 'player_contact', r.player_contact,
          'level', r.level, 'message', r.message, 'status', r.status, 'attended', r.attended)
          order by r.created_at) from requests r where r.game_id = g.id), '[]'::jsonb))
      order by g.starts_at desc)
    from games g), '[]'::jsonb);
end $$;

create or replace function public.admin_set_game(p_key text, p_game uuid, p_remove boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not _is_admin(p_key) then raise exception 'Wrong admin password.'; end if;
  update games set status = case when p_remove then 'removed' else 'open' end,
                   removed_reason = case when p_remove then nullif(trim(p_reason), '') end
  where id = p_game;
end $$;

create or replace function public.admin_set_request(p_key text, p_request uuid, p_remove boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not _is_admin(p_key) then raise exception 'Wrong admin password.'; end if;
  update requests set status = case when p_remove then 'removed' else 'pending' end
  where id = p_request;
end $$;

revoke execute on function public._is_admin(text) from public, anon, authenticated;
grant execute on function public.admin_overview(text), public.admin_set_game(text,uuid,boolean,text),
  public.admin_set_request(text,uuid,boolean) to anon, authenticated;

-- Removed requests can't be approved or withdrawn by others
create or replace function public.host_decide(p_request uuid, p_token uuid, p_decision text)
returns void
language plpgsql security definer set search_path = public as $$
declare r requests; g games;
begin
  if p_decision not in ('approved','declined') then raise exception 'Invalid decision.'; end if;
  select * into r from requests where id = p_request;
  select * into g from games where id = r.game_id and host_token = p_token;
  if r.id is null or g.id is null then raise exception 'Invalid host link.'; end if;
  if r.status not in ('pending','approved','declined') then
    raise exception 'This request is no longer active.';
  end if;
  if p_decision = 'approved' and r.status <> 'approved'
     and _filled(g.id) >= g.spots_needed then
    raise exception 'The game is already full.';
  end if;
  update requests set status = p_decision, decided_at = coalesce(decided_at, now())
  where id = p_request;
end $$;

-- Hosts can't re-open a game the admin removed
create or replace function public.host_cancel_game(p_game uuid, p_token uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update games set status = 'cancelled'
  where id = p_game and host_token = p_token and status = 'open';
  if not found then raise exception 'This game can no longer be changed.'; end if;
end $$;

-- ===== SET YOUR ADMIN PASSWORD HERE (run again any time to change it) =====
insert into public.admin_settings (id, password_hash)
values (1, extensions.crypt('Nezaralaa123', extensions.gen_salt('bf')))
on conflict (id) do update set password_hash = excluded.password_hash;
