# OneShort — project guide for Claude

OneShort is a pickup-sports website for Eindhoven: a **host** posts a game ("we need 2 players, Tuesday 19:00, Genneper Parken"), **players** request a spot, the host approves, and both get each other's contact (WhatsApp number or email). It's a Fontys Entrepreneurship-minor project currently running as a **pilot** (first target group: a ~300-member WhatsApp football group). Live at **https://oneshort.app**.

Team: Nezar (technical, owns this repo), Akam (planning), Abdulrahman (communication/outreach).

## Stack — keep it simple
- **Plain HTML + CSS + vanilla JavaScript. No build step, no framework, no npm.** Files are served as-is.
- **Supabase** (free tier): Postgres + Auth (email + password). The browser uses the public anon/publishable key.
- **Vercel** static hosting, auto-deploys on every push to `main`. Rollback: Vercel → Deployments → Promote an older one.
- **Maps:** Leaflet 1.9.4 + OpenStreetMap tiles + Nominatim search, loaded lazily from jsDelivr. No API keys.
- Libraries load from CDN: `@supabase/supabase-js@2` (in index.html), Leaflet (loaded by app.js on demand).

## Files
| File | What it is |
|---|---|
| `index.html` | Shell page. **The live repo's version differs from the original** (the demo banner was removed by hand). Don't assume it contains `#demo-banner`; JS must tolerate missing elements. |
| `config.js` | `SUPABASE_URL` + `SUPABASE_ANON_KEY`. Contains the real project values — never blank it out or overwrite it. Empty values = demo mode. |
| `app.js` | All app logic: hash router, views, Supabase calls, maps, accounts, admin. One IIFE. |
| `mock.js` | Demo backend that mimics every Supabase RPC + auth in localStorage (used when config is empty). **Keep it in sync with the SQL functions** when adding/changing RPCs. |
| `styles.css` | All styles. Design tokens at the top (`--ink #0E1A12`, `--lime #C6F432`, `--green #0B6E4F`). Mobile-first; min tap target ~44px. Later sections are appended overrides (accounts, maps, brand). |
| `assets/` | Brand: `logo.png` (full wordmark, transparent), `icon.png`, `favicon.png`, `apple-touch-icon.png`, `og-image.png`. |
| `supabase/*.sql` | Database migrations — see below. |
| `README.md` | Setup/deploy guide for the team (non-technical tone). |

## Database (Supabase)
Migrations are run **by hand in Supabase → SQL Editor, in this order**: `schema.sql` → `admin.sql` → `map.sql` → `accounts.sql`. All four are already applied to the live project. For any new change, **write a new additive migration file** (e.g. `supabase/notifications.sql`) that is safe on existing data; never edit-and-rerun old files (re-running `schema.sql` would overwrite newer function versions).

Security model:
- Tables (`games`, `requests`, `profiles`, `admin_settings`) have RLS on and **all direct access revoked**. The site only calls `SECURITY DEFINER` RPC functions with `set search_path = public` (add `, extensions` when using pgcrypto).
- Phone numbers / emails are never readable directly; contacts are only revealed after approval.
- When changing a function's return type you must `drop function` first, then re-grant execute.

Key RPCs (current versions live in the latest file that defines them):
- Public: `list_games()`, `get_game(id)` (also returns `is_host`, `my_request_id`, `my_request_status` for the logged-in viewer).
- Accounts (`accounts.sql`): `save_profile`, `my_profile`, `post_game`, `join_game`, `my_activity`.
- Host/player (owner = logged-in user **or** legacy secret token): `host_view`, `host_decide`, `host_mark_attendance`, `host_cancel_game`, `request_status`, `withdraw_request` — all take a `p_token` that is `null` for logged-in use.
- Admin (`admin.sql`, password hash in `admin_settings`): `admin_overview`, `admin_set_game`, `admin_set_request`. Admin page: `/#/admin`.
- Legacy guest functions `create_game` / `request_spot` still exist but execute is revoked (accounts are required now). Old secret links (`#/manage/<id>/<token>`, `#/request/<id>/<token>`) must keep working.
- Analytics: GA4 loads only when `GA_ID` is set in `config.js`; `track()` sends events (sign_up, game_posted, join_request_sent, request_accepted, request_declined, attendance_marked); `trackPage()` sends one clean page_view per route (no IDs/tokens, /admin not tracked). Never send names, emails or phone numbers to GA.
- Statuses: games `open|cancelled|removed`; requests `pending|approved|declined|withdrawn|removed`.
- Pilot metrics: `supabase/pilot_stats.sql` (games posted, distinct hosts, % filled, response time, show-up rate, returning players).

Supabase dashboard settings that matter: Auth → Email → **"Confirm email" is OFF** (free SMTP sends only a few emails/hour); Auth → URL Configuration → Site URL `https://oneshort.app`, redirect `https://oneshort.app/**` (password reset).

## App conventions
- Routes (hash): `#/` home (hero, your games, map, list) · `#/host` · `#/game/:id` · `#/request/:id[/:token]` · `#/manage/:id[/:token]` · `#/signup` · `#/login` · `#/forgot` · `#/reset` · `#/me` · `#/admin`.
- Hosting/joining requires an account: use `requireAccount(nextHash, reason)`; after login `goNext()` returns the user to where they were.
- The top-bar nav and the logo are rendered by JS (`renderNav()`, `brand()`), so they work regardless of the live `index.html`.
- **Always escape user content with `esc()`** before putting it in HTML.
- All RPC calls go through `rpc(name, params)` (switches between Supabase and mock). Auth goes through `authApi`.
- Times shown in `Europe/Amsterdam` via `fmtWhen()`.
- Copy/tone: short, plain English, friendly; audience is students 18–24.

## Testing
- Open `index.html` with an empty `config.js` → **demo mode** (banner shown, data in localStorage, admin password `admin`). Test full flows with two accounts: sign up → host → log out → second account joins → first approves.
- SQL changes: test on a local/throwaway Postgres or a separate Supabase project before running on the live one. Locally, stub `auth.users` and `auth.uid()`.
- Before pushing, run `node --check app.js mock.js`.

## Known limitations / next ideas
- No notifications (players and hosts must check their pages). Push or email notifications are the main reason to build a native app later (Expo).
- OpenStreetMap tiles + Nominatim are free community services — fine for the pilot, switch providers at scale.
- Anyone with an account can post; moderation is via the admin page.
- Pilot data should be deleted when the pilot ends (promised in the footer).
