-- OneShort pilot — database setup
-- Paste this whole file into Supabase > SQL Editor > New query, and press Run.
-- Safe to run once on a fresh project.

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists public.games (
  id               uuid primary key default gen_random_uuid(),
  sport            text not null check (char_length(sport) between 1 and 40),
  location         text not null check (char_length(location) between 1 and 120),
  starts_at        timestamptz not null,
  spots_needed     int  not null check (spots_needed between 1 and 30),
  level            text not null check (level in ('Beginner','Intermediate','Advanced','Any')),
  host_name        text not null check (char_length(host_name) between 1 and 60),
  host_contact     text not null check (char_length(host_contact) between 3 and 100),
  cost_per_player  text check (char_length(cost_per_player) <= 40),
  notes            text check (char_length(notes) <= 500),
  host_token       uuid not null default gen_random_uuid(),
  status           text not null default 'open' check (status in ('open','cancelled')),
  created_at       timestamptz not null default now()
);

create table if not exists public.requests (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references public.games(id) on delete cascade,
  player_name      text not null check (char_length(player_name) between 1 and 60),
  player_contact   text not null check (char_length(player_contact) between 3 and 100),
  level            text not null check (level in ('Beginner','Intermediate','Advanced')),
  message          text check (char_length(message) <= 300),
  player_token     uuid not null default gen_random_uuid(),
  status           text not null default 'pending'
                   check (status in ('pending','approved','declined','withdrawn')),
  attended         boolean,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);

create index if not exists requests_game_idx on public.requests(game_id);

-- Lock the tables: the website can ONLY use the functions below.
-- (Phone numbers and secret links are never readable directly.)
alter table public.games    enable row level security;
alter table public.requests enable row level security;
revoke all on public.games, public.requests from anon, authenticated;

-- ---------- Helper ----------

