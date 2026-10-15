// DEMO backend: mimics the Supabase functions and login using this browser's storage.
// Only used when config.js has no Supabase URL.
window.OneShortMock = (function () {
  const KEY = "oneshort-demo-db", SESSION = "oneshort-demo-session";
  const empty = () => ({ games: [], requests: [], users: [], profiles: [] });
  const load = () => { try { return Object.assign(empty(), JSON.parse(localStorage.getItem(KEY)) || {}); } catch { return empty(); } };
  const save = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
  const fail = (m) => { throw new Error(m); };
  const currentUid = () => { try { return localStorage.getItem(SESSION); } catch { return null; } };
  const filled = (db, g) => db.requests.filter((r) => r.game_id === g && r.status === "approved").length;
  const pub = (db, g) => ({ id: g.id, sport: g.sport, location: g.location, starts_at: g.starts_at, spots_needed: g.spots_needed, level: g.level, host_name: g.host_name, cost_per_player: g.cost_per_player, notes: g.notes, spots_filled: filled(db, g.id), status: g.status, lat: g.lat ?? null, lng: g.lng ?? null });
  const contactOf = (db, id) => { const p = db.profiles.find((x) => x.id === id); const u = db.users.find((x) => x.id === id); return (p && p.phone) || (u && u.email); };
  const meOrFail = (db) => {
    const id = currentUid(); if (!id) fail("Please log in first.");
    const p = db.profiles.find((x) => x.id === id); if (!p) fail("Please complete your profile first."); return p;
  };
  const ownsGame = (g, token) => (token && g.host_token === token) || (g.host_id && g.host_id === currentUid());
  const ownsReq = (r, token) => (token && r.player_token === token) || (r.player_id && r.player_id === currentUid());
  const recent = (iso) => new Date(iso) > Date.now() - 14 * 864e5;

  const fns = {
    list_games(_, db) {
      const cutoff = Date.now() - 2 * 3600e3;
      return db.games.filter((g) => g.status === "open" && new Date(g.starts_at) > cutoff)
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).map((g) => pub(db, g));
    },
    get_game({ p_id }, db) {
      const g = db.games.find((x) => x.id === p_id); if (!g) return [];
      const me = currentUid();
      const r = me ? db.requests.filter((x) => x.game_id === g.id && x.player_id === me).pop() : null;
      return [{ ...pub(db, g), is_host: !!(me && g.host_id === me), my_request_id: r ? r.id : null, my_request_status: r ? r.status : null }];
    },
    // ----- accounts -----
    my_profile(_, db) {
      const id = currentUid(); if (!id) return null;
      const p = db.profiles.find((x) => x.id === id); const u = db.users.find((x) => x.id === id);
      return p ? { name: p.name, phone: p.phone, fav_sport: p.fav_sport, level: p.level, email: u.email } : null;
    },
    save_profile(p, db) {
      const id = currentUid(); if (!id) fail("Please log in first.");
      const row = { id, name: p.p_name.trim(), phone: (p.p_phone || "").trim() || null, fav_sport: p.p_sport.trim(), level: p.p_level };
      db.profiles = db.profiles.filter((x) => x.id !== id).concat(row);
      db.games.filter((g) => g.host_id === id && g.status === "open").forEach((g) => { g.host_name = row.name; g.host_contact = contactOf(db, id); });
      return fns.my_profile(null, db);
    },
    post_game(p, db) {
      const me = meOrFail(db);
      if (new Date(p.p_starts_at) < Date.now()) fail("The game time must be in the future.");
      const g = { id: uid(), host_token: uid(), host_id: me.id, sport: p.p_sport, location: p.p_location, starts_at: p.p_starts_at, spots_needed: p.p_spots, level: p.p_level, host_name: me.name, host_contact: contactOf(db, me.id), cost_per_player: p.p_cost || null, notes: p.p_notes || null, lat: p.p_lat ?? null, lng: p.p_lng ?? null, status: "open", created_at: new Date().toISOString() };
      db.games.push(g); return g.id;
    },
    join_game(p, db) {
      const me = meOrFail(db);
      const g = db.games.find((x) => x.id === p.p_game);
      if (!g || g.status !== "open") fail("This game is not available.");
      if (g.host_id === me.id) fail("This is your own game.");
      if (new Date(g.starts_at) < Date.now()) fail("This game has already started.");
      if (filled(db, g.id) >= g.spots_needed) fail("Sorry, this game is already full.");
      if (db.requests.some((r) => r.game_id === g.id && r.player_id === me.id && ["pending", "approved"].includes(r.status))) fail("You already requested a spot in this game.");
      const r = { id: uid(), player_token: uid(), player_id: me.id, game_id: g.id, player_name: me.name, player_contact: contactOf(db, me.id), level: p.p_level, message: p.p_message || null, status: "pending", attended: null, created_at: new Date().toISOString(), decided_at: null };
      db.requests.push(r); return r.id;
    },
    guest_request(p, db) {
      const name = (p.p_name || "").trim(), phone = (p.p_phone || "").trim(), digits = phone.replace(/\D/g, "");
      if (!name || name.length > 60) fail("Please enter your name.");
      if (digits.length < 9 || digits.length > 15 || !/^\+?[0-9 ()-]+$/.test(phone)) fail("Please enter a valid phone number.");
      if (!["Beginner", "Intermediate", "Advanced"].includes(p.p_level)) fail("Pick your level.");
      const g = db.games.find((x) => x.id === p.p_game);
      if (!g || g.status !== "open") fail("This game is not available.");
      if (new Date(g.starts_at) < Date.now()) fail("This game has already started.");
      if (filled(db, g.id) >= g.spots_needed) fail("Sorry, this game is already full.");
      if (db.requests.some((r) => r.game_id === g.id && (r.player_contact || "").toLowerCase() === phone.toLowerCase() && ["pending", "approved"].includes(r.status))) fail("You already requested a spot in this game.");
      const r = { id: uid(), player_token: uid(), player_id: null, game_id: g.id, player_name: name, player_contact: phone, level: p.p_level, message: (p.p_message || "").trim() || null, status: "pending", attended: null, created_at: new Date().toISOString(), decided_at: null };
      db.requests.push(r); return { id: r.id, token: r.player_token };
    },
    my_activity(_, db) {
      const me = currentUid(); if (!me) return { hosting: [], requests: [] };
      const byTime = (a, b) => new Date(a.starts_at) - new Date(b.starts_at);
      return {
        hosting: db.games.filter((g) => g.host_id === me && recent(g.starts_at)).sort(byTime).map((g) => ({ id: g.id, sport: g.sport, location: g.location, starts_at: g.starts_at, status: g.status, spots_needed: g.spots_needed, spots_filled: filled(db, g.id), pending: db.requests.filter((r) => r.game_id === g.id && r.status === "pending").length })),
        requests: db.requests.filter((r) => r.player_id === me).map((r) => { const g = db.games.find((x) => x.id === r.game_id); return { id: r.id, status: r.status, sport: g.sport, location: g.location, starts_at: g.starts_at, game_status: g.status }; }).filter((r) => recent(r.starts_at)).sort(byTime),
      };
    },
    // ----- old guest functions (still used by old links) -----
    request_status({ p_id, p_token }, db) {
      const r = db.requests.find((x) => x.id === p_id && ownsReq(x, p_token)); if (!r) fail("Request not found.");
      const g = db.games.find((x) => x.id === r.game_id);
      return { status: r.status, player_name: r.player_name, created_at: r.created_at, decided_at: r.decided_at, game: { id: g.id, sport: g.sport, location: g.location, starts_at: g.starts_at, host_name: g.host_name, status: g.status, cost_per_player: g.cost_per_player, lat: g.lat ?? null, lng: g.lng ?? null }, host_contact: r.status === "approved" ? g.host_contact : null };
    },
    withdraw_request({ p_id, p_token }, db) {
      const r = db.requests.find((x) => x.id === p_id && ownsReq(x, p_token) && ["pending", "approved"].includes(x.status));
      if (!r) fail("Request not found or already closed."); r.status = "withdrawn";
    },
    host_view({ p_game, p_token }, db) {
      const g = db.games.find((x) => x.id === p_game && ownsGame(x, p_token)); if (!g) fail("You can only manage your own games.");
      return { game: pub(db, g), requests: db.requests.filter((r) => r.game_id === g.id).map(({ player_token, game_id, player_id, ...r }) => r) };
    },
    host_decide({ p_request, p_token, p_decision }, db) {
      const r = db.requests.find((x) => x.id === p_request); const g = r && db.games.find((x) => x.id === r.game_id && ownsGame(x, p_token));
      if (!g) fail("You can only manage your own games.");
      if (!["pending", "approved", "declined"].includes(r.status)) fail("This request is no longer active.");
      if (p_decision === "approved" && r.status !== "approved" && filled(db, g.id) >= g.spots_needed) fail("The game is already full.");
      r.status = p_decision; r.decided_at = r.decided_at || new Date().toISOString();
    },
    host_mark_attendance({ p_request, p_token, p_attended }, db) {
      const r = db.requests.find((x) => x.id === p_request); const g = r && db.games.find((x) => x.id === r.game_id && ownsGame(x, p_token));
      if (!g || r.status !== "approved") fail("Only approved players can be marked."); r.attended = p_attended;
    },
    host_cancel_game({ p_game, p_token }, db) {
      const g = db.games.find((x) => x.id === p_game && ownsGame(x, p_token) && x.status === "open"); if (!g) fail("This game can no longer be changed."); g.status = "cancelled";
    },
    // ----- admin (demo password: admin) -----
    admin_overview({ p_key }, db) {
      if (p_key !== "admin") fail("Wrong admin password.");
      return [...db.games].sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)).map((g) => ({ ...pub(db, g), host_contact: g.host_contact, removed_reason: g.removed_reason || null,
        requests: db.requests.filter((r) => r.game_id === g.id).map(({ player_token, game_id, ...r }) => r) }));
    },
    admin_set_game({ p_key, p_game, p_remove, p_reason }, db) {
      if (p_key !== "admin") fail("Wrong admin password.");
      const g = db.games.find((x) => x.id === p_game); if (!g) return;
      g.status = p_remove ? "removed" : "open"; g.removed_reason = p_remove ? p_reason : null;
    },
    admin_set_request({ p_key, p_request, p_remove }, db) {
      if (p_key !== "admin") fail("Wrong admin password.");
      const r = db.requests.find((x) => x.id === p_request); if (r) r.status = p_remove ? "removed" : "pending";
    },
  };

  const listeners = [];
  const emit = (ev) => listeners.forEach((f) => f(ev));
  const auth = {
    async getUser() {
      const id = currentUid(); if (!id) return null;
      const u = load().users.find((x) => x.id === id); return u ? { id: u.id, email: u.email } : null;
    },
    async signUp(email, password) {
      const db = load(); email = email.trim().toLowerCase();
      if (password.length < 6) fail("Password should be at least 6 characters.");
      if (db.users.some((u) => u.email === email)) fail("User already registered");
      const u = { id: uid(), email, password }; db.users.push(u); save(db);
      localStorage.setItem(SESSION, u.id); emit("SIGNED_IN");
      return { user: { id: u.id, email }, session: true };
    },
    async signIn(email, password) {
      const u = load().users.find((x) => x.email === email.trim().toLowerCase() && x.password === password);
      if (!u) fail("Invalid login credentials");
      localStorage.setItem(SESSION, u.id); emit("SIGNED_IN"); return { user: { id: u.id, email: u.email } };
    },
    async signOut() { localStorage.removeItem(SESSION); emit("SIGNED_OUT"); },
    async resetEmail() { /* demo: nothing is sent */ },
    async updatePassword(pw) {
      const db = load(); const u = db.users.find((x) => x.id === currentUid()); if (!u) fail("Please log in first.");
      u.password = pw; save(db);
    },
    onChange(cb) { listeners.push(cb); },
  };

  return {
    auth,
    async rpc(name, params = {}) {
      await new Promise((r) => setTimeout(r, 120));
      if (!fns[name]) fail("Unknown function " + name);
      const db = load(); const out = fns[name](params, db); save(db); return out;
    },
  };
})();
