-- OneShort pilot — MAP add-on (pin location on a map)
-- Run in Supabase > SQL Editor AFTER schema.sql and admin.sql.
-- Safe for existing data: old games keep working, they just have no pin.

alter table public.games add column if not exists lat double precision
  check (lat between -90 and 90);
alter table public.games add column if not exists lng double precision
  check (lng between -180 and 180);

-- list_games / get_game: now also return lat, lng
drop function if exists public.list_games();
create function public.list_games()
returns table (id uuid, sport text, location text, starts_at timestamptz, spots_needed int,
               level text, host_name text, cost_per_player text, notes text, spots_filled int,
               lat double precision, lng double precision)
language sql stable security definer set search_path = public as $$
  select g.id, g.sport, g.location, g.starts_at, g.spots_needed, g.level, g.host_name,
         g.cost_per_player, g.notes, _filled(g.id), g.lat, g.lng
  from games g
  where g.status = 'open' and g.starts_at > now() - interval '2 hours'
  order by g.starts_at;
$$;

drop function if exists public.get_game(uuid);
create function public.get_game(p_id uuid)
returns table (id uuid, sport text, location text, starts_at timestamptz, spots_needed int,
               level text, host_name text, cost_per_player text, notes text, spots_filled int,
               status text, lat double precision, lng double precision)
language sql stable security definer set search_path = public as $$
  select g.id, g.sport, g.location, g.starts_at, g.spots_needed, g.level, g.host_name,
         g.cost_per_player, g.notes, _filled(g.id), g.status, g.lat, g.lng
  from games g where g.id = p_id;
$$;

-- create_game: now accepts an optional pin (p_lat, p_lng)
drop function if exists public.create_game(text,text,timestamptz,int,text,text,text,text,text);
create function public.create_game(
  p_sport text, p_location text, p_starts_at timestamptz, p_spots int, p_level text,
  p_host_name text, p_host_contact text, p_cost text default null, p_notes text default null,
  p_lat double precision default null, p_lng double precision default null)
returns table (id uuid, host_token uuid)
language plpgsql security definer set search_path = public as $$
begin
  if p_starts_at < now() then
    raise exception 'The game time must be in the future.';
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'Invalid map location.';
  end if;
  return query
    insert into games (sport, location, starts_at, spots_needed, level, host_name,
                       host_contact, cost_per_player, notes, lat, lng)
    values (trim(p_sport), trim(p_location), p_starts_at, p_spots, p_level, trim(p_host_name),
            trim(p_host_contact), nullif(trim(p_cost), ''), nullif(trim(p_notes), ''), p_lat, p_lng)
    returning games.id, games.host_token;
end $$;

-- Player status page: include the pin
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
            'cost_per_player', g.cost_per_player, 'lat', g.lat, 'lng', g.lng),
    'host_contact', case when r.status = 'approved' then g.host_contact end);
end $$;

-- Host page: include the pin
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
            'notes', g.notes, 'spots_filled', _filled(g.id), 'lat', g.lat, 'lng', g.lng),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'player_name', r.player_name, 'player_contact', r.player_contact,
               'level', r.level, 'message', r.message, 'status', r.status,
               'attended', r.attended, 'created_at', r.created_at, 'decided_at', r.decided_at)
             order by r.created_at)
      from requests r where r.game_id = g.id), '[]'::jsonb));
end $$;

revoke execute on function public.list_games(), public.get_game(uuid),
  public.create_game(text,text,timestamptz,int,text,text,text,text,text,double precision,double precision)
  from public;
grant execute on function public.list_games(), public.get_game(uuid),
  public.create_game(text,text,timestamptz,int,text,text,text,text,text,double precision,double precision)
  to anon, authenticated;
