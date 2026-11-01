// Yusup VPS NAT — Cloudflare Worker + D1
// Alur order diadaptasi dari SC Auto Order VPS NAT by @iwawv1

const enc = new TextEncoder();
const J = (d, s = 200, h = {}) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...h },
  });
class HttpError extends Error {
  constructor(s, m, extra) { super(m); this.status = s; this.extra = extra || {}; }
}
const fail = (s, m, e) => { throw new HttpError(s, m, e); };
const int = (v) => Math.floor(Number(v) || 0);
const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

/* ---------- schema ---------- */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0, ban_reason TEXT DEFAULT '', bc_read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS stok(id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, port TEXT, vuser TEXT, vpass TEXT, hostname TEXT, raw TEXT, status TEXT NOT NULL DEFAULT 'ready', order_id TEXT, created_at INTEGER, sold_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, qty INTEGER NOT NULL, unit_price INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, promo TEXT, status TEXT NOT NULL, proof TEXT, note TEXT, delivered TEXT, created_at INTEGER NOT NULL, proof_at INTEGER, decided_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY, type TEXT NOT NULL, value INTEGER NOT NULL, max_uses INTEGER, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS chat(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS notifs(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, body TEXT, kind TEXT DEFAULT 'info', read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rl(k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS i_orders_user ON orders(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS i_orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS i_stok_status ON stok(status)`,
  `CREATE INDEX IF NOT EXISTS i_notifs_user ON notifs(user_id, id)`,
];
const DEFAULTS = {
  site_name: "Yusup VPS NAT",
  product_name: "VPS NAT",
  price: "500",
  spec: "491GB RAM | 96-CORE CPU | NAT",
  provider: "YUSUP SERVER VPS NAT",
  maintenance: "0",
  maintenance_msg: "Website sedang maintenance. Coba lagi beberapa saat lagi.",
};
let ready = false;
async function init(env) {
  if (ready) return;
  const db = env.DB;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  await db.batch(Object.entries(DEFAULTS).map(([k, v]) => db.prepare("INSERT OR IGNORE INTO settings(k,v) VALUES(?,?)").bind(k, v)));
  const o = await db.prepare("SELECT id FROM users WHERE role='owner'").first();
  if (!o) {
    const name = (env.OWNER_USER || "Yusupboy").trim();
    const pass = env.OWNER_PASS || "memeksiapaitu";
    await db.prepare("INSERT OR IGNORE INTO users(username,pass,role,created_at) VALUES(?,?, 'owner', ?)")
      .bind(name, await hashPass(pass), Date.now()).run();
  }
  ready = true;
}
async function getSettings(db) {
  const { results } = await db.prepare("SELECT k,v FROM settings").all();
  const s = { ...DEFAULTS };
  for (const r of results) s[r.k] = r.v;
  return s;
}

/* ---------- crypto ---------- */
const toB64 = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
async function pbkdf2(pass, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
}
async function hashPass(pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return toB64(salt) + ":" + toB64(await pbkdf2(pass, salt));
}
async function checkPass(pass, stored) {
  const [s, h] = String(stored).split(":");
  const calc = toB64(await pbkdf2(pass, fromB64(s)));
  if (calc.length !== h.length) return false;
  let d = 0; for (let i = 0; i < h.length; i++) d |= calc.charCodeAt(i) ^ h.charCodeAt(i);
  return d === 0;
}
async function sha256hex(t) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t)));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const randHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, "0")).join("");
const genId = () => { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "VN"; for (let i = 0; i < 6; i++) s += c[crypto.getRandomValues(new Uint8Array(1))[0] % c.length]; return s; };

/* ---------- helpers ---------- */
async function readJson(req) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return {};
  try { return await req.json(); } catch { return {}; }
}
function getCookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
async function rateLimit(db, key, max, windowMs) {
  const now = Date.now();
  const r = await db.prepare("SELECT n,reset_at FROM rl WHERE k=?").bind(key).first();
  if (!r || r.reset_at < now) {
    await db.prepare("INSERT OR REPLACE INTO rl(k,n,reset_at) VALUES(?,1,?)").bind(key, now + windowMs).run();
    return;
  }
  if (r.n >= max) fail(429, "Terlalu banyak percobaan. Coba lagi nanti.");
  await db.prepare("UPDATE rl SET n=n+1 WHERE k=?").bind(key).run();
}
async function authUser(req, env) {
  const c = getCookie(req, "sid");
  if (!c) return null;
  const u = await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?")
    .bind(await sha256hex(c), Date.now()).first();
  if (!u) return null;
  if (u.banned) fail(403, "Akun kamu diblokir", { banned: true, reason: u.ban_reason || "" });
  return u;
}
const pubUser = (u) => u && { id: u.id, username: u.username, role: u.role };
async function startSession(env, uid) {
  const tok = randHex(32);
  await env.DB.prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)")
    .bind(await sha256hex(tok), uid, Date.now() + 30 * 864e5).run();
  return `sid=${tok}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`;
}
function dataUrlOk(s, max) {
  return typeof s === "string" && s.length <= max && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
}
function imageResponse(dataUrl) {
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  return new Response(fromB64(m[2]), { headers: { "content-type": m[1], "cache-control": "private, max-age=60" } });
}
function notif(db, userId, title, body, kind = "info") {
  return db.prepare("INSERT INTO notifs(user_id,title,body,kind,created_at) VALUES(?,?,?,?,?)").bind(userId, title, body, kind, Date.now());
}

/* ---------- VPS parser (dari parseVpsData script asli) ---------- */
function parseVps(raw) {
  const t = String(raw || "");
  const get = (keys) => {
    for (const k of keys) {
      const m = t.match(new RegExp("(?:^|\\n)[^\\n]*?(?:" + k + ")\\s*[:：=]\\s*(.+)", "i"));
      if (m) { const v = m[1].trim().replace(/\s{2,}.*/, "").trim(); if (v) return v; }
    }
    return "";
  };
  let ip = get(["IP Address", "IP Addr", "IP", "Host"]);
  if (!ip) { const m = t.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/); if (m) ip = m[1]; }
  let port = get(["Port SSH", "SSH Port", "Port"]);
  if (!port) { const m = t.match(/(?:-p\s+|port\s*[:：]?\s*)(\d{2,5})/i); if (m) port = m[1]; }
  const user = get(["Username", "User", "Login"]) || "root";
  let pass = get(["Password Baru", "New Password", "Password", "Pass", "Pwd", "Kata Sandi"]);
  return { ip: ip || "", port: port || "22", user, pass: pass || "", hostname: get(["Hostname", "Host Name"]), raw: t };
}
function parseBulk(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.every((l) => /^[^|\s]+\|\d{1,5}\|[^|]+\|.+$/.test(l))) {
    return lines.map((l) => { const [ip, port, user, ...p] = l.split("|"); return { ip, port, user, pass: p.join("|"), hostname: "", raw: l }; });
  }
  return t.split(/\n\s*(?:-{3,}|={3,})\s*\n/).map((b) => b.trim()).filter(Boolean).map(parseVps);
}

/* ---------- promo ---------- */
async function checkCode(db, codeStr, sub) {
  const code = str(codeStr, 30).toUpperCase();
  if (!code) return { ok: false, reason: "Kode kosong" };
  const c = await db.prepare("SELECT * FROM codes WHERE code=?").bind(code).first();
  if (!c) return { ok: false, reason: "Kode tidak ditemukan" };
  if (!c.active) return { ok: false, reason: "Kode nonaktif" };
  if (c.expires_at && Date.now() > c.expires_at) return { ok: false, reason: "Kode sudah kedaluwarsa" };
  if (c.max_uses != null && c.used >= c.max_uses) return { ok: false, reason: "Kuota kode sudah habis" };
  let d = c.type === "percent" ? Math.floor((sub * Math.min(100, c.value)) / 100) : Math.min(sub, c.value);
  d = Math.min(d, sub - 1);
  if (d <= 0) return { ok: false, reason: "Diskon tidak valid" };
  return { ok: true, code, discount: d, total: sub - d };
}
async function cleanupExpired(db) {
  const lim = Date.now() - 30 * 60 * 1000;
  await db.batch([
    db.prepare("UPDATE stok SET status='ready', order_id=NULL WHERE status='reserved' AND order_id IN (SELECT id FROM orders WHERE status='waiting_proof' AND created_at<?)").bind(lim),
    db.prepare("UPDATE orders SET status='expired' WHERE status='waiting_proof' AND created_at<?").bind(lim),
  ]);
}
const orderOut = (o) => ({
  id: o.id, qty: o.qty, unit_price: o.unit_price, discount: o.discount, total: o.total, promo: o.promo,
  status: o.status, note: o.note || "", created_at: o.created_at, decided_at: o.decided_at,
  has_proof: !!o.has_proof, username: o.username,
  delivered: o.status === "approved" && o.delivered ? JSON.parse(o.delivered) : null,
});


/* ---------- Railway (create VPS NAT otomatis) ---------- */
const RW_URL = "https://backboard.railway.com/graphql/v2";
async function rwGql(token, query, variables) {
  let r;
  try {
    r = await fetch(RW_URL, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ query, variables }) });
  } catch { fail(502, "Tidak bisa menghubungi Railway"); }
  let d = {}; try { d = await r.json(); } catch {}
  if (d.errors && d.errors.length) fail(400, "Railway: " + String(d.errors[0].message || "error").slice(0, 200));
  if (!r.ok) fail(r.status === 401 || r.status === 403 ? 400 : 502, r.status === 401 || r.status === 403 ? "Token Railway tidak valid" : "Railway error " + r.status);
  return d.data || {};
}
const rwId = (v, label) => { const x = String(v || ""); if (!/^[A-Za-z0-9-]{8,64}$/.test(x)) fail(400, label + " tidak valid"); return x; };
function rwPass() {
  const c = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "";
  for (const b of crypto.getRandomValues(new Uint8Array(14))) s += c[b % c.length];
  return s;
}
async function rwStep(db, body) {
  const token = str(body.token, 200);
  if (token.length < 20) fail(400, "Token Railway kosong / terlalu pendek");
  switch (body.step) {
    case "auth": {
      try { const d = await rwGql(token, "query{ me{ name email } }"); return { label: "Token valid" + (d.me && d.me.name ? " (" + d.me.name + ")" : "") }; }
      catch (e) {
        const d = await rwGql(token, "query{ projects(first:1){ edges{ node{ id } } } }");
        return { label: "Token valid" };
      }
    }
    case "project": {
      const name = str(body.name, 40);
      if (!/^[A-Za-z0-9_-]{3,40}$/.test(name)) fail(400, "Nama VPS 3–40 karakter: huruf, angka, - atau _");
      const input = { name, defaultEnvironmentName: "production" };
      if (body.workspace) input.workspaceId = rwId(body.workspace, "Workspace ID");
      const d = await rwGql(token, "mutation($input:ProjectCreateInput!){ projectCreate(input:$input){ id environments{ edges{ node{ id name } } } } }", { input });
      const pr = d.projectCreate; const env = pr && pr.environments && pr.environments.edges[0] && pr.environments.edges[0].node;
      if (!pr || !env) fail(502, "Railway tidak mengembalikan project / environment");
      return { projectId: pr.id, environmentId: env.id, label: "Project dibuat" };
    }
    case "service": {
      const projectId = rwId(body.projectId, "Project ID"), environmentId = rwId(body.environmentId, "Environment ID");
      const image = str(body.image, 120) || "linuxserver/openssh-server:latest";
      if (!/^[a-z0-9][a-z0-9._\/:@-]{1,119}$/i.test(image)) fail(400, "Nama image tidak valid");
      const vuser = str(body.vuser, 30) || "yusup";
      if (!/^[a-z][a-z0-9_-]{1,29}$/.test(vuser)) fail(400, "Username SSH tidak valid");
      const vpass = rwPass();
      const input = { projectId, environmentId, name: "vps-nat", source: { image }, variables: { PUID: "1000", PGID: "1000", TZ: "Asia/Jakarta", PASSWORD_ACCESS: "true", USER_NAME: vuser, USER_PASSWORD: vpass, SUDO_ACCESS: "true" } };
      const d = await rwGql(token, "mutation($input:ServiceCreateInput!){ serviceCreate(input:$input){ id } }", { input });
      if (!d.serviceCreate) fail(502, "Railway tidak mengembalikan service");
      return { serviceId: d.serviceCreate.id, vuser, vpass, label: "Service & deploy dimulai" };
    }
    case "proxy": {
      const environmentId = rwId(body.environmentId, "Environment ID"), serviceId = rwId(body.serviceId, "Service ID");
      const port = int(body.port) || 2222;
      if (port < 1 || port > 65535) fail(400, "Port tidak valid");
      const d = await rwGql(token, "mutation($input:TCPProxyCreateInput!){ tcpProxyCreate(input:$input){ domain proxyPort } }", { input: { environmentId, serviceId, applicationPort: port } });
      const t = d.tcpProxyCreate; if (!t || !t.domain) fail(502, "TCP proxy gagal dibuat");
      return { host: t.domain, port: String(t.proxyPort), label: "Alamat SSH siap" };
    }
    case "wait": {
      const projectId = rwId(body.projectId, "Project ID"), environmentId = rwId(body.environmentId, "Environment ID"), serviceId = rwId(body.serviceId, "Service ID");
      const d = await rwGql(token, "query($input:DeploymentListInput!){ deployments(first:1,input:$input){ edges{ node{ id status } } } }", { input: { projectId, environmentId, serviceId } });
      const n = d.deployments && d.deployments.edges[0] && d.deployments.edges[0].node;
      const st = n ? n.status : "QUEUED";
      if (["FAILED", "CRASHED", "REMOVED"].includes(st)) fail(400, "Deploy gagal di Railway (status " + st + ")");
      return { status: st, done: st === "SUCCESS", label: st };
    }
    case "save": {
      const host = str(body.host, 120), port = str(body.port, 6), vuser = str(body.vuser, 60), vpass = str(body.vpass, 200), name = str(body.name, 80);
      if (!host || !port || !vpass) fail(400, "Data VPS belum lengkap");
      await db.prepare("INSERT INTO stok(ip,port,vuser,vpass,hostname,raw,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(host, port, vuser, vpass, name, "railway:" + name, Date.now()).run();
      return { label: "Masuk ke stok" };
    }
  }
  fail(400, "Langkah tidak dikenal");
}

/* ---------- main ---------- */
export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (e) {
      if (e instanceof HttpError) return J({ error: e.message, ...e.extra }, e.status);
      console.error(e);
      return J({ error: "Terjadi kesalahan server" }, 500);
    }
  },
};

async function handle(req, env) {
  const url = new URL(req.url);
  const p = url.pathname, m = req.method;
  if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);
  await init(env);
  const db = env.DB;
  if (m !== "GET" && m !== "HEAD") {
    const o = req.headers.get("origin");
    if (o && new URL(o).host !== url.host) fail(403, "Origin tidak valid");
  }
  const body = m === "GET" || m === "HEAD" || m === "DELETE" ? {} : await readJson(req);
  const S = await getSettings(db);
  const ip = req.headers.get("cf-connecting-ip") || "x";

  /* --- public --- */
  if (p === "/api/status" && m === "GET") {
    const t = await db.prepare("SELECT (SELECT COUNT(*) FROM orders WHERE status='approved') trx, (SELECT COUNT(*) FROM users WHERE role='user') users").first();
    return J({ site_name: S.site_name, maintenance: S.maintenance === "1", maintenance_msg: S.maintenance_msg, total_trx: t.trx, total_users: t.users });
  }
  if (p === "/api/register" && m === "POST") {
    const name = str(body.username, 20), pass = String(body.password || "");
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) fail(400, "Username 3–20 karakter: huruf, angka, atau _");
    if (pass.length < 4) fail(400, "Password minimal 4 karakter");
    if (pass.length > 100) fail(400, "Password terlalu panjang");
    await rateLimit(db, "reg:" + ip, 5, 3600e3);
    const ex = await db.prepare("SELECT id FROM users WHERE username=?").bind(name).first();
    if (ex) fail(409, "Username sudah dipakai");
    const r = await db.prepare("INSERT INTO users(username,pass,role,created_at) VALUES(?,?, 'user', ?)").bind(name, await hashPass(pass), Date.now()).run();
    const cookie = await startSession(env, r.meta.last_row_id);
    await db.prepare("INSERT INTO notifs(user_id,title,body,kind,created_at) VALUES(?,?,?, 'info', ?)")
      .bind(r.meta.last_row_id, "Selamat datang!", "Akun kamu sudah aktif. Pilih jumlah VPS NAT di Beranda lalu tekan Order.", Date.now()).run();
    return J({ user: { id: r.meta.last_row_id, username: name, role: "user" } }, 200, { "set-cookie": cookie });
  }
  if (p === "/api/login" && m === "POST") {
    const name = str(body.username, 20), pass = String(body.password || "");
    await rateLimit(db, "login:" + ip + ":" + name.toLowerCase(), 8, 600e3);
    const u = await db.prepare("SELECT * FROM users WHERE username=?").bind(name).first();
    if (!u || !(await checkPass(pass, u.pass))) fail(401, "Username atau password salah");
    if (u.banned) fail(403, "Akun kamu diblokir", { banned: true, reason: u.ban_reason || "" });
    return J({ user: pubUser(u) }, 200, { "set-cookie": await startSession(env, u.id) });
  }
  if (p === "/api/logout" && m === "POST") {
    const c = getCookie(req, "sid");
    if (c) await db.prepare("DELETE FROM sessions WHERE token=?").bind(await sha256hex(c)).run();
    return J({ ok: true }, 200, { "set-cookie": "sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" });
  }
  if (p === "/api/me" && m === "GET") {
    try { return J({ user: pubUser(await authUser(req, env)) }); }
    catch (e) { if (e instanceof HttpError && e.extra.banned) return J({ user: null, banned: true, reason: e.extra.reason }); throw e; }
  }

  /* --- wajib login --- */
  const user = await authUser(req, env);
  if (!user) fail(401, "Silakan login dulu");
  const isOwner = user.role === "owner";
  if (S.maintenance === "1" && !isOwner) fail(503, S.maintenance_msg, { maintenance: true });
  const owner = () => { if (!isOwner) fail(403, "Khusus owner"); };

  if (p === "/api/shop" && m === "GET") {
    await cleanupExpired(db);
    const st = await db.prepare("SELECT COUNT(*) n FROM stok WHERE status='ready'").first();
    return J({ product: S.product_name, price: int(S.price), spec: S.spec, provider: S.provider, stock: st.n, has_qr: !!(await db.prepare("SELECT 1 x FROM settings WHERE k='qr_image'").first()) });
  }
  if (p === "/api/qr" && m === "GET") {
    const r = await db.prepare("SELECT v FROM settings WHERE k='qr_image'").first();
    if (!r) fail(404, "QR belum diatur owner");
    return imageResponse(r.v);
  }
  if (p === "/api/promo/check" && m === "POST") {
    const qty = Math.min(10, Math.max(1, int(body.qty)));
    const r = await checkCode(db, body.code, int(S.price) * qty);
    return J(r.ok ? { ok: true, code: r.code, discount: r.discount, total: r.total } : { ok: false, reason: r.reason });
  }

  /* --- orders --- */
  if (p === "/api/orders" && m === "GET") {
    await cleanupExpired(db);
    const { results } = await db.prepare("SELECT o.id,o.user_id,o.qty,o.unit_price,o.discount,o.total,o.promo,o.status,o.note,o.delivered,o.created_at,o.proof_at,o.decided_at, (o.proof IS NOT NULL) has_proof, ? username FROM orders o WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(user.username, user.id).all();
    return J({ orders: results.map(orderOut) });
  }
  if (p === "/api/orders" && m === "POST") {
    await cleanupExpired(db);
    const qty = int(body.qty);
    if (qty < 1 || qty > 10) fail(400, "Jumlah order 1–10");
    const open = await db.prepare("SELECT id FROM orders WHERE user_id=? AND status IN ('waiting_proof','pending')").bind(user.id).first();
    if (open) fail(409, "Selesaikan atau batalkan order sebelumnya dulu", { order_id: open.id });
    const unit = int(S.price), sub = unit * qty;
    let disc = 0, promo = null;
    if (body.promo) { const r = await checkCode(db, body.promo, sub); if (!r.ok) fail(400, r.reason); disc = r.discount; promo = r.code; }
    if (!(await db.prepare("SELECT 1 x FROM settings WHERE k='qr_image'").first())) fail(409, "Owner belum mengatur QR pembayaran");
    const id = genId();
    const res = await db.prepare("UPDATE stok SET status='reserved', order_id=? WHERE id IN (SELECT id FROM stok WHERE status='ready' ORDER BY id LIMIT ?)").bind(id, qty).run();
    if (res.meta.changes < qty) {
      await db.prepare("UPDATE stok SET status='ready', order_id=NULL WHERE order_id=?").bind(id).run();
      fail(409, "Stok tidak cukup");
    }
    await db.prepare("INSERT INTO orders(id,user_id,qty,unit_price,discount,total,promo,status,created_at) VALUES(?,?,?,?,?,?,?, 'waiting_proof', ?)")
      .bind(id, user.id, qty, unit, disc, sub - disc, promo, Date.now()).run();
    return J({ order_id: id, total: sub - disc, expires_at: Date.now() + 30 * 60 * 1000 });
  }
  let mt;
  if ((mt = p.match(/^\/api\/orders\/(VN[A-Z0-9]{6})\/(proof|cancel)$/)) && m === "POST") {
    const o = await db.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").bind(mt[1], user.id).first();
    if (!o) fail(404, "Order tidak ditemukan");
    if (mt[2] === "cancel") {
      if (!["waiting_proof", "pending"].includes(o.status)) fail(409, "Order tidak bisa dibatalkan");
      await db.batch([
        db.prepare("UPDATE stok SET status='ready', order_id=NULL WHERE order_id=? AND status='reserved'").bind(o.id),
        db.prepare("UPDATE orders SET status='cancelled', decided_at=? WHERE id=?").bind(Date.now(), o.id),
      ]);
      return J({ ok: true });
    }
    if (o.status !== "waiting_proof") fail(409, "Order ini tidak menunggu bukti bayar");
    if (!dataUrlOk(body.image, 900000)) fail(400, "Bukti harus berupa gambar JPG/PNG/WEBP (maks ±650KB)");
    const owners = (await db.prepare("SELECT id FROM users WHERE role='owner'").all()).results;
    await db.batch([
      db.prepare("UPDATE orders SET proof=?, status='pending', proof_at=? WHERE id=?").bind(body.image, Date.now(), o.id),
      ...owners.map((ow) => notif(db, ow.id, "Order baru " + o.id, `${user.username} kirim bukti bayar Rp${o.total.toLocaleString("id-ID")} untuk ${o.qty} VPS.`, "order")),
    ]);
    return J({ ok: true });
  }

  /* --- notif --- */
  if (p === "/api/notifs" && m === "GET") {
    const { results } = await db.prepare("SELECT id,user_id,title,body,kind,read,created_at FROM notifs WHERE user_id=? OR (user_id IS NULL AND created_at>=?) ORDER BY id DESC LIMIT 50").bind(user.id, user.created_at).all();
    const items = results.map((n) => ({ id: n.id, title: n.title, body: n.body, kind: n.kind, created_at: n.created_at, broadcast: n.user_id == null, unread: n.user_id == null ? n.id > user.bc_read : !n.read }));
    return J({ items, unread: items.filter((i) => i.unread).length });
  }
  if (p === "/api/notifs/read" && m === "POST") {
    await db.batch([
      db.prepare("UPDATE notifs SET read=1 WHERE user_id=?").bind(user.id),
      db.prepare("UPDATE users SET bc_read=(SELECT COALESCE(MAX(id),0) FROM notifs WHERE user_id IS NULL) WHERE id=?").bind(user.id),
    ]);
    return J({ ok: true });
  }

  /* --- chat publik --- */
  if (p === "/api/chat" && m === "GET") {
    const after = int(url.searchParams.get("after"));
    const q = after > 0
      ? db.prepare("SELECT c.id,u.username,u.role,c.text,c.created_at FROM chat c JOIN users u ON u.id=c.user_id WHERE c.id>? ORDER BY c.id ASC LIMIT 100").bind(after)
      : db.prepare("SELECT * FROM (SELECT c.id,u.username,u.role,c.text,c.created_at FROM chat c JOIN users u ON u.id=c.user_id ORDER BY c.id DESC LIMIT 60) ORDER BY id ASC");
    return J({ messages: (await q.all()).results });
  }
  if (p === "/api/chat" && m === "POST") {
    const text = str(body.text, 300);
    if (!text) fail(400, "Pesan kosong");
    const last = await db.prepare("SELECT created_at FROM chat WHERE user_id=? ORDER BY id DESC LIMIT 1").bind(user.id).first();
    if (last && Date.now() - last.created_at < 1500) fail(429, "Pelan-pelan, tunggu sebentar");
    await db.batch([
      db.prepare("INSERT INTO chat(user_id,text,created_at) VALUES(?,?,?)").bind(user.id, text, Date.now()),
      db.prepare("DELETE FROM chat WHERE id < (SELECT MAX(id)-500 FROM chat)"),
    ]);
    return J({ ok: true });
  }
  if ((mt = p.match(/^\/api\/chat\/(\d+)$/)) && m === "DELETE") {
    owner();
    await db.prepare("DELETE FROM chat WHERE id=?").bind(int(mt[1])).run();
    return J({ ok: true });
  }

  /* ================= OWNER ================= */
  if (!p.startsWith("/api/owner/")) fail(404, "Tidak ditemukan");
  owner();

  if (p === "/api/owner/overview" && m === "GET") {
    await cleanupExpired(db);
    const r = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM users WHERE role='user') users,
      (SELECT COUNT(*) FROM users WHERE banned=1) banned,
      (SELECT COUNT(*) FROM orders WHERE status='approved') trx,
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE status='approved') revenue,
      (SELECT COUNT(*) FROM orders WHERE status='pending') pending,
      (SELECT COUNT(*) FROM stok WHERE status='ready') stok_ready,
      (SELECT COUNT(*) FROM stok WHERE status='sold') stok_sold`).first();
    return J({ ...r, has_qr: !!(await db.prepare("SELECT 1 x FROM settings WHERE k='qr_image'").first()), settings: { site_name: S.site_name, product_name: S.product_name, price: int(S.price), spec: S.spec, provider: S.provider, maintenance: S.maintenance === "1", maintenance_msg: S.maintenance_msg } });
  }
  if (p === "/api/owner/orders" && m === "GET") {
    const st = url.searchParams.get("status") || "pending";
    const q = st === "all"
      ? db.prepare("SELECT o.id,o.user_id,o.qty,o.unit_price,o.discount,o.total,o.promo,o.status,o.note,o.delivered,o.created_at,o.proof_at,o.decided_at, (o.proof IS NOT NULL) has_proof, u.username FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 100")
      : db.prepare("SELECT o.id,o.user_id,o.qty,o.unit_price,o.discount,o.total,o.promo,o.status,o.note,o.delivered,o.created_at,o.proof_at,o.decided_at, (o.proof IS NOT NULL) has_proof, u.username FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status=? ORDER BY o.created_at DESC LIMIT 100").bind(st);
    return J({ orders: (await q.all()).results.map(orderOut) });
  }
  if ((mt = p.match(/^\/api\/owner\/orders\/(VN[A-Z0-9]{6})\/proof$/)) && m === "GET") {
    const r = await db.prepare("SELECT proof FROM orders WHERE id=?").bind(mt[1]).first();
    if (!r || !r.proof) fail(404, "Bukti tidak ada");
    return imageResponse(r.proof);
  }
  if ((mt = p.match(/^\/api\/owner\/orders\/(VN[A-Z0-9]{6})\/(approve|reject)$/)) && m === "POST") {
    const o = await db.prepare("SELECT * FROM orders WHERE id=?").bind(mt[1]).first();
    if (!o) fail(404, "Order tidak ditemukan");
    if (o.status !== "pending") fail(409, "Order ini sudah diproses");
    const note = str(body.note, 200), now = Date.now();
    if (mt[2] === "reject") {
      await db.batch([
        db.prepare("UPDATE stok SET status='ready', order_id=NULL WHERE order_id=? AND status='reserved'").bind(o.id),
        db.prepare("UPDATE orders SET status='rejected', note=?, decided_at=? WHERE id=?").bind(note, now, o.id),
        notif(db, o.user_id, "Order " + o.id + " ditolak", note || "Bukti bayar tidak valid. Silakan order ulang.", "order"),
      ]);
      return J({ ok: true });
    }
    const rows = (await db.prepare("SELECT * FROM stok WHERE order_id=? AND status='reserved'").bind(o.id).all()).results;
    if (rows.length < o.qty) fail(409, "Stok reservasi tidak lengkap, tolak order ini lalu minta user order ulang");
    const delivered = rows.map((r) => ({ ip: r.ip, port: r.port, user: r.vuser, pass: r.vpass, hostname: r.hostname || "" }));
    const stmts = [
      db.prepare("UPDATE orders SET status='approved', note=?, delivered=?, decided_at=? WHERE id=? AND status='pending'").bind(note, JSON.stringify(delivered), now, o.id),
      db.prepare("UPDATE stok SET status='sold', sold_at=? WHERE order_id=?").bind(now, o.id),
      notif(db, o.user_id, "VPS NAT terkirim 🎉", `Order ${o.id} disetujui. ${o.qty} VPS NAT sudah masuk di menu Pesanan.`, "delivery"),
    ];
    if (o.promo) stmts.push(db.prepare("UPDATE codes SET used=used+1 WHERE code=?").bind(o.promo));
    await db.batch(stmts);
    return J({ ok: true });
  }

  if (p === "/api/owner/stok" && m === "GET") {
    const { results } = await db.prepare("SELECT id,ip,port,vuser,hostname,status,order_id,created_at FROM stok WHERE status!='sold' ORDER BY id DESC LIMIT 200").all();
    return J({ items: results });
  }
  if (p === "/api/owner/stok" && m === "POST") {
    const items = parseBulk(body.data).filter((x) => x.ip && x.pass);
    if (!items.length) fail(400, "Data VPS tidak terbaca. Pastikan ada IP dan Password.");
    if (items.length > 100) fail(400, "Maksimal 100 VPS sekali tambah");
    const now = Date.now();
    await db.batch(items.map((x) => db.prepare("INSERT INTO stok(ip,port,vuser,vpass,hostname,raw,created_at) VALUES(?,?,?,?,?,?,?)").bind(str(x.ip, 80), str(x.port, 6), str(x.user, 60), str(x.pass, 200), str(x.hostname, 80), str(x.raw, 2000), now)));
    return J({ added: items.length });
  }
  if ((mt = p.match(/^\/api\/owner\/stok\/(\d+)$/)) && m === "DELETE") {
    const r = await db.prepare("DELETE FROM stok WHERE id=? AND status='ready'").bind(int(mt[1])).run();
    if (!r.meta.changes) fail(409, "Hanya stok berstatus ready yang bisa dihapus");
    return J({ ok: true });
  }

  if (p === "/api/owner/qr" && m === "POST") {
    if (!dataUrlOk(body.image, 900000)) fail(400, "QR harus gambar JPG/PNG/WEBP (maks ±650KB)");
    await db.prepare("INSERT OR REPLACE INTO settings(k,v) VALUES('qr_image',?)").bind(body.image).run();
    return J({ ok: true });
  }
  if (p === "/api/owner/settings" && m === "POST") {
    const ups = [];
    if (body.site_name != null) ups.push(["site_name", str(body.site_name, 40) || DEFAULTS.site_name]);
    if (body.product_name != null) ups.push(["product_name", str(body.product_name, 40) || DEFAULTS.product_name]);
    if (body.spec != null) ups.push(["spec", str(body.spec, 100)]);
    if (body.provider != null) ups.push(["provider", str(body.provider, 60)]);
    if (body.price != null) { const pr = int(body.price); if (pr < 1) fail(400, "Harga minimal Rp1"); ups.push(["price", String(pr)]); }
    if (body.maintenance != null) ups.push(["maintenance", body.maintenance ? "1" : "0"]);
    if (body.maintenance_msg != null) ups.push(["maintenance_msg", str(body.maintenance_msg, 200) || DEFAULTS.maintenance_msg]);
    if (!ups.length) fail(400, "Tidak ada perubahan");
    await db.batch(ups.map(([k, v]) => db.prepare("INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)").bind(k, v)));
    return J({ ok: true });
  }

  if (p === "/api/owner/users" && m === "GET") {
    const q = "%" + str(url.searchParams.get("q"), 20).replace(/[%_]/g, "") + "%";
    const { results } = await db.prepare("SELECT id,username,role,banned,ban_reason,created_at,(SELECT COUNT(*) FROM orders WHERE user_id=users.id AND status='approved') trx FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 200").bind(q).all();
    return J({ users: results });
  }
  if ((mt = p.match(/^\/api\/owner\/users\/(\d+)\/(ban|unban)$/)) && m === "POST") {
    const id = int(mt[1]);
    const t = await db.prepare("SELECT id,role FROM users WHERE id=?").bind(id).first();
    if (!t) fail(404, "User tidak ditemukan");
    if (t.role === "owner") fail(400, "Owner tidak bisa diban");
    if (mt[2] === "ban") {
      await db.batch([
        db.prepare("UPDATE users SET banned=1, ban_reason=? WHERE id=?").bind(str(body.reason, 120), id),
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
      ]);
    } else {
      await db.batch([
        db.prepare("UPDATE users SET banned=0, ban_reason='' WHERE id=?").bind(id),
        notif(db, id, "Akun dipulihkan", "Blokir akun kamu sudah dibuka. Selamat datang kembali.", "info"),
      ]);
    }
    return J({ ok: true });
  }
  if (p === "/api/owner/notify" && m === "POST") {
    const title = str(body.title, 60), text = str(body.body, 500);
    if (!title || !text) fail(400, "Judul dan isi wajib diisi");
    const uid = body.user_id ? int(body.user_id) : null;
    if (uid && !(await db.prepare("SELECT 1 x FROM users WHERE id=?").bind(uid).first())) fail(404, "User tidak ditemukan");
    await notif(db, uid, title, text, uid ? "info" : "broadcast").run();
    return J({ ok: true });
  }

  if (p === "/api/owner/railway" && m === "POST") {
    await rateLimit(db, "rw:" + user.id, 120, 10 * 60e3);
    return J({ ok: true, ...(await rwStep(db, body)) });
  }
  if (p === "/api/owner/codes" && m === "GET") {
    return J({ codes: (await db.prepare("SELECT * FROM codes ORDER BY rowid DESC LIMIT 100").all()).results });
  }
  if (p === "/api/owner/codes" && m === "POST") {
    const type = body.type === "fixed" ? "fixed" : "percent";
    const value = int(body.value);
    if (value < 1 || (type === "percent" && value > 100)) fail(400, "Nilai diskon tidak valid");
    let code = str(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!code) code = "YP" + randHex(3).toUpperCase();
    const days = int(body.days), maxu = int(body.max_uses);
    const r = await db.prepare("INSERT OR IGNORE INTO codes(code,type,value,max_uses,expires_at) VALUES(?,?,?,?,?)")
      .bind(code, type, value, maxu > 0 ? maxu : null, days > 0 ? Date.now() + days * 864e5 : null).run();
    if (!r.meta.changes) fail(409, "Kode sudah ada");
    return J({ code });
  }
  if ((mt = p.match(/^\/api\/owner\/codes\/([A-Z0-9]+)$/)) && m === "DELETE") {
    await db.prepare("DELETE FROM codes WHERE code=?").bind(mt[1]).run();
    return J({ ok: true });
  }
  fail(404, "Tidak ditemukan");
}
