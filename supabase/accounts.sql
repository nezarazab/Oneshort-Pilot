-- OneShort pilot — ACCOUNTS add-on (email + password login)
-- Run in Supabase > SQL Editor AFTER schema.sql, admin.sql and map.sql.
-- Existing games, requests and old host/player links keep working.
-- ALSO: Supabase > Authentication > Sign In / Providers > Email > turn OFF "Confirm email".

-- ---------- Profiles ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  phone       text check (char_length(phone) <= 30),
  fav_sport   text not null check (char_length(fav_sport) between 1 and 40),
  level       text not null check (level in ('Beginner','Intermediate','Advanced')),
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;

alter table public.games    add column if not exists host_id   uuid references public.profiles(id) on delete set null;
alter table public.requests add column if not exists player_id uuid references public.profiles(id) on delete set null;
create index if not exists games_host_idx      on public.games(host_id);
create index if not exists requests_player_idx on public.requests(player_id);

-- Contact shown to the other side: WhatsApp number if given, otherwise the login email
create or replace function public._contact(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(p.phone), ''), u.email)
  from profiles p join auth.users u on u.id = p.id where p.id = p_uid;
$$;

create or replace function public._me() returns profiles
language plpgsql stable security definer set search_path = public as $$
declare me profiles;
begin
  if auth.uid() is null then raise exception 'Please log in first.'; end if;
  select * into me from profiles where id = auth.uid();
  if not found then raise exception 'Please complete your profile first.'; end if;
  return me;
end $$;

-- ---------- Profile ----------
create or replace function public.save_profile(p_name text, p_phone text, p_sport text, p_level text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in first.'; end if;
  insert into profiles (id, name, phone, fav_sport, level)
  values (auth.uid(), trim(p_name), nullif(trim(p_phone), ''), trim(p_sport), p_level)
  on conflict (id) do update set name = excluded.name, phone = excluded.phone,
    fav_sport = excluded.fav_sport, level = excluded.level;
  -- keep contact details on the user's open games up to date
  update games set host_name = trim(p_name), host_contact = _contact(auth.uid())
  where host_id = auth.uid() and status = 'open' and starts_at > now();
  return my_profile();
end $$;

create or replace function public.my_profile()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'name', p.name, 'phone', p.phone, 'fav_sport', p.fav_sport, 'level', p.level,
    'email', u.email) end
  from auth.users u left join profiles p on p.id = u.id
  where u.id = auth.uid();
$$;

-- ---------- Post & join (logged in) ----------
create or replace function public.post_game(
  p_sport text, p_location text, p_starts_at timestamptz, p_spots int, p_level text,
  p_cost text default null, p_notes text default null,
  p_lat double precision default null, p_lng double precision default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare me profiles; new_id uuid;
begin
  me := _me();
  if p_starts_at < now() then raise exception 'The game time must be in the future.'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Invalid map location.'; end if;
  insert into games (sport, location, starts_at, spots_needed, level, host_name, host_contact,
                     cost_per_player, notes, lat, lng, host_id)
  values (trim(p_sport), trim(p_location), p_starts_at, p_spots, p_level, me.name,
          _contact(me.id), nullif(trim(p_cost), ''), nullif(trim(p_notes), ''), p_lat, p_lng, me.id)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.join_game(p_game uuid, p_level text, p_message text default null)
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
  insert into requests (game_id, player_name, player_contact, level, message, player_id)
  values (p_game, me.name, _contact(me.id), p_level, nullif(trim(p_message), ''), me.id)
  returning id into new_id;
  return new_id;
end $$;

-- Everything on "My account": games I host + my requests (upcoming and last 14 days)
create or replace function public.my_activity()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('hosting','[]'::jsonb,'requests','[]'::jsonb); end if;
  return jsonb_build_object(
    'hosting', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'sport', g.sport, 'location', g.location, 'starts_at', g.starts_at,
        'status', g.status, 'spots_needed', g.spots_needed, 'spots_filled', _filled(g.id),
        'pending', (select count(*) from requests r where r.game_id = g.id and r.status = 'pending'))
        order by g.starts_at)
      from games g where g.host_id = auth.uid() and g.starts_at > now() - interval '14 days'), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'status', r.status, 'sport', g.sport, 'location', g.location,
        'starts_at', g.starts_at, 'game_status', g.status) order by g.starts_at)
      from requests r join games g on g.id = r.game_id
      where r.player_id = auth.uid() and g.starts_at > now() - interval '14 days'), '[]'::jsonb));
