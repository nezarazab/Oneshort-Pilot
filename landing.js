// Landing pages (football/padel, English/Dutch): GA page view + the live open games for one sport.
// Plain JS, no build step. Reads config.js like app.js does; the game links open the app.
(function () {
  const cfg = window.ONESHORT_CONFIG || {};
  const nl = document.documentElement.lang === "nl";

  // GA4, same rules as app.js: only when GA_ID is set, one clean page_view (no IDs, no personal data).
  const GA_ID = String(cfg.GA_ID || "").trim();
  if (GA_ID) {
    const s = document.createElement("script");
    s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { send_page_view: false });
    window.gtag("event", "page_view", { page_location: location.origin + location.pathname, page_title: document.title });
  }

  const list = document.getElementById("game-list");
  if (!list) return;
  const SPORT = { football: /foot|soccer|futsal|voetbal/i, padel: /padel/i }[list.dataset.sport];
  const t = nl
    ? { none: "Op dit moment staan er geen open potjes.", host: "Zet zelf een potje op", fail: "Bekijk alle open potjes", left: (n) => `${n} plek${n > 1 ? "ken" : ""} vrij`, locale: "nl-NL" }
    : { none: "No open games right now.", host: "Host one yourself", fail: "See all open games", left: (n) => `${n} spot${n > 1 ? "s" : ""} left`, locale: "en-GB" };
  const fallback = (msg) => { list.innerHTML = `<div class="card empty"><h3>${msg}</h3><a class="btn" href="/#/host">${t.host}</a> <a class="btn btn-ghost" href="/#/">${t.fail}</a></div>`; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const part = (d, o) => d.toLocaleString(t.locale, { ...o, timeZone: "Europe/Amsterdam" });

  if (!SPORT || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return fallback(t.none);
  const base = /^https?:\/\//.test(cfg.SUPABASE_URL) ? cfg.SUPABASE_URL.trim() : "https://" + cfg.SUPABASE_URL.trim();
  fetch(base + "/rest/v1/rpc/list_games", {
    method: "POST", body: "{}",
    headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((games) => {
      const open = games.filter((g) => SPORT.test(g.sport) && new Date(g.starts_at) > new Date() && g.spots_needed > g.spots_filled);
      if (!open.length) return fallback(t.none);
      list.innerHTML = open.slice(0, 6).map((g) => {
        const d = new Date(g.starts_at), [venue, ...rest] = String(g.location).split(",");
        const sportCls = list.dataset.sport === "padel" ? "sport-padel" : "sport-football";
        return `<a class="card game-card sport-bg ${sportCls}" href="/#/game/${encodeURIComponent(g.id)}">
          <div class="date-tile"><span>${part(d, { weekday: "short" })}</span><b>${part(d, { day: "numeric" })}</b><span>${part(d, { month: "short" })}</span></div>
          <div class="game-body">
            <div class="game-top"><span class="sport-chip">${esc(g.sport)}</span><span class="arr">→</span></div>
            <div class="when">${part(d, { hour: "2-digit", minute: "2-digit" })}</div>
            <div class="meta"><div class="loc"><div><span class="venue">${esc(venue.trim())}</span>${rest.length ? `<span class="addr">${esc(rest.join(",").trim())}</span>` : ""}</div></div>
              <div class="tags"><span class="tag level-${esc(String(g.level).toLowerCase())}">${esc(g.level)}</span></div></div>
            <div class="spots-text">${t.left(g.spots_needed - g.spots_filled)}</div>
          </div></a>`;
      }).join("");
    })
    .catch(() => fallback(t.none));
})();
