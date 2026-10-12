# OneShort pilot website — setup guide

A simple site for the pilot: hosts post a game, players request a spot, the host approves, and both sides get each other's contact. No accounts needed.

Open `index.html` locally to try it in **demo mode** (data is saved only in your browser).

## 1. Database (Supabase, free) — ~10 min

1. Go to supabase.com → sign up → **New project** (region: Europe / Frankfurt). Save the database password somewhere.
2. In the project: **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**. It should say "Success".
3. Go to **Project Settings → API** (or the **Connect** button) and copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **anon / publishable key**
4. Paste both into `config.js`. This key is meant to be public; the database only allows the site's own actions, and phone numbers and host links can't be read directly.

## 2. Put it online (Vercel, free) — ~10 min

1. Create a GitHub account → **New repository** (e.g. `oneshort-pilot`) → **uploading an existing file** → drag in all files from this folder (including the `supabase` folder) → **Commit**.
2. Go to vercel.com → sign in with GitHub → **Add New → Project** → import the repo → **Deploy** (no settings needed; it's a static site).
3. You'll get a link like `oneshort-pilot.vercel.app`. Test it on your phone.

Alternative with no GitHub: app.netlify.com/drop → drag the folder in.

## 3. Connect your domain — ~5 min (+ up to a few hours to take effect)

1. In Vercel: **Project → Settings → Domains → Add** → type your domain (e.g. `oneshort.nl`).
2. Vercel shows 1–2 DNS records (usually an **A record** for `@` and a **CNAME** for `www`).
3. At your domain registrar → DNS settings → add exactly those records. HTTPS is set up automatically.

## 4. Running the pilot

- **Hosts** post via **Host a game**. They get a private host link; tell them to save it (there's a "send to myself on WhatsApp" button).
- **Players** open a game link (shared in the group chat), request a spot, and get a status page.
- After each game, the host marks who **showed up / no-show** on their host page. Remind them: that's your attendance data.
- **Results:** Supabase → SQL Editor → paste `supabase/pilot_stats.sql` → Run. It gives games posted, number of hosts, % spots filled, % answered within 2h, median response time, % show-up and % returning players.

## 5. Admin page (remove inappropriate games or requests)

1. Open `supabase/admin.sql`, change `CHANGE-ME-to-a-long-password` on the last line to your own long password.
2. Supabase → SQL Editor → paste the file → Run. (Run it again later to change the password.)
3. Go to `yourdomain/#/admin` and log in. You can remove or restore any game (with a reason) and any player request. Removed games disappear from the site; hosts can't undo it.
4. The admin page isn't linked anywhere on the site — bookmark it. Only share the password with your team.

## 6. Map pin (OpenStreetMap)

1. Supabase → SQL Editor → paste `supabase/map.sql` → Run (after schema.sql and admin.sql). Existing games are kept; they just have no pin.
2. Hosts can search a place, tap the map or use "My location", then drag the pin to the exact spot. The location name is filled in automatically if empty.
3. Players see the map on the game page, plus an "Open in Google Maps" button for directions. The WhatsApp share text also includes the Google Maps link.
4. Free: map tiles from OpenStreetMap and place search from Nominatim, no key or card needed. Fine for a pilot; for a big launch, switch to a paid tile/search provider.

## 7. Accounts (email + password)

1. Supabase → SQL Editor → paste `supabase/accounts.sql` → Run (after schema, admin and map). Existing games, requests and old links keep working.
2. Supabase → **Authentication → Sign In / Providers → Email** → turn **off "Confirm email"** → Save. (Otherwise every sign-up needs an email, and Supabase's free email service only sends a few per hour.)
3. Supabase → **Authentication → URL Configuration** → Site URL: `https://oneshort.app`, and add `https://oneshort.app/**` under Redirect URLs. (Needed for "Forgot password" links.)
4. Sign-up asks for: email, password, name, favourite sport, level, and an optional WhatsApp number. Logged-in users post and join without typing their details again; everything is under **My account**.
5. Accounts are required to host or join. Old secret host/player links from before still work.
6. "Forgot password" emails use Supabase's free email service (a few per hour). For many users, add your own SMTP under Authentication → Emails.

## Good to know

- There are no notifications: players check their status page, and hosts check their host page. Approved players and hosts contact each other over WhatsApp.
- Lost host link? You can find it in Supabase → Table Editor → `games` → `host_token`. The link is `yourdomain/#/manage/<id>/<host_token>`.
- When the pilot ends, delete the data (Table Editor → delete rows), as the site promises.
