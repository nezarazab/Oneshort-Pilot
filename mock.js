// DEMO backend: mimics the Supabase functions using this browser's storage.
// Only used when config.js has no Supabase URL.
window.OneShortMock = (function () {
  const KEY = "oneshort-demo-db";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { games: [], requests: [] }; } catch { return { games: [], requests: [] }; } };
  const save = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
  const fail = (m) => { throw new Error(m); };
  const filled = (db, g) => db.requests.filter((r) => r.game_id === g && r.status === "approved").length;
  const pub = (db, g) => ({ id: g.id, sport: g.sport, location: g.location, starts_at: g.starts_at, spots_needed: g.spots_needed, level: g.level, host_name: g.host_name, cost_per_player: g.cost_per_player, notes: g.notes, spots_filled: filled(db, g.id), status: g.status, lat: g.lat ?? null, lng: g.lng ?? null });

  const fns = {
    list_games(_, db) {
      const cutoff = Date.now() - 2 * 3600e3;
      return db.games.filter((g) => g.status === "open" && new Date(g.starts_at) > cutoff)
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).map((g) => pub(db, g));
    },
    get_game({ p_id }, db) { const g = db.games.find((x) => x.id === p_id); return g ? [pub(db, g)] : []; },
    create_game(p, db) {
      if (new Date(p.p_starts_at) < Date.now()) fail("The game time must be in the future.");
      const g = { id: uid(), host_token: uid(), sport: p.p_sport, location: p.p_location, starts_at: p.p_starts_at, spots_needed: p.p_spots, level: p.p_level, host_name: p.p_host_name, host_contact: p.p_host_contact, cost_per_player: p.p_cost || null, notes: p.p_notes || null, lat: p.p_lat ?? null, lng: p.p_lng ?? null, status: "open", created_at: new Date().toISOString() };
      db.games.push(g); return [{ id: g.id, host_token: g.host_token }];
    },
    request_spot(p, db) {
      const g = db.games.find((x) => x.id === p.p_game);
      if (!g || g.status !== "open") fail("This game is not available.");
      if (new Date(g.starts_at) < Date.now()) fail("This game has already started.");
      if (filled(db, g.id) >= g.spots_needed) fail("Sorry, this game is already full.");
      if (db.requests.some((r) => r.game_id === g.id && r.player_contact.toLowerCase() === p.p_contact.trim().toLowerCase() && ["pending", "approved"].includes(r.status))) fail("You already requested a spot in this game.");
      const r = { id: uid(), player_token: uid(), game_id: g.id, player_name: p.p_name, player_contact: p.p_contact.trim(), level: p.p_level, message: p.p_message || null, status: "pending", attended: null, created_at: new Date().toISOString(), decided_at: null };
      db.requests.push(r); return [{ id: r.id, player_token: r.player_token }];
    },
    request_status({ p_id, p_token }, db) {
      const r = db.requests.find((x) => x.id === p_id && x.player_token === p_token); if (!r) fail("Request not found.");
      const g = db.games.find((x) => x.id === r.game_id);
      return { status: r.status, player_name: r.player_name, created_at: r.created_at, decided_at: r.decided_at, game: { id: g.id, sport: g.sport, location: g.location, starts_at: g.starts_at, host_name: g.host_name, status: g.status, cost_per_player: g.cost_per_player, lat: g.lat ?? null, lng: g.lng ?? null }, host_contact: r.status === "approved" ? g.host_contact : null };
    },
    withdraw_request({ p_id, p_token }, db) {
      const r = db.requests.find((x) => x.id === p_id && x.player_token === p_token && ["pending", "approved"].includes(x.status));
      if (!r) fail("Request not found or already closed."); r.status = "withdrawn";
    },
    host_view({ p_game, p_token }, db) {
      const g = db.games.find((x) => x.id === p_game && x.host_token === p_token); if (!g) fail("Invalid host link.");
      return { game: pub(db, g), requests: db.requests.filter((r) => r.game_id === g.id).map(({ player_token, game_id, ...r }) => r) };
    },
    host_decide({ p_request, p_token, p_decision }, db) {
      const r = db.requests.find((x) => x.id === p_request); const g = r && db.games.find((x) => x.id === r.game_id && x.host_token === p_token);
      if (!g) fail("Invalid host link.");
      if (!["pending", "approved", "declined"].includes(r.status)) fail("This request is no longer active.");
      if (p_decision === "approved" && r.status !== "approved" && filled(db, g.id) >= g.spots_needed) fail("The game is already full.");
      r.status = p_decision; r.decided_at = r.decided_at || new Date().toISOString();
    },
    host_mark_attendance({ p_request, p_token, p_attended }, db) {
      const r = db.requests.find((x) => x.id === p_request); const g = r && db.games.find((x) => x.id === r.game_id && x.host_token === p_token);
      if (!g || r.status !== "approved") fail("Only approved players can be marked."); r.attended = p_attended;
    },
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
    host_cancel_game({ p_game, p_token }, db) {
      const g = db.games.find((x) => x.id === p_game && x.host_token === p_token && x.status === "open"); if (!g) fail("This game can no longer be changed."); g.status = "cancelled";
    },
  };

  return {
    async rpc(name, params = {}) {
      await new Promise((r) => setTimeout(r, 150));
      const db = load(); const out = fns[name](params, db); save(db); return out;
    },
  };
})();
