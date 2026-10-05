-- OneShort pilot — results
-- Run in Supabase > SQL Editor any time to see how the pilot is going.

-- 1. Headline numbers (matches the success criteria table)
select
  (select count(*) from games where status = 'open')                                   as games_posted,
  (select count(distinct lower(host_contact)) from games)                              as different_hosts,
  (select count(*) from requests)                                                      as spot_requests,
  round(100.0 * (select count(*) from requests r join games g on g.id = r.game_id
                 where r.status = 'approved' and g.status = 'open' and g.starts_at < now())
        / nullif((select sum(spots_needed) from games where status = 'open'
                  and starts_at < now()), 0), 0)                                       as pct_spots_filled_past_games,
  round(100.0 * (select count(*) from requests
                 where decided_at is not null and decided_at - created_at <= interval '2 hours')
        / nullif((select count(*) from requests where decided_at is not null), 0), 0)  as pct_answered_within_2h,
  (select round(extract(epoch from percentile_cont(0.5) within group
          (order by decided_at - created_at)) / 60)
     from requests where decided_at is not null)                                       as median_minutes_to_answer,
  round(100.0 * (select count(*) from requests where attended)
        / nullif((select count(*) from requests where attended is not null), 0), 0)    as pct_showed_up,
  round(100.0 * (select count(*) from (
           select lower(player_contact) from requests where status = 'approved'
           group by 1 having count(*) >= 2) x)
        / nullif((select count(distinct lower(player_contact)) from requests
                  where status = 'approved'), 0), 0)                                   as pct_players_returning,
  (select count(*) from requests where status = 'withdrawn')                           as withdrawn_requests;

-- 2. Per game
select g.starts_at at time zone 'Europe/Amsterdam' as starts, g.sport, g.location, g.host_name,
       g.spots_needed,
       count(r.*) filter (where r.status = 'approved')  as approved,
       count(r.*) filter (where r.status = 'pending')   as pending,
       count(r.*) filter (where r.status = 'declined')  as declined,
       count(r.*) filter (where r.attended)             as showed_up,
       count(r.*) filter (where r.attended = false)     as no_shows
from games g left join requests r on r.game_id = g.id
group by g.id order by g.starts_at;
