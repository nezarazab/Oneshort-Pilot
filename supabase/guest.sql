-- OneShort: request a spot as a guest (name + phone number, no account).
-- Run in Supabase > SQL Editor AFTER accounts.sql. Safe to run more than once; changes no data.
--
-- Wraps the old request_spot() (which stays locked) and adds checks on the name, phone and level,
-- so a guest can only ever create a normal pending request. The returned token opens the
-- guest's status page (#/request/<id>/<token>), exactly like the old guest links.

create or replace function public.guest_request(
  p_game uuid, p_name text, p_phone text, p_level text, p_message text default null)
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
  return jsonb_build_object('id', r.id, 'token', r.player_token);
end $$;

revoke execute on function public.guest_request(uuid, text, text, text, text) from public;
grant execute on function public.guest_request(uuid, text, text, text, text) to anon, authenticated;
