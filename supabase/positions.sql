-- OneShort: football positions. Hosts and players say where they play
-- (Goalkeeper, Defender, Midfielder, Attacker or Any position).
-- Run in Supabase > SQL Editor AFTER accounts.sql and guest.sql. Safe to run more than once.
-- Existing games and requests are kept; they simply have no position.
--
-- The functions below keep working for the current website (the new p_position argument is
-- optional), so run this file first and deploy the website change after it.

begin;

alter table public.games    add column if not exists host_position text;
alter table public.requests add column if not exists position text;

do $$ begin
  alter table public.games add constraint games_host_position_check
    check (host_position in ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker', 'Any position'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.requests add constraint requests_position_check
    check (position in ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker', 'Any position'));
exception when duplicate_object then null; end $$;

-- post_game: + p_position (the host's own position)
drop function if exists public.post_game(text,text,timestamptz,int,text,text,text,double precision,double precision);
create function public.post_game(
  p_sport text, p_location text, p_starts_at timestamptz, p_spots int, p_level text,
  p_cost text default null, p_notes text default null,
  p_lat double precision default null, p_lng double precision default null,
  p_position text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me profiles; new_id uuid;
begin
  me := _me();
  if p_starts_at < now() then raise exception 'The game time must be in the future.'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Invalid map location.'; end if;
  insert into games (sport, location, starts_at, spots_needed, level, host_name, host_contact,
                     cost_per_player, notes, lat, lng, host_id, host_position)
  values (trim(p_sport), trim(p_location), p_starts_at, p_spots, p_level, me.name,
          _contact(me.id), nullif(trim(p_cost), ''), nullif(trim(p_notes), ''), p_lat, p_lng, me.id,
          nullif(trim(p_position), ''))
  returning id into new_id;
  return new_id;
end $$;

-- join_game: + p_position
drop function if exists public.join_game(uuid,text,text);
create function public.join_game(p_game uuid, p_level text, p_message text default null, p_position text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me profiles; g games; new_id uuid;
begin
  me := _me();
  select * into g from games where id = p_game;
  if not found or g.status <> 'open' then raise exception 'This game is not available.'; end if;
  if g.host_id = me.id then raise exception 'This is your own game.'; end if;
  if g.starts_at < now() then raise exception 'This game has already started.'; end if;
  if _filled(p_game) >= g.spots_needed then raise exception 'Sorry, this game is already full.'; end if;
  if exists (select 1 from requests where game_id = p_game and player_id = me.id
             and status in ('pending','approved')) then
    raise exception 'You already requested a spot in this game.';
  end if;
  insert into requests (game_id, player_name, player_contact, level, message, player_id, position)
  values (p_game, me.name, _contact(me.id), p_level, nullif(trim(p_message), ''), me.id, nullif(trim(p_position), ''))
  returning id into new_id;
  return new_id;
end $$;

-- guest_request: + p_position
drop function if exists public.guest_request(uuid,text,text,text,text);
create function public.guest_request(
  p_game uuid, p_name text, p_phone text, p_level text, p_message text default null, p_position text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  phone  text := trim(coalesce(p_phone, ''));
  digits text := regexp_replace(phone, '[^0-9]', '', 'g');
  r record;
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Please enter your name.';
  end if;
  if char_length(digits) not between 9 and 15 or phone !~ '^\+?[0-9 ()-]+$' then
    raise exception 'Please enter a valid phone number.';
  end if;
  if coalesce(p_level, '') not in ('Beginner', 'Intermediate', 'Advanced') then
    raise exception 'Pick your level.';
  end if;
  select * into r from request_spot(p_game, p_name, phone, p_level, p_message);
  update requests set position = nullif(trim(p_position), '') where id = r.id;
  return jsonb_build_object('id', r.id, 'token', r.player_token);
end $$;

-- list_games / get_game: also return host_position
drop function if exists public.list_games();
create function public.list_games()
returns table (id uuid, sport text, location text, starts_at timestamptz, spots_needed int,
               level text, host_name text, cost_per_player text, notes text, spots_filled int,
               lat double precision, lng double precision, host_position text)
language sql stable security definer set search_path = public as $$
  select g.id, g.sport, g.location, g.starts_at, g.spots_needed, g.level, g.host_name,
         g.cost_per_player, g.notes, _filled(g.id), g.lat, g.lng, g.host_position
  from games g
  where g.status = 'open' and g.starts_at > now() - interval '2 hours'
  order by g.starts_at;
$$;

drop function if exists public.get_game(uuid);
create function public.get_game(p_id uuid)
returns table (id uuid, sport text, location text, starts_at timestamptz, spots_needed int,
               level text, host_name text, cost_per_player text, notes text, spots_filled int,
               status text, lat double precision, lng double precision,
               is_host boolean, my_request_id uuid, my_request_status text, host_position text)
language sql stable security definer set search_path = public as $$
  select g.id, g.sport, g.location, g.starts_at, g.spots_needed, g.level, g.host_name,
         g.cost_per_player, g.notes, _filled(g.id), g.status, g.lat, g.lng,
         (auth.uid() is not null and g.host_id = auth.uid()),
         r.id, r.status, g.host_position
  from games g
  left join lateral (select rq.id, rq.status from requests rq
                     where rq.game_id = g.id and auth.uid() is not null and rq.player_id = auth.uid()
                     order by rq.created_at desc limit 1) r on true
  where g.id = p_id;
$$;

-- host_view: the host sees each player's position
create or replace function public.host_view(p_game uuid, p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g games;
begin
  select * into g from games where id = p_game;
  if not found or not _owns_game(g, p_token) then raise exception 'You can only manage your own games.'; end if;
  return jsonb_build_object(
    'game', jsonb_build_object('id', g.id, 'sport', g.sport, 'location', g.location,
            'starts_at', g.starts_at, 'spots_needed', g.spots_needed, 'level', g.level,
            'host_name', g.host_name, 'status', g.status, 'cost_per_player', g.cost_per_player,
            'notes', g.notes, 'spots_filled', _filled(g.id), 'lat', g.lat, 'lng', g.lng,
            'host_position', g.host_position),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'player_name', r.player_name, 'player_contact', r.player_contact,
               'level', r.level, 'position', r.position, 'message', r.message, 'status', r.status,
               'attended', r.attended, 'created_at', r.created_at, 'decided_at', r.decided_at)
             order by r.created_at)
      from requests r where r.game_id = g.id), '[]'::jsonb));
end $$;

revoke execute on function public.post_game(text,text,timestamptz,int,text,text,text,double precision,double precision,text),
  public.join_game(uuid,text,text,text), public.guest_request(uuid,text,text,text,text,text),
  public.list_games(), public.get_game(uuid) from public;
grant execute on function public.list_games(), public.get_game(uuid),
  public.guest_request(uuid,text,text,text,text,text) to anon, authenticated;
grant execute on function public.post_game(text,text,timestamptz,int,text,text,text,double precision,double precision,text),
  public.join_game(uuid,text,text,text) to authenticated;

commit;

notify pgrst, 'reload schema';