create or replace function public._filled(p_game uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from requests where game_id = p_game and status = 'approved';
$$;

-- ---------- Public: browse games ----------

create or replace function public.list_games()
returns table (id uuid, sport text, location text, starts_at timestamptz, spots_needed int,
               level text, host_name text, cost_per_player text, notes text, spots_filled int)
language sql stable security definer set search_path = public as $$
  select g.id, g.sport, g.location, g.starts_at, g.spots_needed, g.level, g.host_name,
         g.cost_per_player, g.notes, _filled(g.id)
  from games g
  where g.status = 'open' and g.starts_at > now() - interval '2 hours'
  order by g.starts_at;
$$;

create or replace function public.get_game(p_id uuid)
returns table (id uuid, sport text, location text, starts_at timestamptz, spots_needed int,
               level text, host_name text, cost_per_player text, notes text, spots_filled int,
               status text)
language sql stable security definer set search_path = public as $$
  select g.id, g.sport, g.location, g.starts_at, g.spots_needed, g.level, g.host_name,
         g.cost_per_player, g.notes, _filled(g.id), g.status
  from games g where g.id = p_id;
$$;

-- ---------- Host: post a game ----------

create or replace function public.create_game(
  p_sport text, p_location text, p_starts_at timestamptz, p_spots int, p_level text,
  p_host_name text, p_host_contact text, p_cost text default null, p_notes text default null)
returns table (id uuid, host_token uuid)
language plpgsql security definer set search_path = public as $$
begin
  if p_starts_at < now() then
    raise exception 'The game time must be in the future.';
  end if;
  return query
    insert into games (sport, location, starts_at, spots_needed, level, host_name,
                       host_contact, cost_per_player, notes)
    values (trim(p_sport), trim(p_location), p_starts_at, p_spots, p_level, trim(p_host_name),
            trim(p_host_contact), nullif(trim(p_cost), ''), nullif(trim(p_notes), ''))
    returning games.id, games.host_token;
end $$;

-- ---------- Player: request a spot ----------

create or replace function public.request_spot(
  p_game uuid, p_name text, p_contact text, p_level text, p_message text default null)
returns table (id uuid, player_token uuid)
language plpgsql security definer set search_path = public as $$
declare g games;
begin
  select * into g from games where games.id = p_game;
  if not found or g.status <> 'open' then
    raise exception 'This game is not available.';
  end if;
  if g.starts_at < now() then
    raise exception 'This game has already started.';
  end if;
  if _filled(p_game) >= g.spots_needed then
    raise exception 'Sorry, this game is already full.';
  end if;
  if exists (select 1 from requests r where r.game_id = p_game
             and lower(r.player_contact) = lower(trim(p_contact))
             and r.status in ('pending','approved')) then
    raise exception 'You already requested a spot in this game.';
  end if;
  return query
    insert into requests (game_id, player_name, player_contact, level, message)
    values (p_game, trim(p_name), trim(p_contact), p_level, nullif(trim(p_message), ''))
    returning requests.id, requests.player_token;
end $$;

create or replace function public.request_status(p_id uuid, p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r requests; g games;
begin
  select * into r from requests where requests.id = p_id and player_token = p_token;
  if not found then raise exception 'Request not found.'; end if;
  select * into g from games where games.id = r.game_id;
  return jsonb_build_object(
    'status', r.status, 'player_name', r.player_name, 'created_at', r.created_at,
    'decided_at', r.decided_at,
    'game', jsonb_build_object('id', g.id, 'sport', g.sport, 'location', g.location,
            'starts_at', g.starts_at, 'host_name', g.host_name, 'status', g.status,
            'cost_per_player', g.cost_per_player),
    -- host contact is only shared once the player is approved
    'host_contact', case when r.status = 'approved' then g.host_contact end);
end $$;

create or replace function public.withdraw_request(p_id uuid, p_token uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update requests set status = 'withdrawn'
  where id = p_id and player_token = p_token and status in ('pending','approved');
  if not found then raise exception 'Request not found or already closed.'; end if;
end $$;

-- ---------- Host: manage requests (needs the secret host link) ----------

create or replace function public.host_view(p_game uuid, p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g games;
begin
  select * into g from games where id = p_game and host_token = p_token;
  if not found then raise exception 'Invalid host link.'; end if;
  return jsonb_build_object(
    'game', jsonb_build_object('id', g.id, 'sport', g.sport, 'location', g.location,
            'starts_at', g.starts_at, 'spots_needed', g.spots_needed, 'level', g.level,
            'host_name', g.host_name, 'status', g.status, 'cost_per_player', g.cost_per_player,
            'notes', g.notes, 'spots_filled', _filled(g.id)),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'player_name', r.player_name, 'player_contact', r.player_contact,
               'level', r.level, 'message', r.message, 'status', r.status,
               'attended', r.attended, 'created_at', r.created_at, 'decided_at', r.decided_at)
             order by r.created_at)
      from requests r where r.game_id = g.id), '[]'::jsonb));
end $$;

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
    raise exception 'This request was withdrawn by the player.';
  end if;
  if p_decision = 'approved' and r.status <> 'approved'
     and _filled(g.id) >= g.spots_needed then
    raise exception 'The game is already full.';
  end if;
  update requests set status = p_decision,
         decided_at = coalesce(decided_at, now())   -- keep the FIRST response time
  where id = p_request;
end $$;

create or replace function public.host_mark_attendance(p_request uuid, p_token uuid, p_attended boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update requests r set attended = p_attended
  from games g
  where r.id = p_request and g.id = r.game_id and g.host_token = p_token
    and r.status = 'approved';
  if not found then raise exception 'Only approved players can be marked.'; end if;
end $$;

create or replace function public.host_cancel_game(p_game uuid, p_token uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update games set status = 'cancelled' where id = p_game and host_token = p_token;
  if not found then raise exception 'Invalid host link.'; end if;
end $$;

-- ---------- Permissions ----------

revoke execute on all functions in schema public from public;
grant execute on function
  public.list_games(), public.get_game(uuid),
  public.create_game(text,text,timestamptz,int,text,text,text,text,text),
  public.request_spot(uuid,text,text,text,text),
  public.request_status(uuid,uuid), public.withdraw_request(uuid,uuid),
  public.host_view(uuid,uuid), public.host_decide(uuid,uuid,text),
  public.host_mark_attendance(uuid,uuid,boolean), public.host_cancel_game(uuid,uuid)
to anon, authenticated;