end $$;

-- get_game now also tells the viewer if it's their game / their request
drop function if exists public.get_game(uuid);
create function public.get_game(p_id uuid)
returns table (id uuid, sport text, location text, starts_at timestamptz, spots_needed int,
               level text, host_name text, cost_per_player text, notes text, spots_filled int,
               status text, lat double precision, lng double precision,
               is_host boolean, my_request_id uuid, my_request_status text)
language sql stable security definer set search_path = public as $$
  select g.id, g.sport, g.location, g.starts_at, g.spots_needed, g.level, g.host_name,
         g.cost_per_player, g.notes, _filled(g.id), g.status, g.lat, g.lng,
         (auth.uid() is not null and g.host_id = auth.uid()),
         r.id, r.status
  from games g
  left join lateral (select rq.id, rq.status from requests rq
                     where rq.game_id = g.id and auth.uid() is not null and rq.player_id = auth.uid()
                     order by rq.created_at desc limit 1) r on true
  where g.id = p_id;
$$;

-- ---------- Host & player pages: secret link OR being logged in as the owner ----------
create or replace function public._owns_game(g games, p_token uuid) returns boolean
language sql stable as $$
  select (p_token is not null and g.host_token = p_token)
      or (g.host_id is not null and g.host_id = auth.uid());
$$;

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
            'notes', g.notes, 'spots_filled', _filled(g.id), 'lat', g.lat, 'lng', g.lng),
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
  select * into g from games where id = r.game_id;
  if r.id is null or g.id is null or not _owns_game(g, p_token) then
    raise exception 'You can only manage your own games.';
  end if;
  if r.status not in ('pending','approved','declined') then
    raise exception 'This request is no longer active.';
  end if;
  if p_decision = 'approved' and r.status <> 'approved' and _filled(g.id) >= g.spots_needed then
    raise exception 'The game is already full.';
  end if;
  update requests set status = p_decision, decided_at = coalesce(decided_at, now())
  where id = p_request;
end $$;

create or replace function public.host_mark_attendance(p_request uuid, p_token uuid, p_attended boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare r requests; g games;
begin
  select * into r from requests where id = p_request;
  select * into g from games where id = r.game_id;
  if r.id is null or g.id is null or not _owns_game(g, p_token) or r.status <> 'approved' then
    raise exception 'Only approved players can be marked.';
  end if;
  update requests set attended = p_attended where id = p_request;
end $$;

create or replace function public.host_cancel_game(p_game uuid, p_token uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare g games;
begin
  select * into g from games where id = p_game;
  if not found or not _owns_game(g, p_token) or g.status <> 'open' then
    raise exception 'This game can no longer be changed.';
  end if;
  update games set status = 'cancelled' where id = p_game;
end $$;

create or replace function public.request_status(p_id uuid, p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r requests; g games;
begin
  select * into r from requests where requests.id = p_id
    and ((p_token is not null and player_token = p_token)
         or (player_id is not null and player_id = auth.uid()));
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

create or replace function public.withdraw_request(p_id uuid, p_token uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update requests set status = 'withdrawn'
  where id = p_id and status in ('pending','approved')
    and ((p_token is not null and player_token = p_token)
         or (player_id is not null and player_id = auth.uid()));
  if not found then raise exception 'Request not found or already closed.'; end if;
end $$;

-- ---------- Permissions ----------
-- Accounts are now required: guests can no longer post or request.
revoke execute on function public.create_game(text,text,timestamptz,int,text,text,text,text,text,double precision,double precision) from public, anon, authenticated;
revoke execute on function public.request_spot(uuid,text,text,text,text) from public, anon, authenticated;
revoke execute on function public._contact(uuid), public._me() from public, anon, authenticated;

grant execute on function public.get_game(uuid) to anon, authenticated;
grant execute on function
  public.save_profile(text,text,text,text), public.my_profile(), public.my_activity(),
  public.post_game(text,text,timestamptz,int,text,text,text,double precision,double precision),
  public.join_game(uuid,text,text)
to authenticated;
