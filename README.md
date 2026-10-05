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

## Good to know

- There are no notifications: players check their status page, and hosts check their host page. Approved players and hosts contact each other over WhatsApp.
- Lost host link? You can find it in Supabase → Table Editor → `games` → `host_token`. The link is `yourdomain/#/manage/<id>/<host_token>`.
- When the pilot ends, delete the data (Table Editor → delete rows), as the site promises.
