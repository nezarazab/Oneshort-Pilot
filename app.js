/* OneShort pilot — app logic (plain JavaScript, no build step) */
(function () {
  "use strict";

  // ---------- Backend ----------
  const cfg = Object.assign({}, window.ONESHORT_CONFIG);
  if (cfg.SUPABASE_URL && !/^https?:\/\//.test(cfg.SUPABASE_URL)) cfg.SUPABASE_URL = "https://" + cfg.SUPABASE_URL.trim();
  const live = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const client = live ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const banner = document.getElementById("demo-banner");
  if (!live && banner) banner.hidden = false;

  async function rpc(name, params) {
    if (!live) return window.OneShortMock.rpc(name, params);
    const { data, error } = await client.rpc(name, params || {});
    if (error) throw new Error(cleanError(error.message));
    return data;
  }
  function cleanError(msg) {
    if (!msg) return "Something went wrong. Please try again.";
    if (/violates check constraint/i.test(msg)) return "Please check your input (some text may be too long or empty).";
    if (/invalid input syntax for type uuid/i.test(msg)) return "This link is not valid.";
    return msg;
  }

  // ---------- Accounts (Supabase Auth: email + password) ----------
  const authApi = live ? {
    async getUser() { const { data } = await client.auth.getSession(); return data.session ? data.session.user : null; },
    async signUp(email, password) { const { data, error } = await client.auth.signUp({ email, password }); if (error) throw error; return data; },
    async signIn(email, password) { const { data, error } = await client.auth.signInWithPassword({ email, password }); if (error) throw error; return data; },
    async signOut() { await client.auth.signOut(); },
    async resetEmail(email) { const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error; },
    async updatePassword(pw) { const { error } = await client.auth.updateUser({ password: pw }); if (error) throw error; },
    onChange(cb) { client.auth.onAuthStateChange((event) => cb(event)); },
  } : window.OneShortMock.auth;

  function authError(e) {
    const m = (e && e.message) || "";
    if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/already registered|already been registered/i.test(m)) return "This email already has an account. Log in instead.";
    if (/at least 6/i.test(m)) return "Your password needs at least 6 characters.";
    if (/email not confirmed/i.test(m)) return "Please confirm your email first (check your inbox), then log in.";
    if (/rate limit|too many/i.test(m)) return "Too many tries. Please wait a minute and try again.";
    if (/valid email|invalid.*email/i.test(m)) return "Please enter a valid email address.";
    return m || "Something went wrong. Please try again.";
  }

  let me = null; // { user, profile } when logged in
  const PENDING = "oneshort-pending-profile", NEXT = "oneshort-next";
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} }, del: (k) => { try { sessionStorage.removeItem(k); } catch {} } };
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

  async function loadMe() {
    let user = null;
    try { user = await authApi.getUser(); } catch {}
    if (!user) { me = null; renderNav(); return null; }
    let profile = null;
    try { profile = await rpc("my_profile"); } catch {}
    if (!profile) {
      // profile typed at sign-up but saved later (when email confirmation was on)
      try {
        const pend = JSON.parse(ls.get(PENDING) || "null");
        if (pend && pend.email === (user.email || "").toLowerCase()) { profile = await rpc("save_profile", pend.data); ls.del(PENDING); }
      } catch {}
    }
    me = { user, profile };
    renderNav();
    return me;
  }
  function renderNav() {
    const nav = document.querySelector(".topbar nav");
    if (!nav) return;
    if (me) {
      const initial = esc(((me.profile && me.profile.name) || me.user.email || "?").trim().charAt(0).toUpperCase());
      nav.innerHTML = `<a href="#/" class="nav-link hide-sm">Find games</a><a href="#/host" class="btn btn-small btn-ghost">Host a game</a><a href="#/me" class="avatar" title="My account" aria-label="My account">${initial}</a>`;
    } else {
      nav.innerHTML = `<a href="#/" class="nav-link hide-sm">Find games</a><a href="#/login" class="nav-link">Log in</a><a href="#/signup" class="btn btn-small">Sign up</a>`;
    }
  }
  // Send to login (and come back afterwards). Returns true if the user may continue.
  function requireAccount(nextHash, why) {
    if (me && me.profile) return true;
    ss.set(NEXT, nextHash);
    if (me && !me.profile) { location.hash = "#/me"; return false; }
    if (why) ss.set("oneshort-why", why);
    location.hash = "#/login";
    return false;
  }
  function goNext() {
    const next = ss.get(NEXT) || "#/"; ss.del(NEXT);
    if (location.hash === next) route(); else location.hash = next;
  }

  // ---------- Helpers ----------
  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const base = () => location.origin + location.pathname;
  const fmtWhen = (iso) => {
    const d = new Date(iso);
    const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
    return `${day} · ${time}`;
  };
  const isPast = (iso) => new Date(iso) < new Date();
  // Sport is free text, so match loosely; anything unknown gets the generic players photo.
  const sportClass = (sport) => {
    const s = String(sport).toLowerCase();
    const hit = [["foot", "football"], ["soccer", "football"], ["futsal", "football"], ["basket", "basketball"], ["volley", "volleyball"], ["padel", "padel"], ["tennis", "tennis"]].find(([word]) => s.includes(word));
    return "sport-bg" + (hit ? ` sport-${hit[1]}` : "");
  };
  const dateTile = (iso) => {
    const [dow, day, mon] = fmtWhen(iso).split(" · ")[0].replace(",", "").split(" ");
    return `<div class="date-tile"><span>${dow}</span><b>${day}</b><span>${mon}</span></div>`;
  };
  function waNumber(contact) {
    if (!contact || contact.includes("@")) return null;
    let n = contact.replace(/[^\d+]/g, "");
    if (n.startsWith("+")) n = n.slice(1);
    else if (n.startsWith("00")) n = n.slice(2);
    else if (n.startsWith("06")) n = "31" + n.slice(1);
    return n.length >= 10 ? n : null;
  }
  const waShare = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
  const contactLink = (c) => {
    const n = waNumber(c);
    if (n) return `<a href="https://wa.me/${n}" target="_blank" rel="noopener">${esc(c)}</a> <span class="hint">(WhatsApp)</span>`;
    if (c && c.includes("@")) return `<a href="mailto:${esc(c)}">${esc(c)}</a>`;
    return esc(c);
  };

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2400);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Link copied"); }
    catch { prompt("Copy this link:", text); }
  }

  // ---------- Maps (OpenStreetMap via Leaflet, loaded only when needed) ----------
  const EINDHOVEN = [51.4416, 5.4697];
  let leafletPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!leafletPromise) leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
      js.onload = () => resolve(window.L);
      js.onerror = () => { leafletPromise = null; reject(new Error("Map could not load")); };
      document.head.appendChild(js);
    });
    return leafletPromise;
  }
  function makeMap(L, el, center, zoom) {
    const map = L.map(el, { scrollWheelZoom: false, tap: false }).setView(center, zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    return map;
  }
  const pinIcon = (L) => L.divIcon({ className: "os-pin", html: "<span></span>", iconSize: [30, 40], iconAnchor: [15, 40] });
  const hasPin = (g) => g && typeof g.lat === "number" && typeof g.lng === "number";
  const gmapsUrl = (g) => `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`;
  async function geoSearch(q) {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=nl&viewbox=5.25,51.6,5.7,51.3&q=${encodeURIComponent(q)}`;
    const r = await fetch(u, { headers: { "Accept-Language": "en" } });
    const d = await r.json();
    return d && d[0] ? { lat: +d[0].lat, lng: +d[0].lon, name: d[0].display_name } : null;
  }
  async function geoName(lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`, { headers: { "Accept-Language": "en" } });
      const d = await r.json();
      const a = d.address || {};
      const parts = [d.name || a.leisure || a.park || a.road, a.suburb || a.neighbourhood, a.city || a.town || a.village].filter(Boolean);
      return [...new Set(parts)].slice(0, 2).join(", ") || null;
    } catch { return null; }
  }
  // Read-only map with one pin (game page)
  function showGameMap(elId, g) {
    loadLeaflet().then((L) => {
      const el = document.getElementById(elId);
      if (!el) return;
      const map = makeMap(L, el, [g.lat, g.lng], 16);
      L.marker([g.lat, g.lng], { icon: pinIcon(L), keyboard: false }).addTo(map);
    }).catch(() => { const el = document.getElementById(elId); if (el) el.outerHTML = `<p class="hint">Map couldn't load. Use the button below.</p>`; });
  }

  // Home page: all pinned games on one map
  function renderHomeMap(games) {
    const wrap = document.getElementById("home-map-wrap");
    const pinned = games.filter(hasPin);
    if (!wrap || !pinned.length) return;
    wrap.innerHTML = `<div class="card map-card"><div id="home-map" class="map map-home"></div>
      <p class="hint" style="margin:8px 4px 0">${pinned.length} game${pinned.length > 1 ? "s" : ""} on the map${pinned.length < games.length ? ` · ${games.length - pinned.length} without a pin (see list below)` : ""}. Tap a pin for details.</p></div>`;
    loadLeaflet().then((L) => {
      const el = document.getElementById("home-map");
      if (!el) return;
      const map = makeMap(L, el, EINDHOVEN, 12);
      const pts = [];
      pinned.forEach((g) => {
        const left = Math.max(0, g.spots_needed - g.spots_filled);
        const html = `<div class="pop"><span class="sport-chip">${esc(g.sport)}</span>
          <div class="pop-when">${fmtWhen(g.starts_at)}</div>
          <div class="pop-loc">${esc(g.location)}</div>
          <div class="pop-spots">${left ? `${left} spot${left > 1 ? "s" : ""} left` : "Full"} · ${esc(g.level)}</div>
          <a class="btn btn-small pop-btn" href="#/game/${g.id}">View game →</a></div>`;
        L.marker([g.lat, g.lng], { icon: pinIcon(L), title: `${g.sport} · ${fmtWhen(g.starts_at)}` }).addTo(map).bindPopup(html, { maxWidth: 240 });
        pts.push([g.lat, g.lng]);
      });
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 });
      else map.setView(pts[0], 15);
    }).catch(() => { wrap.innerHTML = ""; });
  }

  // "My games / requests" remembered in this browser (convenience only)
  const MINE = "oneshort-mine";
  const getMine = () => { try { return JSON.parse(localStorage.getItem(MINE)) || { games: [], requests: [] }; } catch { return { games: [], requests: [] }; } };
  const addMine = (kind, item) => { try { const m = getMine(); m[kind] = [item, ...m[kind].filter((x) => x.id !== item.id)].slice(0, 20); localStorage.setItem(MINE, JSON.stringify(m)); } catch {} };

  const setView = (html) => { app.className = ""; app.innerHTML = html; window.scrollTo(0, 0); };
  const loading = () => setView(`<div class="loading">Loading…</div>`);
  const errorView = (msg) => setView(`<div class="page-title"><h1>Oops</h1></div><div class="card"><p>${esc(msg)}</p><a class="btn" href="#/">Back to games</a></div>`);

  function spotsBlock(g) {
    const left = Math.max(0, g.spots_needed - g.spots_filled);
    const pct = Math.min(100, Math.round((g.spots_filled / g.spots_needed) * 100));
    return `<div class="spots"><div class="spots-bar"><i style="width:${pct}%"></i></div>
      <div class="spots-text ${left ? "" : "full"}">${left ? `${left} of ${g.spots_needed} spot${g.spots_needed > 1 ? "s" : ""} left` : "Full"}</div></div>`;
  }
  function gameMeta(g, linkLocation = true) {
    const loc = hasPin(g) && linkLocation ? `<a href="${gmapsUrl(g)}" target="_blank" rel="noopener">${esc(g.location)}</a>` : esc(g.location);
    return `<div class="meta"><span>${loc}</span><span>${esc(g.level)}</span>${g.cost_per_player ? `<span>Cost: ${esc(g.cost_per_player)}</span>` : ""}<span>Hosted by ${esc(g.host_name)}</span></div>`;
  }

  // ---------- Views ----------

  function activityRows(act, onlyUpcoming) {
    const keep = (iso) => !onlyUpcoming || new Date(iso) > Date.now() - 2 * 3600e3;
    const hosting = act.hosting.filter((g) => keep(g.starts_at) && (!onlyUpcoming || g.status === "open"));
    const reqs = act.requests.filter((r) => keep(r.starts_at) && (!onlyUpcoming || ["pending", "approved"].includes(r.status)));
    return hosting.map((g) => `<a href="#/manage/${g.id}"><span><b>Hosting:</b> ${esc(g.sport)} · ${fmtWhen(g.starts_at)}${g.status !== "open" ? ` <span class="status cancelled">${esc(g.status)}</span>` : g.pending ? ` <span class="status pending">${g.pending} waiting</span>` : ""}</span><span>Manage →</span></a>`).join("")
      + reqs.map((r) => `<a href="#/request/${r.id}"><span><b>Joining:</b> ${esc(r.sport)} · ${fmtWhen(r.starts_at)} <span class="status ${r.game_status !== "open" ? "cancelled" : esc(r.status)}">${r.game_status !== "open" ? esc(r.game_status) : esc(r.status)}</span></span><span>Status →</span></a>`).join("");
  }

  async function viewHome() {
    const mine = getMine();
    let rows = mine.games.map((g) => `<a href="#/manage/${g.id}/${g.token}"><span><b>Hosting:</b> ${esc(g.sport)} · ${fmtWhen(g.starts_at)}</span><span>Manage →</span></a>`).join("")
      + mine.requests.map((r) => `<a href="#/request/${r.id}/${r.token}"><span><b>Requested:</b> ${esc(r.sport)} · ${fmtWhen(r.starts_at)}</span><span>Status →</span></a>`).join("");
    if (me) { try { rows = activityRows(await rpc("my_activity"), true) + rows; } catch {} }
    const mineHtml = rows ? `
      <div class="section-head"><h2>Your games</h2>${me ? `<a href="#/me">See all</a>` : ""}</div>
      <div class="card mine">${rows}</div>` : "";

    setView(`
      <section class="hero">
        <div class="hero-copy">
          <span class="pill-badge"><i></i>Live in Eindhoven · Pilot</span>
          <h1>Never be a player <em>short.</em></h1>
          <p>Meet players and join games at your level in your favorite sport.</p>
          <div class="btn-row">
            <a class="btn btn-lg" href="#games" data-scroll="games"><span id="hero-find">Find a game</span> <span class="arr">→</span></a>
            <a class="hero-link" href="#/host">Host a game</a>
          </div>
          <ul class="hero-points"><li>Free to use</li><li>Contact details shared only after approval</li></ul>
        </div>
        <div class="hero-art" id="hero-art"></div>
      </section>
      <div class="stats" id="stats" hidden></div>
      ${mineHtml}
      <div class="section-head" id="games"><div><span class="eyebrow">Find your game</span><h2>Open games</h2></div></div>
      <div class="browse">
        <div id="home-map-wrap"></div>
        <div id="game-list"><div class="loading">Loading games…</div></div>
      </div>
      <div class="section-head"><div><span class="eyebrow">Three steps</span><h2>How it works</h2></div></div>
      <div class="steps">
        <div class="step"><b>01</b><div><strong>Pick a game</strong><span>Browse open games on the map or in the list.</span></div></div>
        <div class="step"><b>02</b><div><strong>Request a spot</strong><span>The host reviews your request and approves you.</span></div></div>
        <div class="step"><b>03</b><div><strong>Play</strong><span>You get each other's WhatsApp or email to sort out the details.</span></div></div>
      </div>
      <div class="perks">
        <div class="perk"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4.400-3 7.600-7 9-4-1.400-7-4.600-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg><div><strong>Your number stays private</strong><span>Contact details are only swapped once the host approves you.</span></div></div>
        <div class="perk"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.600-3.400 3.200-5.500 6.500-5.500s5.900 2.100 6.500 5.500"/><path d="M16 4.800a3.500 3.500 0 010 6.400M18 14.800c1.900.700 3.100 2.500 3.500 5.200"/></svg><div><strong>Any sport, any level</strong><span>Every game lists its level, so you know what you're joining.</span></div></div>
        <div class="perk"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.500" cy="7.500" r="1.500"/></svg><div><strong>Free to use</strong><span>No fees from us. You only pay your share if the host lists a cost.</span></div></div>
      </div>
      <section class="host-band">
        <div><h2>Short a player?</h2><p>Host a game in a minute, share the link in your group chat and pick who joins.</p>
          <ul class="sports"><li>Football</li><li>Padel</li><li>Basketball</li><li>Volleyball</li><li>Tennis</li></ul></div>
        <a class="btn btn-lg" href="#/host">Host a game <span class="arr">→</span></a>
      </section>
    `);
    app.classList.add("wide");

    try {
      const games = await rpc("list_games");
      const list = document.getElementById("game-list");
      if (!list) return;
      const left = (g) => Math.max(0, g.spots_needed - g.spots_filled);
      if (games.length) {
        const n = (count, word) => `<div><b>${count}</b><span>${word}${count === 1 ? "" : "s"}</span></div>`;
        document.getElementById("hero-find").textContent = `See ${games.length} open game${games.length > 1 ? "s" : ""}`;
        const stats = document.getElementById("stats");
        stats.innerHTML = n(games.length, "open game") + n(games.reduce((s, g) => s + left(g), 0), "open spot") + n(new Set(games.map((g) => g.sport)).size, "sport");
        stats.hidden = false;
      }
      const next = games.find((g) => !isPast(g.starts_at) && left(g)) || games[0];
      document.getElementById("hero-art").innerHTML = next ? `
        <a class="feature ${sportClass(next.sport)}" href="#/game/${next.id}">
          <span class="feature-label">Next game</span>
          <div class="feature-row">${dateTile(next.starts_at)}<div><span class="sport-chip">${esc(next.sport)}</span><div class="when">${fmtWhen(next.starts_at)}</div></div></div>
          ${gameMeta(next, false)}
          ${spotsBlock(next)}
          <span class="feature-cta">Request a spot <span class="arr">→</span></span>
        </a>` : `
        <a class="feature sport-bg" href="#/host">
          <span class="feature-label">No games yet</span>
          <div class="when" style="margin:12px 0 6px">Be the first to post one</div>
          <div class="meta"><span>It takes a minute, and your group chat does the rest.</span></div>
          <span class="feature-cta">Host a game <span class="arr">→</span></span>
        </a>`;
      list.innerHTML = games.length ? games.map((g) => `
        <a class="card game-card ${sportClass(g.sport)}" href="#/game/${g.id}">
          ${dateTile(g.starts_at)}
          <div class="game-body">
            <div class="game-top"><span class="sport-chip">${esc(g.sport)}</span>${isPast(g.starts_at) ? `<span class="status pending">Started</span>` : `<span class="arr">→</span>`}</div>
            <div class="when">${fmtWhen(g.starts_at).split(" · ")[1]}</div>
            ${gameMeta(g, false)}
            ${spotsBlock(g)}
          </div>
        </a>`).join("") : `
        <div class="card empty"><h3>No open games yet</h3>
          <p class="muted">Be the first. Post a game and share it in your group chat.</p>
          <a class="btn" href="#/host">Host a game</a></div>`;
      renderHomeMap(games);
    } catch (e) {
      const list = document.getElementById("game-list");
      if (list) list.innerHTML = `<div class="form-error">Could not load games: ${esc(e.message)}</div>`;
    }
  }

  function viewHost() {
    if (!requireAccount("#/host", "Log in or create an account to host a game.")) return;
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(19, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    const defaultWhen = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T19:00`;
    setView(`
      <a class="back" href="#/">← All games</a>
      <div class="page-title"><h1>Host a game</h1><p class="muted">Tell players what you need. You decide who joins.</p></div>
      <form class="card" id="host-form" novalidate>
        <div id="form-error"></div>
        <div class="field">
          <label for="sport">Sport</label>
          <input id="sport" name="sport" required maxlength="40" placeholder="e.g. Football" autocomplete="off" value="${esc(me.profile.fav_sport)}" />
          <div class="chips">${["Football", "Padel", "Basketball", "Volleyball", "Tennis"].map((s) => `<button type="button" class="chip" data-sport="${s}">${s}</button>`).join("")}</div>
        </div>
        <div class="grid-2">
          <div class="field"><label for="when">Date & time</label><input id="when" name="when" type="datetime-local" required value="${defaultWhen}" /></div>
          <div class="field"><label for="spots">Players needed</label><input id="spots" name="spots" type="number" min="1" max="30" value="2" required /></div>
        </div>
        <div class="field"><label for="location">Location name</label><input id="location" name="location" required maxlength="120" placeholder="e.g. Genneper Parken, field 3" /></div>
        <div class="field" id="map-field">
          <label for="map-q">Pin the exact spot <span class="hint">(recommended)</span></label>
          <div class="map-search"><input id="map-q" placeholder="Search a place, e.g. Genneper Parken" autocomplete="off" /><button type="button" class="btn btn-dark btn-small" id="map-go">Search</button></div>
          <div id="pick-map" class="map"></div>
          <div class="map-bar"><span id="pin-status" class="hint">Tap the map to drop a pin, then drag it to the exact spot.</span>
            <span class="map-actions"><button type="button" class="chip" id="map-me">📍 My location</button><button type="button" class="chip" id="map-clear" hidden>Remove pin</button></span></div>
        </div>
        <div class="grid-2">
          <div class="field"><label for="level">Level</label>
            <select id="level" name="level"><option>Any</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></div>
          <div class="field"><label for="cost">Cost per player <span class="hint">(optional)</span></label><input id="cost" name="cost" maxlength="40" placeholder="e.g. €3 or Free" /></div>
        </div>
        <div class="field"><label for="notes">Notes <span class="hint">(optional)</span></label><textarea id="notes" name="notes" maxlength="500" placeholder="e.g. 5v5, bring a dark and a light shirt"></textarea></div>
        <p class="hint">Posting as <b>${esc(me.profile.name)}</b>. Players you approve will see ${me.profile.phone ? "your WhatsApp number" : "your email"} (<a href="#/me">change</a>).</p>
        <button class="btn btn-block" type="submit">Post game</button>
      </form>`);

    app.querySelectorAll("[data-sport]").forEach((b) => b.addEventListener("click", () => { document.getElementById("sport").value = b.dataset.sport; }));

    // Map picker
    let pin = null, autoName = "";
    const locInput = document.getElementById("location");
    loadLeaflet().then((L) => {
      const el = document.getElementById("pick-map");
      if (!el) return;
      const map = makeMap(L, el, EINDHOVEN, 13);
      const status = document.getElementById("pin-status"), clearBtn = document.getElementById("map-clear");
      let marker = null;
      const place = async (latlng, fillName = true) => {
        pin = { lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6) };
        if (!marker) {
          marker = L.marker(latlng, { draggable: true, icon: pinIcon(L), autoPan: true }).addTo(map);
          marker.on("dragend", () => place(marker.getLatLng()));
        } else marker.setLatLng(latlng);
        status.textContent = "Pin set ✓ Drag it to adjust.";
        clearBtn.hidden = false;
        if (fillName && (!locInput.value.trim() || locInput.value === autoName)) {
          const n = await geoName(pin.lat, pin.lng);
          if (n && (!locInput.value.trim() || locInput.value === autoName)) { locInput.value = n; autoName = n; }
        }
      };
      map.on("click", (e) => place(e.latlng));
      clearBtn.addEventListener("click", () => {
        if (marker) { map.removeLayer(marker); marker = null; }
        pin = null; clearBtn.hidden = true;
        status.textContent = "Tap the map to drop a pin, then drag it to the exact spot.";
      });
      const doSearch = async () => {
        const q = document.getElementById("map-q").value.trim();
        if (!q) return;
        status.textContent = "Searching…";
        try {
          const hit = await geoSearch(q);
          if (!hit) { status.textContent = "No place found. Try another name, or tap the map."; return; }
          map.setView([hit.lat, hit.lng], 17);
          await place({ lat: hit.lat, lng: hit.lng }, false);
          if (!locInput.value.trim() || locInput.value === autoName) { locInput.value = q; autoName = q; }
        } catch { status.textContent = "Search failed. Tap the map instead."; }
      };
      document.getElementById("map-go").addEventListener("click", doSearch);
      document.getElementById("map-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
      document.getElementById("map-me").addEventListener("click", () => {
        if (!navigator.geolocation) return toast("Location not available");
        status.textContent = "Finding your location…";
        navigator.geolocation.getCurrentPosition(
          (p) => { const ll = { lat: p.coords.latitude, lng: p.coords.longitude }; map.setView([ll.lat, ll.lng], 17); place(ll); },
          () => { status.textContent = "Couldn't get your location. Tap the map instead."; },
          { enableHighAccuracy: true, timeout: 10000 });
      });
    }).catch(() => {
      const f = document.getElementById("map-field");
      if (f) f.innerHTML = `<p class="hint">The map couldn't load. Just describe the location in the field above.</p>`;
    });

    document.getElementById("host-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.target, btn = f.querySelector("[type=submit]"), errBox = document.getElementById("form-error");
      const v = (n) => f.elements[n].value.trim();
      const missing = ["sport", "when", "spots", "location"].filter((n) => !v(n));
      if (missing.length) { errBox.innerHTML = `<div class="form-error">Please fill in all required fields.</div>`; f.elements[missing[0]].focus(); return; }
      const when = new Date(v("when"));
      if (isNaN(when) || when < new Date()) { errBox.innerHTML = `<div class="form-error">Pick a date and time in the future.</div>`; return; }
      const spots = parseInt(v("spots"), 10);
      if (!(spots >= 1 && spots <= 30)) { errBox.innerHTML = `<div class="form-error">Players needed must be between 1 and 30.</div>`; return; }
      btn.disabled = true; btn.textContent = "Posting…";
      try {
        const id = await rpc("post_game", {
          p_sport: v("sport"), p_location: v("location"), p_starts_at: when.toISOString(), p_spots: spots,
          p_level: v("level"), p_cost: v("cost") || null, p_notes: v("notes") || null,
          p_lat: pin ? pin.lat : null, p_lng: pin ? pin.lng : null,
        });
        viewHostCreated(id, { sport: v("sport"), starts_at: when.toISOString(), location: v("location"), spots, lat: pin ? pin.lat : null, lng: pin ? pin.lng : null });
      } catch (e) {
        errBox.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
        btn.disabled = false; btn.textContent = "Post game";
      }
    });
  }

  function shareText(g, id) {
    return `${g.sport} · ${fmtWhen(g.starts_at)} · ${g.location}\nNeed ${g.spots} player${g.spots > 1 ? "s" : ""}! Request a spot on OneShort: ${base()}#/game/${id}${hasPin(g) ? `\n📍 ${gmapsUrl(g)}` : ""}`;
  }

  function viewHostCreated(id, g) {
    setView(`
      <div class="page-title"><h1>Your game is live 🎉</h1><p class="muted">You can manage it anytime from <a href="#/me">My account</a>.</p></div>
      <div class="card success">
        <h2>Share the game</h2>
        <p class="muted">Post it in your group chat so players can request a spot.</p>
        <div class="btn-row">
          <a class="btn btn-wa" target="_blank" rel="noopener" href="${waShare(shareText(g, id))}">Share on WhatsApp</a>
          <button class="btn btn-ghost" data-copy="${esc(base() + "#/game/" + id)}">Copy game link</button>
        </div>
      </div>
      <a class="btn btn-block" href="#/manage/${id}">Go to my game →</a>`);
  }

  async function viewGame(id) {
    loading();
    let g;
    try { const r = await rpc("get_game", { p_id: id }); g = Array.isArray(r) ? r[0] : r; } catch (e) { return errorView(e.message); }
    if (!g) return errorView("This game doesn't exist (anymore).");
    const left = g.spots_needed - g.spots_filled;
    const closed = g.status !== "open" || isPast(g.starts_at) || left <= 0;
    const reason = g.status === "removed" ? "This game was removed." : g.status !== "open" ? "This game was cancelled by the host." : isPast(g.starts_at) ? "This game has already started." : "This game is full.";
    const share = `${base()}#/game/${g.id}`;

    setView(`
      <a class="back" href="#/">← All games</a>
      <div class="page-title"><span class="sport-chip">${esc(g.sport)}</span><h1 style="margin-top:12px">${fmtWhen(g.starts_at)}</h1>${gameMeta(g)}</div>
      ${hasPin(g) ? `<div class="card map-card"><div id="game-map" class="map map-small"></div>
        <div class="btn-row" style="margin-top:12px"><a class="btn btn-dark btn-small" href="${gmapsUrl(g)}" target="_blank" rel="noopener">Open in Google Maps</a></div></div>` : ""}
      <div class="card">${spotsBlock(g)}${g.notes ? `<p class="req-msg">${esc(g.notes)}</p>` : ""}
        <div class="btn-row" style="margin-top:12px"><a class="btn btn-wa btn-small" target="_blank" rel="noopener" href="${waShare(`${g.sport} · ${fmtWhen(g.starts_at)} · ${g.location}\nRequest a spot: ${share}`)}">Share</a></div></div>
      ${requestSection(g, closed, reason)}`);

    if (hasPin(g)) showGameMap("game-map", g);
    const login = document.getElementById("login-to-join");
    if (login) login.addEventListener("click", (e) => { e.preventDefault(); requireAccount(`#/game/${g.id}`, "Log in or create an account to request a spot."); });
    const signup = document.getElementById("signup-to-join");
    if (signup) signup.addEventListener("click", () => ss.set(NEXT, `#/game/${g.id}`));
    const form = document.getElementById("req-form");
    if (!form) return;
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector("[type=submit]"), errBox = document.getElementById("form-error");
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        const id = await rpc("join_game", { p_game: g.id, p_level: document.getElementById("plevel").value, p_message: document.getElementById("pmsg").value.trim() || null });
        location.hash = `#/request/${id}?new=1`;
      } catch (e) {
        errBox.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
        btn.disabled = false; btn.textContent = "Request spot";
      }
    });
  }

  function requestSection(g, closed, reason) {
    if (g.is_host) return `<div class="card"><h2>This is your game</h2><p class="muted">Approve players and see who's coming on your game page.</p><a class="btn" href="#/manage/${g.id}">Manage game →</a></div>`;
    if (g.my_request_id && ["pending", "approved"].includes(g.my_request_status)) return `<div class="card ${g.my_request_status === "approved" ? "success" : ""}"><h2>${g.my_request_status === "approved" ? "You're in! ✅" : "Request sent"}</h2><p class="muted">${g.my_request_status === "approved" ? "See the host's contact on your request page." : `Waiting for ${esc(g.host_name)} to respond.`}</p><a class="btn" href="#/request/${g.my_request_id}">View my request →</a></div>`;
    if (closed) return `<div class="card empty"><h3>${reason}</h3><a class="btn" href="#/">See other games</a></div>`;
    if (!me || !me.profile) return `<div class="card"><h2>Request a spot</h2><p class="muted">Create a free account to request a spot. It takes 30 seconds.</p>
      <div class="btn-row"><a class="btn" id="signup-to-join" href="#/signup">Sign up</a><a class="btn btn-ghost" id="login-to-join" href="#/login">Log in</a></div></div>`;
    const sameSport = me.profile.fav_sport.trim().toLowerCase() === String(g.sport).trim().toLowerCase();
    const lvl = sameSport ? me.profile.level : "Intermediate";
    return `<form class="card" id="req-form" novalidate>
        <h2>Request a spot</h2>
        <p class="muted">Requesting as <b>${esc(me.profile.name)}</b>. ${esc(g.host_name)} will approve or decline; once approved you'll see each other's contact.</p>
        <div id="form-error"></div>
        <div class="field"><label for="plevel">Your level in ${esc(g.sport)}</label>
          <select id="plevel">${["Beginner", "Intermediate", "Advanced"].map((l) => `<option ${l === lvl ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="pmsg">Message to host <span class="hint">(optional)</span></label><textarea id="pmsg" maxlength="300" placeholder="e.g. I usually play as a defender"></textarea></div>
        <button class="btn btn-block" type="submit">Request spot</button>
      </form>`;
  }

  async function viewRequest(id, token, isNew) {
    token = token || null;
    loading();
    let s;
    try { s = await rpc("request_status", { p_id: id, p_token: token }); }
    catch (e) { if (!token && !me) return requireAccount(`#/request/${id}`, "Log in to see your request."); return errorView(e.message); }
    const g = s.game, link = token ? `${base()}#/request/${id}/${token}` : "";
    const text = {
      pending: `Waiting for ${esc(g.host_name)} to respond. Check back on this page.`,
      approved: `You're in! Contact ${esc(g.host_name)} to confirm the details.`,
      declined: `${esc(g.host_name)} couldn't fit you in this time. Try another game!`,
      withdrawn: `You withdrew from this game.`,
      removed: `This request was removed by OneShort.`,
    }[s.status];
    setView(`
      <a class="back" href="#/">← All games</a>
      <div class="page-title"><h1>${isNew ? "Request sent ✅" : "Your request"}</h1></div>
      <div class="card ${s.status === "approved" ? "success" : ""}">
        <div class="game-top"><span class="sport-chip">${esc(g.sport)}</span><span class="status ${g.status !== "open" ? "cancelled" : s.status}">${g.status === "removed" ? "Game removed" : g.status === "cancelled" ? "Game cancelled" : s.status}</span></div>
        <div class="when">${fmtWhen(g.starts_at)}</div>
        <div class="meta"><span>${hasPin(g) ? `<a href="${gmapsUrl(g)}" target="_blank" rel="noopener">${esc(g.location)}</a>` : esc(g.location)}</span>${g.cost_per_player ? `<span>Cost: ${esc(g.cost_per_player)}</span>` : ""}</div>
        <p>${text}</p>
        ${s.status === "approved" && s.host_contact ? `<p><b>Host contact:</b> ${contactLink(s.host_contact)}</p>` : ""}
      </div>
      ${token ? `<div class="card">
        <h3>Save this page</h3>
        <p class="muted">Bookmark it or send it to yourself to check if you're approved.</p>
        <div class="linkbox"><input readonly value="${esc(link)}" aria-label="Status link" /><button class="btn btn-dark btn-small" data-copy="${esc(link)}">Copy</button></div>
        <div class="btn-row"><a class="btn btn-wa btn-small" target="_blank" rel="noopener" href="${waShare("My OneShort request: " + link)}">Send to myself on WhatsApp</a>
        <button class="btn btn-ghost btn-small" id="refresh">Refresh status</button></div>
      </div>` : `<div class="card"><p class="muted" style="margin:0">You'll always find this request under <a href="#/me">My account</a>.</p>
        <div class="btn-row" style="margin-top:10px"><button class="btn btn-ghost btn-small" id="refresh">Refresh status</button><a class="btn btn-ghost btn-small" href="#/game/${g.id}">View game</a></div></div>`}
      ${["pending", "approved"].includes(s.status) && g.status === "open" && !isPast(g.starts_at) ? `<button class="btn btn-danger btn-block" id="withdraw">Can't make it? Withdraw</button>` : ""}`);

    document.getElementById("refresh").addEventListener("click", () => viewRequest(id, token, false));
    const w = document.getElementById("withdraw");
    if (w) w.addEventListener("click", async () => {
      if (!confirm("Withdraw from this game? The host will see that you can't make it.")) return;
      try { await rpc("withdraw_request", { p_id: id, p_token: token }); toast("You withdrew"); viewRequest(id, token, false); } catch (e) { toast(e.message); }
    });
  }

  async function viewManage(id, token) {
    token = token || null;
    let data;
    try { data = await rpc("host_view", { p_game: id, p_token: token }); }
    catch (e) { if (!token && !me) return requireAccount(`#/manage/${id}`, "Log in to manage your game."); return errorView(e.message); }
    const g = data.game, reqs = data.requests;
    const past = isPast(g.starts_at), cancelled = g.status !== "open";
    const left = g.spots_needed - g.spots_filled;
    const pending = reqs.filter((r) => r.status === "pending").length;
    const order = { pending: 0, approved: 1, declined: 2, withdrawn: 3 };
    reqs.sort((a, b) => order[a.status] - order[b.status] || new Date(a.created_at) - new Date(b.created_at));
    if (token) addMine("games", { id, token, sport: g.sport, starts_at: g.starts_at });

    const reqHtml = reqs.length ? reqs.map((r) => `
      <div class="req">
        <div class="req-head"><span class="req-name">${esc(r.player_name)} <span class="hint">· ${esc(r.level)}</span></span><span class="status ${r.status}">${r.status}</span></div>
        ${r.status === "approved" ? `<div class="hint" style="margin-top:4px">Contact: ${contactLink(r.player_contact)}</div>` : ""}
        ${r.message ? `<div class="req-msg">${esc(r.message)}</div>` : ""}
        ${!cancelled && !past && r.status === "pending" ? `<div class="btn-row">
            <button class="btn" data-decide="approved" data-id="${r.id}" ${left <= 0 ? "disabled" : ""}>Approve</button>
            <button class="btn btn-ghost" data-decide="declined" data-id="${r.id}">Decline</button></div>` : ""}
        ${!cancelled && !past && r.status === "approved" ? `<div class="btn-row"><button class="btn btn-ghost" data-decide="declined" data-id="${r.id}">Remove from game</button></div>` : ""}
        ${past && r.status === "approved" ? `<div class="attend">Did they show up?
            <button class="chip ${r.attended === true ? "on" : ""}" data-attend="true" data-id="${r.id}">✅ Showed up</button>
            <button class="chip ${r.attended === false ? "on" : ""}" data-attend="false" data-id="${r.id}">❌ No-show</button></div>` : ""}
      </div>`).join("") : `<p class="muted">No requests yet. Share the game in your group chat to get players.</p>`;

    setView(`
      <a class="back" href="#/">← All games</a>
      <div class="page-title"><span class="sport-chip">${esc(g.sport)}</span> ${cancelled ? `<span class="status cancelled">${g.status === "removed" ? "Removed by OneShort" : "Cancelled"}</span>` : ""}
        <h1 style="margin-top:12px">${fmtWhen(g.starts_at)}</h1>${gameMeta(g)}</div>
      <div class="card">
        <div class="kpis">
          <div class="kpi"><b>${g.spots_filled}/${g.spots_needed}</b><span>spots filled</span></div>
          <div class="kpi"><b>${pending}</b><span>waiting</span></div>
          <div class="kpi"><b>${reqs.length}</b><span>requests</span></div>
        </div>
        ${past && reqs.some((r) => r.status === "approved") ? `<div class="warn">The game has started. Please mark who showed up, it really helps our pilot!</div>` : ""}
        ${!cancelled && !past ? `<div class="btn-row" style="margin-top:12px">
          <a class="btn btn-wa btn-small" target="_blank" rel="noopener" href="${waShare(shareText({ ...g, spots: Math.max(left, 1) }, id))}">Share game</a>
          <button class="btn btn-ghost btn-small" id="refresh">Refresh</button></div>` : ""}
      </div>
      <div class="card"><h2>Players</h2>${reqHtml}</div>
      ${token ? `<p class="hint">🔒 This is your private host page. Keep the link to yourself.</p>` : ""}
      ${!cancelled && !past ? `<button class="btn btn-danger btn-block" id="cancel-game">Cancel game</button>` : ""}`);

    const reload = () => viewManage(id, token);
    const r = document.getElementById("refresh"); if (r) r.addEventListener("click", reload);
    app.querySelectorAll("[data-decide]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await rpc("host_decide", { p_request: b.dataset.id, p_token: token, p_decision: b.dataset.decide }); toast(b.dataset.decide === "approved" ? "Player approved" : "Updated"); reload(); }
      catch (e) { toast(e.message); b.disabled = false; }
    }));
    app.querySelectorAll("[data-attend]").forEach((b) => b.addEventListener("click", async () => {
      try { await rpc("host_mark_attendance", { p_request: b.dataset.id, p_token: token, p_attended: b.dataset.attend === "true" }); toast("Saved, thanks!"); reload(); }
      catch (e) { toast(e.message); }
    }));
    const c = document.getElementById("cancel-game");
    if (c) c.addEventListener("click", async () => {
      if (!confirm("Cancel this game? Players will see it's cancelled.")) return;
      try { await rpc("host_cancel_game", { p_game: id, p_token: token }); toast("Game cancelled"); reload(); } catch (e) { toast(e.message); }
    });
  }

  // ---------- Account pages ----------
  const SPORTS = ["Football", "Padel", "Basketball", "Volleyball", "Tennis"];
  const LEVELS = [["Beginner", "Just for fun"], ["Intermediate", "Play regularly"], ["Advanced", "Competitive"]];

  function profileFields(p) {
    p = p || {};
    const custom = p.fav_sport && !SPORTS.includes(p.fav_sport);
    return `
      <div class="field"><label for="pf-name">Your name</label><input id="pf-name" required maxlength="60" autocomplete="given-name" value="${esc(p.name || "")}" placeholder="First name is fine" /></div>
      <div class="field"><label>Favourite sport</label>
        <div class="pick" id="pf-sport">${SPORTS.map((x) => `<button type="button" class="pick-btn ${p.fav_sport === x ? "on" : ""}" data-val="${x}">${x}</button>`).join("")}<button type="button" class="pick-btn ${custom ? "on" : ""}" data-val="__other">Other</button></div>
        <input id="pf-sport-other" maxlength="40" placeholder="Which sport?" value="${custom ? esc(p.fav_sport) : ""}" ${custom ? "" : "hidden"} style="margin-top:8px" /></div>
      <div class="field"><label>Your level</label>
        <div class="pick pick-3" id="pf-level">${LEVELS.map(([l, d]) => `<button type="button" class="pick-btn ${p.level === l ? "on" : ""}" data-val="${l}"><b>${l}</b><span>${d}</span></button>`).join("")}</div></div>
      <div class="field"><label for="pf-phone">WhatsApp number <span class="hint">(optional, recommended)</span></label><input id="pf-phone" type="tel" maxlength="30" autocomplete="tel" value="${esc(p.phone || "")}" placeholder="06 12345678" />
        <div class="hint" style="margin-top:4px">Only shared with hosts or players you're matched with. Without it, we share your email.</div></div>`;
  }
  function wireProfileFields() {
    const pick = (id, onPick) => app.querySelectorAll(`#${id} .pick-btn`).forEach((b) => b.addEventListener("click", () => {
      app.querySelectorAll(`#${id} .pick-btn`).forEach((x) => x.classList.remove("on")); b.classList.add("on"); if (onPick) onPick(b.dataset.val);
    }));
    pick("pf-sport", (v) => { const o = document.getElementById("pf-sport-other"); o.hidden = v !== "__other"; if (v === "__other") o.focus(); });
    pick("pf-level");
  }
  function readProfileFields() {
    const name = document.getElementById("pf-name").value.trim();
    const sb = app.querySelector("#pf-sport .pick-btn.on"), lb = app.querySelector("#pf-level .pick-btn.on");
    let sport = sb ? sb.dataset.val : "";
    if (sport === "__other") sport = document.getElementById("pf-sport-other").value.trim();
    if (!name) throw new Error("Please fill in your name.");
    if (!sport) throw new Error("Pick your favourite sport.");
    if (!lb) throw new Error("Pick your level.");
    return { p_name: name, p_phone: document.getElementById("pf-phone").value.trim() || null, p_sport: sport, p_level: lb.dataset.val };
  }
  const showErr = (msg) => { const b = document.getElementById("form-error"); if (b) { b.innerHTML = `<div class="form-error">${esc(msg)}</div>`; b.scrollIntoView({ block: "center", behavior: "smooth" }); } };
  const pwToggle = (id) => `<button type="button" class="pw-toggle" data-pw="${id}">Show</button>`;
  function wirePwToggles() {
    app.querySelectorAll("[data-pw]").forEach((b) => b.addEventListener("click", () => {
      const i = document.getElementById(b.dataset.pw); i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "Show" : "Hide";
    }));
  }

  function viewSignup() {
    if (me && me.profile) return goNext();
    setView(`
      <div class="page-title"><h1>Create your account</h1><p class="muted">Free, and takes about 30 seconds. Already have one? <a href="#/login">Log in</a></p></div>
      <form class="card" id="signup-form" novalidate>
        <div id="form-error"></div>
        <div class="field"><label for="su-email">Email</label><input id="su-email" type="email" required autocomplete="email" inputmode="email" placeholder="you@email.com" /></div>
        <div class="field"><label for="su-pw">Password <span class="hint">(at least 6 characters)</span></label>
          <div class="pw-wrap"><input id="su-pw" type="password" required minlength="6" autocomplete="new-password" />${pwToggle("su-pw")}</div></div>
        ${profileFields()}
        <button class="btn btn-block" type="submit">Create account</button>
        <p class="hint" style="text-align:center;margin:10px 0 0">By signing up you agree that we store your details for the OneShort pilot.</p>
      </form>`);
    wireProfileFields(); wirePwToggles();
    document.getElementById("signup-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = ev.target.querySelector("[type=submit]");
      const email = document.getElementById("su-email").value.trim().toLowerCase(), pw = document.getElementById("su-pw").value;
      let prof;
      try {
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Please enter a valid email address.");
        if (pw.length < 6) throw new Error("Your password needs at least 6 characters.");
        prof = readProfileFields();
      } catch (e) { return showErr(e.message); }
      btn.disabled = true; btn.textContent = "Creating account…";
      try {
        const res = await authApi.signUp(email, pw);
        if (!res.session) {
          // Email confirmation is switched on in Supabase: save the profile after the first login.
          ls.set(PENDING, JSON.stringify({ email, data: prof }));
          setView(`<div class="page-title"><h1>Check your email 📬</h1></div><div class="card"><p>We sent a confirmation link to <b>${esc(email)}</b>. Click it, then log in.</p><a class="btn" href="#/login">Log in</a></div>`);
          return;
        }
        await rpc("save_profile", prof);
        await loadMe();
        toast(`Welcome, ${prof.p_name}!`);
        goNext();
      } catch (e) { showErr(authError(e)); btn.disabled = false; btn.textContent = "Create account"; }
    });
  }

  function viewLogin() {
    if (me && me.profile) return goNext();
    const why = ss.get("oneshort-why"); ss.del("oneshort-why");
    setView(`
      <div class="page-title"><h1>Log in</h1><p class="muted">New to OneShort? <a href="#/signup">Create an account</a></p></div>
      <form class="card" id="login-form" novalidate>
        ${why ? `<div class="warn">${esc(why)}</div>` : ""}
        <div id="form-error"></div>
        <div class="field"><label for="li-email">Email</label><input id="li-email" type="email" required autocomplete="email" inputmode="email" /></div>
        <div class="field"><label for="li-pw">Password</label><div class="pw-wrap"><input id="li-pw" type="password" required autocomplete="current-password" />${pwToggle("li-pw")}</div></div>
        <button class="btn btn-block" type="submit">Log in</button>
        <p style="text-align:center;margin:12px 0 0"><a href="#/forgot">Forgot your password?</a></p>
      </form>`);
    wirePwToggles();
    document.getElementById("login-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = ev.target.querySelector("[type=submit]");
      const email = document.getElementById("li-email").value.trim(), pw = document.getElementById("li-pw").value;
      if (!email || !pw) return showErr("Fill in your email and password.");
      btn.disabled = true; btn.textContent = "Logging in…";
      try {
        await authApi.signIn(email, pw);
        await loadMe();
        if (!me.profile) { location.hash = "#/me"; return; }
        toast(`Welcome back, ${me.profile.name}!`);
        goNext();
      } catch (e) { showErr(authError(e)); btn.disabled = false; btn.textContent = "Log in"; }
    });
  }

  function viewForgot() {
    setView(`
      <a class="back" href="#/login">← Log in</a>
      <div class="page-title"><h1>Reset password</h1><p class="muted">We'll email you a link to set a new password.</p></div>
      <form class="card" id="forgot-form" novalidate>
        <div id="form-error"></div>
        <div class="field"><label for="fp-email">Email</label><input id="fp-email" type="email" required autocomplete="email" /></div>
        <button class="btn btn-block" type="submit">Send reset link</button>
      </form>`);
    document.getElementById("forgot-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = ev.target.querySelector("[type=submit]"), email = document.getElementById("fp-email").value.trim();
      if (!email) return showErr("Fill in your email.");
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        await authApi.resetEmail(email);
        setView(`<div class="page-title"><h1>Check your email 📬</h1></div><div class="card"><p>If <b>${esc(email)}</b> has an account, you'll get a link to set a new password. Check your spam folder too.</p><a class="btn btn-ghost" href="#/login">Back to log in</a></div>`);
      } catch (e) { showErr(authError(e)); btn.disabled = false; btn.textContent = "Send reset link"; }
    });
  }

  function viewResetPassword() {
    setView(`
      <div class="page-title"><h1>Set a new password</h1></div>
      <form class="card" id="reset-form" novalidate>
        <div id="form-error"></div>
        <div class="field"><label for="rp-pw">New password <span class="hint">(at least 6 characters)</span></label><div class="pw-wrap"><input id="rp-pw" type="password" autocomplete="new-password" />${pwToggle("rp-pw")}</div></div>
        <button class="btn btn-block" type="submit">Save password</button>
      </form>`);
    wirePwToggles();
    document.getElementById("reset-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const pw = document.getElementById("rp-pw").value;
      if (pw.length < 6) return showErr("Your password needs at least 6 characters.");
      try { await authApi.updatePassword(pw); await loadMe(); toast("Password saved"); location.hash = "#/"; }
      catch (e) { showErr(authError(e) + " The reset link may have expired; request a new one."); }
    });
  }

  async function viewMe() {
    if (!me) return requireAccount("#/me");
    const setup = !me.profile;
    let act = { hosting: [], requests: [] };
    if (!setup) { try { act = await rpc("my_activity"); } catch {} }
    const rows = activityRows(act, false);
    setView(`
      <div class="page-title"><h1>${setup ? "Finish your profile" : `Hi ${esc(me.profile.name)} 👋`}</h1><p class="muted">${esc(me.user.email)}</p></div>
      ${setup ? "" : `<div class="section-head" style="margin-top:0"><h2>Your games</h2><a href="#/host">+ Host</a></div>
      <div class="card mine">${rows || `<p class="muted" style="margin:0">Nothing yet. <a href="#/">Find a game</a> or <a href="#/host">host one</a>.</p>`}</div>
      <div class="section-head"><h2>Profile</h2></div>`}
      <form class="card" id="profile-form" novalidate>
        <div id="form-error"></div>
        ${profileFields(me.profile)}
        <button class="btn btn-block" type="submit">${setup ? "Save and continue" : "Save changes"}</button>
      </form>
      ${setup ? "" : `<button class="btn btn-ghost btn-block" id="logout">Log out</button>`}`);
    wireProfileFields();
    document.getElementById("profile-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = ev.target.querySelector("[type=submit]");
      let prof; try { prof = readProfileFields(); } catch (e) { return showErr(e.message); }
      btn.disabled = true;
      try {
        await rpc("save_profile", prof); await loadMe(); toast("Profile saved");
        if (setup) goNext(); else viewMe();
      } catch (e) { showErr(e.message); btn.disabled = false; }
    });
    const lo = document.getElementById("logout");
    if (lo) lo.addEventListener("click", async () => { await authApi.signOut(); await loadMe(); toast("Logged out"); location.hash = "#/"; });
  }

  // ---------- Admin ----------
  const ADMIN = "oneshort-admin-key";
  const getKey = () => { try { return sessionStorage.getItem(ADMIN); } catch { return null; } };
  const setKey = (k) => { try { k ? sessionStorage.setItem(ADMIN, k) : sessionStorage.removeItem(ADMIN); } catch {} };

  function viewAdminLogin(msg) {
    setView(`
      <div class="page-title"><h1>Admin</h1><p class="muted">Remove games or requests that break the rules.</p></div>
      <form class="card" id="admin-login">
        ${msg ? `<div class="form-error">${esc(msg)}</div>` : ""}
        <div class="field"><label for="akey">Admin password</label><input id="akey" type="password" autocomplete="current-password" required /></div>
        <button class="btn btn-block" type="submit">Log in</button>
        ${live ? "" : `<p class="hint">Demo mode password: <code>admin</code></p>`}
      </form>`);
    document.getElementById("admin-login").addEventListener("submit", (e) => {
      e.preventDefault(); setKey(document.getElementById("akey").value); viewAdmin();
    });
  }

  async function viewAdmin(showAll) {
    const key = getKey();
    if (!key) return viewAdminLogin();
    let games;
    try { games = await rpc("admin_overview", { p_key: key }); }
    catch (e) { setKey(null); return viewAdminLogin(e.message); }
    const upcoming = games.filter((g) => !isPast(g.starts_at));
    const list = showAll ? games : upcoming;

    setView(`
      <div class="page-title"><h1>Admin</h1>
        <div class="btn-row">
          <button class="btn btn-small ${showAll ? "btn-ghost" : ""}" data-filter="up">Upcoming (${upcoming.length})</button>
          <button class="btn btn-small ${showAll ? "" : "btn-ghost"}" data-filter="all">All (${games.length})</button>
          <button class="btn btn-small btn-ghost" id="admin-out">Log out</button>
        </div></div>
      ${list.length ? list.map((g) => `
        <div class="card">
          <div class="game-top"><span class="sport-chip">${esc(g.sport)}</span><span class="status ${g.status === "open" ? "approved" : "cancelled"}">${g.status === "open" ? "live" : esc(g.status)}</span></div>
          <div class="when">${fmtWhen(g.starts_at)}</div>
          ${gameMeta(g)}
          <div class="hint" style="margin-top:6px">Host contact: ${contactLink(g.host_contact)} · ${g.spots_filled}/${g.spots_needed} filled</div>
          ${g.notes ? `<div class="req-msg">${esc(g.notes)}</div>` : ""}
          ${g.removed_reason ? `<div class="warn">Removed: ${esc(g.removed_reason)}</div>` : ""}
          <div class="btn-row" style="margin-top:10px">
            ${g.status === "removed"
              ? `<button class="btn btn-ghost btn-small" data-game="${g.id}" data-remove="false">Restore game</button>`
              : `<button class="btn btn-danger btn-small" data-game="${g.id}" data-remove="true">Remove game</button>`}
          </div>
          ${g.requests.length ? `<details style="margin-top:10px"><summary>${g.requests.length} request${g.requests.length > 1 ? "s" : ""}</summary>
            ${g.requests.map((r) => `<div class="req">
              <div class="req-head"><span class="req-name">${esc(r.player_name)} <span class="hint">· ${esc(r.level)} · ${esc(r.player_contact)}</span></span><span class="status ${esc(r.status)}">${esc(r.status)}</span></div>
              ${r.message ? `<div class="req-msg">${esc(r.message)}</div>` : ""}
              ${r.status === "removed"
                ? `<button class="btn btn-ghost btn-small" data-req="${r.id}" data-remove="false">Restore request</button>`
                : `<button class="btn btn-danger btn-small" data-req="${r.id}" data-remove="true">Remove request</button>`}
            </div>`).join("")}</details>` : ""}
        </div>`).join("") : `<div class="card empty"><p class="muted">No games here.</p></div>`}`);

    app.querySelector("[data-filter=up]").addEventListener("click", () => viewAdmin(false));
    app.querySelector("[data-filter=all]").addEventListener("click", () => viewAdmin(true));
    document.getElementById("admin-out").addEventListener("click", () => { setKey(null); location.hash = "#/"; });
    app.querySelectorAll("[data-game]").forEach((b) => b.addEventListener("click", async () => {
      const remove = b.dataset.remove === "true";
      let reason = null;
      if (remove) { reason = prompt("Reason for removing (only visible to admins):", "Inappropriate content"); if (reason === null) return; }
      try { await rpc("admin_set_game", { p_key: key, p_game: b.dataset.game, p_remove: remove, p_reason: reason }); toast(remove ? "Game removed" : "Game restored"); viewAdmin(showAll); }
      catch (e) { toast(e.message); }
    }));
    app.querySelectorAll("[data-req]").forEach((b) => b.addEventListener("click", async () => {
      const remove = b.dataset.remove === "true";
      if (remove && !confirm("Remove this request? The player will see it was removed.")) return;
      try { await rpc("admin_set_request", { p_key: key, p_request: b.dataset.req, p_remove: remove }); toast(remove ? "Request removed" : "Request restored"); viewAdmin(showAll); }
      catch (e) { toast(e.message); }
    }));
  }

  // ---------- Router ----------
  function route() {
    // Supabase password-reset links arrive as #access_token=...&type=recovery
    if (/access_token=|type=recovery|error_description=/.test(location.hash)) {
      if (/error_description=/.test(location.hash)) return errorView("This link is invalid or has expired. Please request a new one.");
      return loading();
    }
    const [path, query] = (location.hash.slice(1) || "/").split("?");
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "host") return viewHost();
    if (parts[0] === "signup") return viewSignup();
    if (parts[0] === "login") return viewLogin();
    if (parts[0] === "forgot") return viewForgot();
    if (parts[0] === "reset") return viewResetPassword();
    if (parts[0] === "me") { loading(); return viewMe(); }
    if (parts[0] === "game" && parts[1]) return viewGame(parts[1]);
    if (parts[0] === "request" && parts[1]) return viewRequest(parts[1], parts[2], /new=1/.test(query || ""));
    if (parts[0] === "admin") { loading(); return viewAdmin(false); }
    if (parts[0] === "manage" && parts[1]) { loading(); return viewManage(parts[1], parts[2]); }
    return viewHome();
  }

  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) { e.preventDefault(); copy(c.dataset.copy); return; }
    const s = e.target.closest("[data-scroll]");
    if (s) { e.preventDefault(); const el = document.getElementById(s.dataset.scroll); if (el) el.scrollIntoView({ behavior: "smooth" }); }
  });
  window.addEventListener("hashchange", route);
  authApi.onChange((event) => {
    if (event === "PASSWORD_RECOVERY") { loadMe().then(() => { location.hash = "#/reset"; }); return; }
    if (event === "SIGNED_OUT") { me = null; renderNav(); }
  });
  renderNav();
  loading();
  loadMe().finally(route);
})();
