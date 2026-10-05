/* OneShort pilot — app logic (plain JavaScript, no build step) */
(function () {
  "use strict";

  // ---------- Backend ----------
  const cfg = window.ONESHORT_CONFIG || {};
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

  // "My games / requests" remembered in this browser (convenience only)
  const MINE = "oneshort-mine";
  const getMine = () => { try { return JSON.parse(localStorage.getItem(MINE)) || { games: [], requests: [] }; } catch { return { games: [], requests: [] }; } };
  const addMine = (kind, item) => { try { const m = getMine(); m[kind] = [item, ...m[kind].filter((x) => x.id !== item.id)].slice(0, 20); localStorage.setItem(MINE, JSON.stringify(m)); } catch {} };

  const setView = (html) => { app.innerHTML = html; window.scrollTo(0, 0); };
  const loading = () => setView(`<div class="loading">Loading…</div>`);
  const errorView = (msg) => setView(`<div class="page-title"><h1>Oops</h1></div><div class="card"><p>${esc(msg)}</p><a class="btn" href="#/">Back to games</a></div>`);

  function spotsBlock(g) {
    const left = Math.max(0, g.spots_needed - g.spots_filled);
    const pct = Math.min(100, Math.round((g.spots_filled / g.spots_needed) * 100));
    return `<div class="spots"><div class="spots-bar"><i style="width:${pct}%"></i></div>
      <div class="spots-text ${left ? "" : "full"}">${left ? `${left} of ${g.spots_needed} spot${g.spots_needed > 1 ? "s" : ""} left` : "Full"}</div></div>`;
  }
  function gameMeta(g) {
    return `<div class="meta"><span>📍 ${esc(g.location)}</span><span>🎯 ${esc(g.level)}</span>${g.cost_per_player ? `<span>💶 ${esc(g.cost_per_player)}</span>` : ""}<span>👤 ${esc(g.host_name)}</span></div>`;
  }

  // ---------- Views ----------

  async function viewHome() {
    const mine = getMine();
    const mineHtml = mine.games.length || mine.requests.length ? `
      <div class="section-head"><h2>Your activity</h2></div>
      <div class="card mine">
        ${mine.games.map((g) => `<a href="#/manage/${g.id}/${g.token}"><span><b>Hosting:</b> ${esc(g.sport)} · ${fmtWhen(g.starts_at)}</span><span>Manage →</span></a>`).join("")}
        ${mine.requests.map((r) => `<a href="#/request/${r.id}/${r.token}"><span><b>Requested:</b> ${esc(r.sport)} · ${fmtWhen(r.starts_at)}</span><span>Status →</span></a>`).join("")}
      </div>` : "";

    setView(`
      <section class="hero">
        <span class="pill-badge">● Pilot · Eindhoven</span>
        <h1>Short a player?<br><em>Not anymore.</em></h1>
        <p>Post your game, players nearby request a spot, you pick who joins. Any sport.</p>
        <div class="btn-row">
          <a class="btn" href="#games" data-scroll="games">Find a game</a>
          <a class="btn btn-ghost" href="#/host">Host a game</a>
        </div>
      </section>
      <div class="steps">
        <div class="step"><b>1</b><span>Host posts a game and how many players they need</span></div>
        <div class="step"><b>2</b><span>Players request a spot</span></div>
        <div class="step"><b>3</b><span>Host approves, you get each other's contact. Play!</span></div>
      </div>
      ${mineHtml}
      <div class="section-head" id="games"><h2>Open games</h2><a href="#/host">+ Host</a></div>
      <div id="game-list"><div class="loading">Loading games…</div></div>
    `);

    try {
      const games = await rpc("list_games");
      const list = document.getElementById("game-list");
      if (!list) return;
      list.innerHTML = games.length ? games.map((g) => `
        <a class="card game-card" href="#/game/${g.id}">
          <div class="game-top"><span class="sport-chip">${esc(g.sport)}</span>${isPast(g.starts_at) ? `<span class="status pending">Started</span>` : ""}</div>
          <div class="when">${fmtWhen(g.starts_at)}</div>
          ${gameMeta(g)}
          ${spotsBlock(g)}
        </a>`).join("") : `
        <div class="card empty"><div class="big">⚽</div><h3>No open games yet</h3>
          <p class="muted">Be the first. Post a game and share it in your group chat.</p>
          <a class="btn" href="#/host">Host a game</a></div>`;
    } catch (e) {
      const list = document.getElementById("game-list");
      if (list) list.innerHTML = `<div class="form-error">Could not load games: ${esc(e.message)}</div>`;
    }
  }

  function viewHost() {
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
          <input id="sport" name="sport" required maxlength="40" placeholder="e.g. Football" autocomplete="off" />
          <div class="chips">${["Football", "Padel", "Basketball", "Volleyball", "Tennis"].map((s) => `<button type="button" class="chip" data-sport="${s}">${s}</button>`).join("")}</div>
        </div>
        <div class="grid-2">
          <div class="field"><label for="when">Date & time</label><input id="when" name="when" type="datetime-local" required value="${defaultWhen}" /></div>
          <div class="field"><label for="spots">Players needed</label><input id="spots" name="spots" type="number" min="1" max="30" value="2" required /></div>
        </div>
        <div class="field"><label for="location">Location</label><input id="location" name="location" required maxlength="120" placeholder="e.g. Genneper Parken, field 3" /></div>
        <div class="grid-2">
          <div class="field"><label for="level">Level</label>
            <select id="level" name="level"><option>Any</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></div>
          <div class="field"><label for="cost">Cost per player <span class="hint">(optional)</span></label><input id="cost" name="cost" maxlength="40" placeholder="e.g. €3 or Free" /></div>
        </div>
        <div class="field"><label for="notes">Notes <span class="hint">(optional)</span></label><textarea id="notes" name="notes" maxlength="500" placeholder="e.g. 5v5, bring a dark and a light shirt"></textarea></div>
        <div class="grid-2">
          <div class="field"><label for="hname">Your name</label><input id="hname" name="hname" required maxlength="60" autocomplete="given-name" /></div>
          <div class="field"><label for="hcontact">Phone (WhatsApp) or email</label><input id="hcontact" name="hcontact" required maxlength="100" placeholder="06 12345678" autocomplete="tel" /></div>
        </div>
        <p class="hint">Your contact is only shown to players you approve.</p>
        <button class="btn btn-block" type="submit">Post game</button>
      </form>`);

    app.querySelectorAll("[data-sport]").forEach((b) => b.addEventListener("click", () => { document.getElementById("sport").value = b.dataset.sport; }));
    document.getElementById("host-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.target, btn = f.querySelector("[type=submit]"), errBox = document.getElementById("form-error");
      const v = (n) => f.elements[n].value.trim();
      const missing = ["sport", "when", "spots", "location", "hname", "hcontact"].filter((n) => !v(n));
      if (missing.length) { errBox.innerHTML = `<div class="form-error">Please fill in all required fields.</div>`; f.elements[missing[0]].focus(); return; }
      const when = new Date(v("when"));
      if (isNaN(when) || when < new Date()) { errBox.innerHTML = `<div class="form-error">Pick a date and time in the future.</div>`; return; }
      const spots = parseInt(v("spots"), 10);
      if (!(spots >= 1 && spots <= 30)) { errBox.innerHTML = `<div class="form-error">Players needed must be between 1 and 30.</div>`; return; }
      btn.disabled = true; btn.textContent = "Posting…";
      try {
        const res = await rpc("create_game", {
          p_sport: v("sport"), p_location: v("location"), p_starts_at: when.toISOString(), p_spots: spots,
          p_level: v("level"), p_host_name: v("hname"), p_host_contact: v("hcontact"), p_cost: v("cost") || null, p_notes: v("notes") || null,
        });
        const row = Array.isArray(res) ? res[0] : res;
        addMine("games", { id: row.id, token: row.host_token, sport: v("sport"), starts_at: when.toISOString() });
        viewHostCreated(row.id, row.host_token, { sport: v("sport"), starts_at: when.toISOString(), location: v("location"), spots });
      } catch (e) {
        errBox.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
        btn.disabled = false; btn.textContent = "Post game";
      }
    });
  }

  function shareText(g, id) {
    return `${g.sport} · ${fmtWhen(g.starts_at)} · ${g.location}\nNeed ${g.spots} player${g.spots > 1 ? "s" : ""}! Request a spot on OneShort: ${base()}#/game/${id}`;
  }

  function viewHostCreated(id, token, g) {
    const manage = `${base()}#/manage/${id}/${token}`;
    setView(`
      <div class="page-title"><h1>Your game is live 🎉</h1></div>
      <div class="card success">
        <h2>1. Save your host link</h2>
        <p>This private link is how you approve players. <b>Anyone with it can manage your game</b>, so don't share it.</p>
        <div class="linkbox"><input readonly value="${esc(manage)}" aria-label="Host link" /><button class="btn btn-dark btn-small" data-copy="${esc(manage)}">Copy</button></div>
        <div class="btn-row"><a class="btn btn-wa btn-small" target="_blank" rel="noopener" href="${waShare("My OneShort host link (private): " + manage)}">Send to myself on WhatsApp</a></div>
      </div>
      <div class="card">
        <h2>2. Share the game</h2>
        <p class="muted">Post it in your group chat so players can request a spot.</p>
        <div class="btn-row">
          <a class="btn btn-wa" target="_blank" rel="noopener" href="${waShare(shareText(g, id))}">Share on WhatsApp</a>
          <button class="btn btn-ghost" data-copy="${esc(base() + "#/game/" + id)}">Copy game link</button>
        </div>
      </div>
      <a class="btn btn-block" href="#/manage/${id}/${token}">Go to my game →</a>`);
  }

  async function viewGame(id) {
    loading();
    let g;
    try { const r = await rpc("get_game", { p_id: id }); g = Array.isArray(r) ? r[0] : r; } catch (e) { return errorView(e.message); }
    if (!g) return errorView("This game doesn't exist (anymore).");
    const left = g.spots_needed - g.spots_filled;
    const closed = g.status !== "open" || isPast(g.starts_at) || left <= 0;
    const reason = g.status !== "open" ? "This game was cancelled by the host." : isPast(g.starts_at) ? "This game has already started." : "This game is full.";
    const share = `${base()}#/game/${g.id}`;

    setView(`
      <a class="back" href="#/">← All games</a>
      <div class="page-title"><span class="sport-chip">${esc(g.sport)}</span><h1 style="margin-top:12px">${fmtWhen(g.starts_at)}</h1>${gameMeta(g)}</div>
      <div class="card">${spotsBlock(g)}${g.notes ? `<p class="req-msg">${esc(g.notes)}</p>` : ""}
        <div class="btn-row" style="margin-top:12px"><a class="btn btn-wa btn-small" target="_blank" rel="noopener" href="${waShare(`${g.sport} · ${fmtWhen(g.starts_at)} · ${g.location}\nRequest a spot: ${share}`)}">Share</a></div></div>
      ${closed ? `<div class="card empty"><h3>${reason}</h3><a class="btn" href="#/">See other games</a></div>` : `
      <form class="card" id="req-form" novalidate>
        <h2>Request a spot</h2>
        <p class="muted">${esc(g.host_name)} will approve or decline. Once approved you'll see their contact.</p>
        <div id="form-error"></div>
        <div class="grid-2">
          <div class="field"><label for="pname">Your name</label><input id="pname" required maxlength="60" autocomplete="given-name" /></div>
          <div class="field"><label for="pcontact">Phone (WhatsApp) or email</label><input id="pcontact" required maxlength="100" placeholder="06 12345678" autocomplete="tel" /></div>
        </div>
        <div class="field"><label for="plevel">Your level in ${esc(g.sport)}</label>
          <select id="plevel"><option>Beginner</option><option selected>Intermediate</option><option>Advanced</option></select></div>
        <div class="field"><label for="pmsg">Message to host <span class="hint">(optional)</span></label><textarea id="pmsg" maxlength="300" placeholder="e.g. I usually play as a defender"></textarea></div>
        <button class="btn btn-block" type="submit">Request spot</button>
      </form>`}`);

    const form = document.getElementById("req-form");
    if (!form) return;
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector("[type=submit]"), errBox = document.getElementById("form-error");
      const name = document.getElementById("pname").value.trim(), contact = document.getElementById("pcontact").value.trim();
      if (!name || contact.length < 3) { errBox.innerHTML = `<div class="form-error">Please fill in your name and contact.</div>`; return; }
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        const res = await rpc("request_spot", { p_game: g.id, p_name: name, p_contact: contact, p_level: document.getElementById("plevel").value, p_message: document.getElementById("pmsg").value.trim() || null });
        const row = Array.isArray(res) ? res[0] : res;
        addMine("requests", { id: row.id, token: row.player_token, sport: g.sport, starts_at: g.starts_at });
        location.hash = `#/request/${row.id}/${row.player_token}?new=1`;
      } catch (e) {
        errBox.innerHTML = `<div class="form-error">${esc(e.message)}</div>`;
        btn.disabled = false; btn.textContent = "Request spot";
      }
    });
  }

  async function viewRequest(id, token, isNew) {
    loading();
    let s;
    try { s = await rpc("request_status", { p_id: id, p_token: token }); } catch (e) { return errorView(e.message); }
    const g = s.game, link = `${base()}#/request/${id}/${token}`;
    const text = {
      pending: `Waiting for ${esc(g.host_name)} to respond. Check back on this page.`,
      approved: `You're in! Contact ${esc(g.host_name)} to confirm the details.`,
      declined: `${esc(g.host_name)} couldn't fit you in this time. Try another game!`,
      withdrawn: `You withdrew from this game.`,
    }[s.status];
    setView(`
      <a class="back" href="#/">← All games</a>
      <div class="page-title"><h1>${isNew ? "Request sent ✅" : "Your request"}</h1></div>
      <div class="card ${s.status === "approved" ? "success" : ""}">
        <div class="game-top"><span class="sport-chip">${esc(g.sport)}</span><span class="status ${g.status === "cancelled" ? "cancelled" : s.status}">${g.status === "cancelled" ? "Game cancelled" : s.status}</span></div>
        <div class="when">${fmtWhen(g.starts_at)}</div>
        <div class="meta"><span>📍 ${esc(g.location)}</span>${g.cost_per_player ? `<span>💶 ${esc(g.cost_per_player)}</span>` : ""}</div>
        <p>${text}</p>
        ${s.status === "approved" && s.host_contact ? `<p><b>Host contact:</b> ${contactLink(s.host_contact)}</p>` : ""}
      </div>
      <div class="card">
        <h3>Save this page</h3>
        <p class="muted">Bookmark it or send it to yourself to check if you're approved.</p>
        <div class="linkbox"><input readonly value="${esc(link)}" aria-label="Status link" /><button class="btn btn-dark btn-small" data-copy="${esc(link)}">Copy</button></div>
        <div class="btn-row"><a class="btn btn-wa btn-small" target="_blank" rel="noopener" href="${waShare("My OneShort request: " + link)}">Send to myself on WhatsApp</a>
        <button class="btn btn-ghost btn-small" id="refresh">Refresh status</button></div>
      </div>
      ${["pending", "approved"].includes(s.status) && g.status === "open" && !isPast(g.starts_at) ? `<button class="btn btn-danger btn-block" id="withdraw">Can't make it? Withdraw</button>` : ""}`);

    document.getElementById("refresh").addEventListener("click", () => viewRequest(id, token, false));
    const w = document.getElementById("withdraw");
    if (w) w.addEventListener("click", async () => {
      if (!confirm("Withdraw from this game? The host will see that you can't make it.")) return;
      try { await rpc("withdraw_request", { p_id: id, p_token: token }); toast("You withdrew"); viewRequest(id, token, false); } catch (e) { toast(e.message); }
    });
  }

  async function viewManage(id, token) {
    let data;
    try { data = await rpc("host_view", { p_game: id, p_token: token }); } catch (e) { return errorView(e.message); }
    const g = data.game, reqs = data.requests;
    const past = isPast(g.starts_at), cancelled = g.status !== "open";
    const left = g.spots_needed - g.spots_filled;
    const pending = reqs.filter((r) => r.status === "pending").length;
    const order = { pending: 0, approved: 1, declined: 2, withdrawn: 3 };
    reqs.sort((a, b) => order[a.status] - order[b.status] || new Date(a.created_at) - new Date(b.created_at));
    addMine("games", { id, token, sport: g.sport, starts_at: g.starts_at });

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
      <div class="page-title"><span class="sport-chip">${esc(g.sport)}</span> ${cancelled ? `<span class="status cancelled">Cancelled</span>` : ""}
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
      <p class="hint">🔒 This is your private host page. Keep the link to yourself.</p>
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

  // ---------- Router ----------
  function route() {
    const [path, query] = (location.hash.slice(1) || "/").split("?");
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "host") return viewHost();
    if (parts[0] === "game" && parts[1]) return viewGame(parts[1]);
    if (parts[0] === "request" && parts[2]) return viewRequest(parts[1], parts[2], /new=1/.test(query || ""));
    if (parts[0] === "manage" && parts[2]) { loading(); return viewManage(parts[1], parts[2]); }
    return viewHome();
  }

  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) { e.preventDefault(); copy(c.dataset.copy); return; }
    const s = e.target.closest("[data-scroll]");
    if (s) { e.preventDefault(); const el = document.getElementById(s.dataset.scroll); if (el) el.scrollIntoView({ behavior: "smooth" }); }
  });
  window.addEventListener("hashchange", route);
  route();
})();
