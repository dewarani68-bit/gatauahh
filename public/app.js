(() => {
"use strict";
const S = { status: { site_name: "Yusup VPS NAT", maintenance: false, total_trx: 0, total_users: 0 }, me: null, banned: null, tab: "home", otab: "sum", ownerLogin: false, timers: [], unread: 0 };
const $ = (s) => document.querySelector(s);
const el = (t, p = {}, ...k) => {
  const n = document.createElement(t);
  for (const [a, v] of Object.entries(p)) {
    if (a === "class") n.className = v;
    else if (a === "on") for (const [e, f] of Object.entries(v)) n.addEventListener(e, f);
    else if (a in n) n[a] = v; else n.setAttribute(a, v);
  }
  for (const c of k.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const rp = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");
const when = (t) => t ? new Date(t).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function toast(msg, bad) {
  const t = el("div", { class: "toast" + (bad ? " bad" : "") }, msg);
  $("#toasts").append(t); setTimeout(() => t.remove(), 3800);
}
function copy(text) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Tersalin"), () => toast("Gagal menyalin", true));
}
async function api(path, opt = {}) {
  const r = await fetch("/api" + path, { method: opt.method || "GET", headers: opt.body ? { "content-type": "application/json" } : {}, body: opt.body ? JSON.stringify(opt.body) : undefined, credentials: "same-origin" });
  let d = {}; try { d = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error(d.error || "Terjadi kesalahan"); e.status = r.status; e.data = d;
    if (r.status === 503 && d.maintenance && !S.status.maintenance) { S.status.maintenance = true; S.status.maintenance_msg = d.error; render(); }
    if (r.status === 403 && d.banned && S.banned === null) { S.banned = d.reason || ""; S.me = null; render(); }
    if (r.status === 401 && S.me) { S.me = null; render(); }
    throw e;
  }
  return d;
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }
function every(ms, fn) { S.timers.push(setInterval(fn, ms)); }

/* ---------- 3D rack (loader + hiasan) ---------- */
function buildRack(root, n = 5) {
  root.textContent = "";
  for (let i = 0; i < n; i++) {
    const s = el("div", { class: "slab", style: `top:${i * 30}px` },
      el("div", { class: "f" }, el("i")), el("div", { class: "u" }), el("div", { class: "b" }), el("div", { class: "l" }), el("div", { class: "r" }), el("div", { class: "t" }));
    root.append(s);
  }
}
const lightUp = (n) => document.querySelectorAll("#rack .slab").forEach((s, i) => s.classList.toggle("on", i < n));
function setLine(text, dots) {
  const l = $("#loadLine"); l.textContent = text;
  if (dots) l.append(el("span", { class: "dots" }));
}
async function boot() {
  buildRack($("#rack"));
  const p = Promise.all([
    api("/status").then((d) => (S.status = d)).catch(() => {}),
    api("/me").then((d) => { S.me = d.user; if (d.banned) S.banned = d.reason || ""; }).catch(() => {}),
  ]);
  const bar = (v) => ($("#loadBar").style.width = v + "%");
  setLine("Menyiapkan dashboard", true); lightUp(1); bar(20);
  await sleep(850); setLine("Menyiapkan user", true); lightUp(2); bar(45);
  await sleep(850); await p;
  setLine("Melihat total trx: " + (S.status.total_trx || 0), true); lightUp(4); bar(75);
  await sleep(850); setLine("Siap", true); lightUp(5); bar(100);
  await sleep(750);
  document.title = S.status.site_name;
  render();
  $("#loader").classList.add("done");
}

/* ---------- render root ---------- */
function render() {
  clearTimers();
  const app = $("#app"); app.hidden = false; app.textContent = "";
  const isOwner = S.me && S.me.role === "owner";
  if (S.banned !== null && !S.me) return app.append(bannedView());
  if (S.status.maintenance && !isOwner) return app.append(maintView());
  if (!S.me) return app.append(authView());
  app.append(shell());
}
function maintView() {
  if (S.ownerLogin && !S.me) return authView(true);
  return el("div", { class: "screen-msg" }, el("div", { class: "big" }, "🛠️"), el("h1", {}, "Sedang maintenance"),
    el("p", { class: "muted" }, S.status.maintenance_msg || ""),
    S.me ? el("button", { class: "btn ghost", on: { click: logout } }, "Keluar")
      : el("button", { class: "btn ghost", on: { click: () => { S.ownerLogin = true; render(); } } }, "Masuk sebagai owner"));
}
function bannedView() {
  return el("div", { class: "screen-msg" }, el("div", { class: "big" }, "🚫"), el("h1", {}, "Akun diblokir"),
    el("p", { class: "muted" }, S.banned ? "Alasan: " + S.banned : "Hubungi owner jika ini keliru."),
    el("button", { class: "btn ghost", on: { click: () => { S.banned = null; render(); } } }, "Kembali"));
}
async function logout() { await api("/logout", { method: "POST", body: {} }).catch(() => {}); S.me = null; S.ownerLogin = false; S.tab = "home"; render(); }

/* ---------- auth ---------- */
function authView() {
  let mode = "login";
  const u = el("input", { placeholder: "Username", autocomplete: "username", maxLength: 20 });
  const p = el("input", { type: "password", placeholder: "Password (minimal 4 karakter)", autocomplete: "current-password", maxLength: 100 });
  const err = el("div", { class: "err" });
  const go = el("button", { class: "btn block" }, "Masuk");
  const tl = el("button", { class: "on" }, "Masuk"), tr = el("button", {}, "Daftar");
  const setMode = (m) => { mode = m; tl.className = m === "login" ? "on" : ""; tr.className = m === "reg" ? "on" : ""; go.textContent = m === "login" ? "Masuk" : "Buat akun"; err.textContent = ""; };
  tl.onclick = () => setMode("login"); tr.onclick = () => setMode("reg");
  const submit = async () => {
    err.textContent = ""; go.disabled = true;
    try {
      const d = await api(mode === "login" ? "/login" : "/register", { method: "POST", body: { username: u.value, password: p.value } });
      S.me = d.user; S.banned = null; S.tab = "home"; render();
    } catch (e) {
      if (e.data && e.data.banned) { S.banned = e.data.reason || ""; render(); return; }
      err.textContent = e.message;
    } finally { go.disabled = false; }
  };
  go.onclick = submit;
  p.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  const rack = el("div", { class: "rack" }); buildRack(rack, 4); rack.querySelectorAll(".slab").forEach((s) => s.classList.add("on"));
  return el("div", { class: "auth" }, el("div", { class: "float3d" }, rack),
    el("h1", {}, S.status.site_name), el("p", { class: "sub" }, "Beli VPS NAT, bayar lewat QR, terima datanya otomatis setelah disetujui."),
    el("div", { class: "tabs" }, tl, tr), el("label", {}, "Username"), u, el("label", {}, "Password"), p, err, go);
}

/* ---------- shell ---------- */
function shell() {
  const isOwner = S.me.role === "owner";
  const main = el("main");
  const tabs = [["home", "🏠", "Beranda"], ["orders", "📦", "Pesanan"], ["chat", "💬", "Chat"]];
  if (isOwner) tabs.push(["owner", "🛠️", "Owner"]);
  const bellBadge = el("b", { hidden: !S.unread }, S.unread);
  const bell = el("button", { class: "bell", "aria-label": "Notifikasi", on: { click: () => go("notif") } }, "🔔", bellBadge);
  const nav = el("nav", { class: "bar" }, tabs.map(([k, ic, lb]) => el("button", { class: S.tab === k ? "on" : "", on: { click: () => go(k) } }, el("span", {}, ic), lb)));
  const top = el("header", { class: "top" }, el("h2", { class: "grow" }, S.status.site_name),
    el("span", { class: "pill" }, (isOwner ? "Owner · " : "") + S.me.username), bell,
    el("button", { class: "btn ghost sm", on: { click: logout } }, "Keluar"));
  function go(t) { S.tab = t; render(); }
  const views = { home: homeView, orders: ordersView, chat: chatView, notif: notifView, owner: ownerView };
  clearTimers();
  views[S.tab](main);
  every(12000, guard(async () => {
    const d = await api("/notifs");
    if (d.unread > S.unread && S.tab !== "notif") { const n = d.items.find((i) => i.unread); if (n) toast("🔔 " + n.title); }
    S.unread = d.unread; bellBadge.textContent = d.unread; bellBadge.hidden = !d.unread;
  }));
  api("/notifs").then((d) => { S.unread = d.unread; bellBadge.textContent = d.unread; bellBadge.hidden = !d.unread; }).catch(() => {});
  return el("div", { class: "shell" }, top, main, nav);
}
function tilt(node) {
  node.classList.add("tilt");
  node.addEventListener("pointermove", (e) => {
    const r = node.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    node.style.transform = `perspective(700px) rotateX(${(-y * 8).toFixed(1)}deg) rotateY(${(x * 8).toFixed(1)}deg)`;
  });
  const reset = () => (node.style.transform = "");
  node.addEventListener("pointerleave", reset); node.addEventListener("pointerup", reset);
  return node;
}
function compress(file, max, q0) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      let q = q0, d = c.toDataURL("image/jpeg", q);
      while (d.length > 880000 && q > .3) { q -= .1; d = c.toDataURL("image/jpeg", q); }
      d.length > 880000 ? rej(new Error("Gambar terlalu besar")) : res(d);
    };
    img.onerror = () => rej(new Error("File bukan gambar"));
    img.src = u;
  });
}
function modal(title, fields, okText = "Kirim") {
  return new Promise((resolve) => {
    const inputs = fields.map((f) => f.type === "textarea" ? el("textarea", { placeholder: f.ph || "", value: f.value || "", maxLength: f.max || 500 }) : el("input", { type: f.type || "text", placeholder: f.ph || "", value: f.value || "", maxLength: f.max || 100 }));
    const close = (v) => { ov.remove(); resolve(v); };
    const ov = el("div", { class: "overlay", on: { click: (e) => e.target === ov && close(null) } },
      el("div", { class: "modal" }, el("h3", {}, title), fields.map((f, i) => [el("label", {}, f.label), inputs[i]]),
        el("div", { class: "row", style: "margin-top:16px" }, el("button", { class: "btn ghost grow", on: { click: () => close(null) } }, "Batal"),
          el("button", { class: "btn grow", on: { click: () => close(Object.fromEntries(fields.map((f, i) => [f.name, inputs[i].value]))) } }, okText))));
    document.body.append(ov); inputs[0] && inputs[0].focus();
  });
}
function viewImage(src) {
  const ov = el("div", { class: "overlay", on: { click: () => ov.remove() } }, el("div", { class: "modal" }, el("img", { src, alt: "Gambar" })));
  document.body.append(ov);
}

/* ---------- beranda / order ---------- */
async function homeView(main) {
  main.append(el("p", { class: "muted" }, "Memuat..."));
  const [shop, od] = await Promise.all([api("/shop"), api("/orders")]).catch(() => [null, null]);
  if (!shop) return;
  main.textContent = "";
  const active = od.orders.find((o) => o.status === "waiting_proof" || o.status === "pending");
  if (active) return active.status === "waiting_proof" ? payPanel(main, active, shop) : waitPanel(main, active);
  let qty = 1, promo = null;
  const out = el("output", {}, "1"), subEl = el("b", {}, rp(shop.price)), discRow = el("div", { class: "row muted", hidden: true });
  const pin = el("input", { placeholder: "Kode promo (opsional)", maxLength: 20 });
  const btn = el("button", { class: "btn block", disabled: shop.stock < 1 || !shop.has_qr }, shop.stock < 1 ? "Stok habis" : !shop.has_qr ? "Pembayaran belum siap" : "Order sekarang");
  const recalc = async () => {
    out.textContent = qty;
    let total = shop.price * qty; discRow.hidden = true; promo = null;
    if (pin.value.trim()) {
      try { const r = await api("/promo/check", { method: "POST", body: { qty, code: pin.value } });
        if (r.ok) { promo = r.code; total = r.total; discRow.hidden = false; discRow.textContent = `Promo ${r.code}: -${rp(r.discount)}`; }
        else { discRow.hidden = false; discRow.textContent = r.reason; } } catch {}
    }
    subEl.textContent = rp(total);
  };
  const step = (d) => { qty = Math.min(Math.min(10, Math.max(1, shop.stock)), Math.max(1, qty + d)); recalc(); };
  pin.addEventListener("change", recalc);
  btn.onclick = guard(async () => {
    btn.disabled = true;
    try { await api("/orders", { method: "POST", body: { qty, promo: pin.value.trim() || undefined } }); render(); }
    catch (e) { btn.disabled = false; throw e; }
  });
  main.append(
    tilt(el("section", { class: "card hero" }, el("h1", {}, shop.product), el("div", { class: "spec" }, shop.spec), el("div", { class: "muted" }, shop.provider),
      el("div", { class: "row", style: "margin-top:8px" }, el("span", { class: "price grow" }, rp(shop.price)), el("span", { class: "pill " + (shop.stock ? "ok" : "bad") }, shop.stock ? `Stok ${shop.stock}` : "Stok habis")))),
    el("section", { class: "card stack", style: "margin-top:14px" },
      el("div", { class: "row" }, el("span", { class: "grow" }, "Jumlah VPS"), el("div", { class: "stepper" }, el("button", { "aria-label": "Kurangi", on: { click: () => step(-1) } }, "−"), out, el("button", { "aria-label": "Tambah", on: { click: () => step(1) } }, "+"))),
      pin, discRow, el("div", { class: "total" }, el("span", { class: "muted" }, "Total bayar"), subEl), btn),
    el("p", { class: "foot", style: "margin-top:16px" }, "Setelah Order, QR pembayaran muncul. Kirim bukti bayar di halaman yang sama, lalu tunggu owner menyetujui. Alur order diadaptasi dari SC Auto Order VPS NAT by @iwawv1."));
}
function payPanel(main, o, shop) {
  const file = el("input", { type: "file", accept: "image/*" }), prev = el("img", { class: "preview", hidden: true, alt: "Pratinjau bukti" });
  let data = null; const err = el("div", { class: "err" });
  const left = el("b", {});
  let fired = false;
  const tick = (init) => { const s = Math.max(0, Math.floor((o.created_at + 30 * 60e3 - Date.now()) / 1000)); left.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; if (!s && !init && !fired) { fired = true; render(); } };
  tick(true); every(1000, () => tick(false));
  file.onchange = async () => {
    err.textContent = ""; data = null; if (!file.files[0]) return;
    try { data = await compress(file.files[0], 1100, .75); prev.src = data; prev.hidden = false; } catch (e) { err.textContent = e.message; prev.hidden = true; }
  };
  const send = el("button", { class: "btn ok block" }, "Kirim bukti bayar");
  send.onclick = guard(async () => {
    if (!data) { err.textContent = "Pilih foto bukti bayar dulu"; return; }
    send.disabled = true;
    try { await api(`/orders/${o.id}/proof`, { method: "POST", body: { image: data } }); toast("Bukti terkirim"); render(); } catch (e) { send.disabled = false; throw e; }
  });
  const cancel = el("button", { class: "btn ghost block", on: { click: guard(async () => { await api(`/orders/${o.id}/cancel`, { method: "POST", body: {} }); render(); }) } }, "Batalkan order");
  main.append(tilt(el("section", { class: "card stack" }, el("h2", {}, "Bayar lewat QR"),
    el("div", { class: "row wrap" }, el("span", { class: "pill" }, o.id), el("span", { class: "pill warn" }, "Sisa waktu ", left)),
    el("p", {}, `${o.qty} × ${shop.product}`), el("div", { class: "total" }, el("span", { class: "muted" }, "Total bayar"), el("b", {}, rp(o.total))),
    el("img", { class: "qr", src: "/api/qr?t=" + o.created_at, alt: "QR pembayaran" }),
    el("label", {}, "Bukti pembayaran (foto/screenshot)"), file, prev, err, send, cancel)));
}
function waitPanel(main, o) {
  main.append(tilt(el("section", { class: "card stack", style: "text-align:center" }, el("div", { class: "big", style: "font-size:48px" }, "⏳"), el("h2", {}, "Menunggu persetujuan owner"),
    el("p", { class: "muted" }, `Order ${o.id} · ${rp(o.total)}. Data VPS otomatis masuk ke menu Pesanan dan notifikasi setelah disetujui.`),
    el("button", { class: "btn ghost", on: { click: guard(async () => { await api(`/orders/${o.id}/cancel`, { method: "POST", body: {} }); render(); }) } }, "Batalkan order"))));
  every(5000, guard(async () => { const d = await api("/orders"); const n = d.orders.find((x) => x.id === o.id); if (n && n.status !== "pending") { toast(n.status === "approved" ? "VPS NAT terkirim 🎉" : "Order " + (n.status === "rejected" ? "ditolak" : "ditutup")); S.tab = n.status === "approved" ? "orders" : "home"; render(); } }));
}

/* ---------- pesanan ---------- */
const ST = { waiting_proof: ["Menunggu bukti", "warn"], pending: ["Menunggu approve", "warn"], approved: ["Selesai", "ok"], rejected: ["Ditolak", "bad"], cancelled: ["Dibatalkan", "bad"], expired: ["Kedaluwarsa", "bad"] };
function vpsCard(v, i) {
  const line = (k, val) => el("div", {}, el("span", { class: "muted" }, k), el("span", { class: "row" }, el("code", {}, val), el("button", { class: "btn ghost sm", on: { click: () => copy(val) } }, "Salin")));
  return el("div", { class: "vps" }, el("b", {}, "VPS " + (i + 1)), line("IP", v.ip), line("Port", v.port), line("User", v.user), line("Password", v.pass),
    el("button", { class: "btn sm", on: { click: () => copy(`ssh ${v.user}@${v.ip} -p ${v.port}\nPassword: ${v.pass}`) } }, "Salin semua"));
}
async function ordersView(main) {
  main.append(el("h2", { style: "margin-bottom:12px" }, "Pesanan saya"));
  const d = await api("/orders").catch(() => null); if (!d) return;
  if (!d.orders.length) return main.append(el("p", { class: "muted" }, "Belum ada pesanan. Mulai dari Beranda."));
  main.append(el("div", { class: "list" }, d.orders.map((o) => {
    const [lb, cl] = ST[o.status] || [o.status, ""];
    return el("div", {}, el("div", { class: "row wrap" }, el("b", { class: "grow" }, o.id), el("span", { class: "pill " + cl }, lb)),
      el("div", { class: "muted" }, `${o.qty} VPS · ${rp(o.total)}${o.promo ? " · " + o.promo : ""} · ${when(o.created_at)}`),
      o.note && el("div", { class: "muted" }, "Catatan owner: " + o.note), o.delivered && o.delivered.map(vpsCard));
  })));
}

/* ---------- chat ---------- */
function chatView(main) {
  const box = el("div", { class: "msgs" }), inp = el("input", { placeholder: "Tulis pesan...", maxLength: 300 });
  let last = 0;
  const isOwner = S.me.role === "owner";
  const add = (m) => {
    last = Math.max(last, m.id);
    const mine = m.username === S.me.username;
    box.append(el("div", { class: "msg" + (mine ? " me" : ""), "data-id": m.id },
      el("small", {}, m.username, m.role === "owner" && el("span", { class: "pill" }, "owner"), el("span", { class: "muted", style: "font-weight:400" }, new Date(m.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })),
        isOwner && el("button", { class: "x", on: { click: guard(async () => { await api("/chat/" + m.id, { method: "DELETE" }); box.querySelector(`[data-id="${m.id}"]`)?.remove(); }) } }, "hapus")),
      el("p", {}, m.text)));
  };
  const pull = guard(async () => {
    const d = await api("/chat?after=" + last); if (!d.messages.length) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    d.messages.forEach(add); if (near || last === d.messages[d.messages.length - 1].id) box.scrollTop = box.scrollHeight;
  });
  const send = guard(async () => { const t = inp.value.trim(); if (!t) return; inp.value = ""; await api("/chat", { method: "POST", body: { text: t } }); pull(); });
  inp.addEventListener("keydown", (e) => e.key === "Enter" && send());
  main.append(el("h2", { style: "margin-bottom:10px" }, "Chat publik"), el("div", { class: "chat" }, box, el("div", { class: "compose" }, inp, el("button", { class: "btn", on: { click: send } }, "Kirim"))));
  pull().then(() => (box.scrollTop = box.scrollHeight)); every(3000, pull);
}

/* ---------- notif ---------- */
async function notifView(main) {
  main.append(el("h2", { style: "margin-bottom:12px" }, "Notifikasi"));
  const d = await api("/notifs").catch(() => null); if (!d) return;
  if (!d.items.length) main.append(el("p", { class: "muted" }, "Belum ada notifikasi."));
  d.items.forEach((n) => main.append(el("div", { class: "notif" + (n.unread ? " unread" : "") }, el("h3", {}, (n.broadcast ? "📢 " : "") + n.title), el("p", {}, n.body), el("small", { class: "muted" }, when(n.created_at)))));
  if (d.unread) { await api("/notifs/read", { method: "POST", body: {} }).catch(() => {}); S.unread = 0; document.querySelector(".bell b").hidden = true; }
}

/* ---------- owner ---------- */
function ownerView(main) {
  const subs = [["sum", "Ringkasan"], ["ord", "Order"], ["stok", "Stok"], ["set", "Pengaturan"], ["usr", "User"], ["bc", "Broadcast"], ["promo", "Promo"]];
  const body = el("div");
  main.append(el("div", { class: "sub-tabs" }, subs.map(([k, l]) => el("button", { class: S.otab === k ? "on" : "", on: { click: () => { S.otab = k; render(); } } }, l))), body);
  ({ sum: oSum, ord: oOrd, stok: oStok, set: oSet, usr: oUsr, bc: oBc, promo: oPromo })[S.otab](body);
}
async function oSum(b) {
  const d = await api("/owner/overview").catch(() => null); if (!d) return;
  const st = [["Total transaksi", d.trx], ["Pendapatan", rp(d.revenue)], ["User", d.users], ["Order menunggu", d.pending], ["Stok ready", d.stok_ready], ["VPS terjual", d.stok_sold], ["User diblokir", d.banned]];
  b.append(el("div", { class: "stats" }, st.map(([l, v]) => tilt(el("div", { class: "stat" }, el("b", {}, v), el("small", {}, l))))));
  if (!d.has_qr) b.append(el("p", { class: "err" }, "QR pembayaran belum diatur — user belum bisa order. Atur di tab Pengaturan."));
  if (d.settings.maintenance) b.append(el("p", { class: "pill warn", style: "margin-top:12px" }, "Mode maintenance sedang aktif"));
}
async function oOrd(b) {
  let f = "pending";
  const list = el("div", { class: "list" });
  const chips = el("div", { class: "sub-tabs" });
  const load = guard(async () => {
    chips.textContent = ""; [["pending", "Menunggu"], ["approved", "Selesai"], ["rejected", "Ditolak"], ["all", "Semua"]].forEach(([k, l]) => chips.append(el("button", { class: f === k ? "on" : "", on: { click: () => { f = k; load(); } } }, l)));
    const d = await api("/owner/orders?status=" + f); list.textContent = "";
    if (!d.orders.length) list.append(el("p", { class: "muted" }, "Tidak ada order."));
    d.orders.forEach((o) => {
      const [lb, cl] = ST[o.status] || [o.status, ""];
      list.append(el("div", {}, el("div", { class: "row wrap" }, el("b", { class: "grow" }, `${o.id} · ${o.username}`), el("span", { class: "pill " + cl }, lb)),
        el("div", { class: "muted" }, `${o.qty} VPS · ${rp(o.total)}${o.promo ? " · " + o.promo : ""} · ${when(o.created_at)}`),
        el("div", { class: "row wrap", style: "margin-top:8px" },
          o.has_proof && el("button", { class: "btn ghost sm", on: { click: () => viewImage("/api/owner/orders/" + o.id + "/proof") } }, "Lihat bukti"),
          o.status === "pending" && el("button", { class: "btn ok sm", on: { click: guard(async () => { await api(`/owner/orders/${o.id}/approve`, { method: "POST", body: {} }); toast("VPS terkirim ke user"); load(); }) } }, "Setujui & kirim VPS"),
          o.status === "pending" && el("button", { class: "btn bad sm", on: { click: guard(async () => { const r = await modal("Tolak order " + o.id, [{ name: "note", label: "Alasan (dikirim ke user)", max: 200 }], "Tolak"); if (!r) return; await api(`/owner/orders/${o.id}/reject`, { method: "POST", body: { note: r.note } }); load(); }) } }, "Tolak"))));
    });
  });
  b.append(chips, list); load();
}
async function oStok(b) {
  const ta = el("textarea", { placeholder: "Tempel data VPS. Format bebas berlabel (IP / Port / Username / Password) atau satu baris: ip|port|user|password\nBanyak VPS berlabel dipisah baris ---", rows: 6, maxLength: 20000 });
  const list = el("div", { class: "list" }), info = el("p", { class: "muted" });
  const load = guard(async () => {
    const d = await api("/owner/stok"); list.textContent = ""; info.textContent = `${d.items.filter((i) => i.status === "ready").length} ready · ${d.items.filter((i) => i.status === "reserved").length} dipesan`;
    d.items.forEach((i) => list.append(el("div", { class: "row" }, el("div", { class: "grow" }, el("code", {}, `${i.ip}:${i.port}`), el("div", { class: "muted" }, `${i.vuser}${i.hostname ? " · " + i.hostname : ""}`)),
      el("span", { class: "pill " + (i.status === "ready" ? "ok" : "warn") }, i.status), i.status === "ready" && el("button", { class: "btn ghost sm", on: { click: guard(async () => { await api("/owner/stok/" + i.id, { method: "DELETE" }); load(); }) } }, "Hapus"))));
  });
  b.append(el("div", { class: "card stack" }, el("h3", {}, "Tambah stok VPS NAT"), ta,
    el("button", { class: "btn block", on: { click: guard(async () => { const d = await api("/owner/stok", { method: "POST", body: { data: ta.value } }); toast(d.added + " VPS ditambahkan"); ta.value = ""; load(); }) } }, "Tambah ke stok")), el("div", { style: "height:14px" }), info, list);
  load();
}
async function oSet(b) {
  const d = await api("/owner/overview").catch(() => null); if (!d) return; const s = d.settings;
  const qrImg = el("img", { class: "qr", src: "/api/qr?t=" + Date.now(), alt: "QR saat ini", hidden: !d.has_qr });
  const file = el("input", { type: "file", accept: "image/*" });
  file.onchange = guard(async () => { if (!file.files[0]) return; const img = await compress(file.files[0], 1200, .9); await api("/owner/qr", { method: "POST", body: { image: img } }); qrImg.src = img; qrImg.hidden = false; toast("QR diperbarui"); });
  const f = (k, label, v, type) => [el("label", {}, label), el("input", { name: k, value: v, type: type || "text", maxLength: 100 })];
  const form = el("div", {}, f("site_name", "Nama website", s.site_name), f("product_name", "Nama produk", s.product_name), f("price", "Harga per VPS (Rp)", s.price, "number"), f("spec", "Spesifikasi", s.spec), f("provider", "Nama provider", s.provider));
  const mm = el("input", { value: s.maintenance_msg, maxLength: 200 }), mt = el("input", { type: "checkbox", checked: s.maintenance, style: "width:22px;height:22px" });
  b.append(el("div", { class: "card stack" }, el("h3", {}, "QR pembayaran"), el("p", { class: "muted" }, "QR ini otomatis dikirim ke user saat menekan Order."), qrImg, file),
    el("div", { style: "height:14px" }), el("div", { class: "card" }, el("h3", {}, "Produk"), form,
      el("button", { class: "btn block", style: "margin-top:14px", on: { click: guard(async () => { const body = {}; form.querySelectorAll("input").forEach((i) => (body[i.name] = i.value)); await api("/owner/settings", { method: "POST", body }); S.status.site_name = body.site_name || S.status.site_name; toast("Tersimpan"); }) } }, "Simpan")),
    el("div", { style: "height:14px" }), el("div", { class: "card" }, el("div", { class: "switch" }, el("div", {}, el("h3", {}, "Mode maintenance"), el("p", { class: "muted" }, "User biasa tidak bisa masuk, owner tetap bisa.")), mt),
      el("label", {}, "Pesan maintenance"), mm,
      el("button", { class: "btn block", style: "margin-top:14px", on: { click: guard(async () => { await api("/owner/settings", { method: "POST", body: { maintenance: mt.checked, maintenance_msg: mm.value } }); toast(mt.checked ? "Maintenance AKTIF" : "Maintenance dimatikan"); }) } }, "Simpan maintenance")));
}
async function oUsr(b) {
  const q = el("input", { placeholder: "Cari username..." }), list = el("div", { class: "list" });
  const load = guard(async () => {
    const d = await api("/owner/users?q=" + encodeURIComponent(q.value)); list.textContent = "";
    d.users.forEach((u) => list.append(el("div", {}, el("div", { class: "row wrap" }, el("b", { class: "grow" }, u.username), u.role === "owner" && el("span", { class: "pill" }, "owner"), u.banned ? el("span", { class: "pill bad" }, "diblokir") : el("span", { class: "pill ok" }, "aktif")),
      el("div", { class: "muted" }, `Gabung ${when(u.created_at)} · ${u.trx} trx${u.ban_reason ? " · " + u.ban_reason : ""}`),
      u.role !== "owner" && el("div", { class: "row wrap", style: "margin-top:8px" },
        el("button", { class: "btn ghost sm", on: { click: guard(async () => { const r = await modal("Notif ke " + u.username, [{ name: "title", label: "Judul", max: 60 }, { name: "body", label: "Isi", type: "textarea", max: 500 }]); if (!r) return; await api("/owner/notify", { method: "POST", body: { user_id: u.id, ...r } }); toast("Notif terkirim"); }) } }, "Kirim notif"),
        u.banned ? el("button", { class: "btn ok sm", on: { click: guard(async () => { await api(`/owner/users/${u.id}/unban`, { method: "POST", body: {} }); load(); }) } }, "Unban")
          : el("button", { class: "btn bad sm", on: { click: guard(async () => { const r = await modal("Ban " + u.username, [{ name: "reason", label: "Alasan (ditampilkan ke user)", max: 120 }], "Ban"); if (!r) return; await api(`/owner/users/${u.id}/ban`, { method: "POST", body: r }); load(); }) } }, "Ban")))));
  });
  q.addEventListener("input", () => { clearTimeout(q._t); q._t = setTimeout(load, 300); });
  b.append(q, el("div", { style: "height:10px" }), list); load();
}
function oBc(b) {
  const t = el("input", { placeholder: "Judul", maxLength: 60 }), x = el("textarea", { placeholder: "Isi pesan untuk semua user", maxLength: 500 });
  b.append(el("div", { class: "card stack" }, el("h3", {}, "Broadcast ke semua user"), el("p", { class: "muted" }, "Pesan muncul di notifikasi setiap user."), t, x,
    el("button", { class: "btn block", on: { click: guard(async () => { await api("/owner/notify", { method: "POST", body: { title: t.value, body: x.value } }); toast("Broadcast terkirim"); t.value = x.value = ""; }) } }, "Kirim broadcast")));
}
async function oPromo(b) {
  const code = el("input", { placeholder: "Kode (kosong = acak)", maxLength: 20 }), type = el("select", {}, el("option", { value: "percent" }, "Persen (%)"), el("option", { value: "fixed" }, "Potongan Rp")),
    val = el("input", { type: "number", placeholder: "Nilai diskon", min: 1 }), mx = el("input", { type: "number", placeholder: "Maks. pemakaian (opsional)", min: 1 }), days = el("input", { type: "number", placeholder: "Berlaku berapa hari (opsional)", min: 1 });
  const list = el("div", { class: "list" });
  const load = guard(async () => {
    const d = await api("/owner/codes"); list.textContent = "";
    d.codes.forEach((c) => list.append(el("div", { class: "row" }, el("div", { class: "grow" }, el("b", {}, c.code), el("div", { class: "muted" }, `${c.type === "percent" ? c.value + "%" : rp(c.value)} · dipakai ${c.used}${c.max_uses ? "/" + c.max_uses : ""}${c.expires_at ? " · sampai " + when(c.expires_at) : ""}`)),
      el("button", { class: "btn ghost sm", on: { click: guard(async () => { await api("/owner/codes/" + c.code, { method: "DELETE" }); load(); }) } }, "Hapus"))));
  });
  b.append(el("div", { class: "card stack" }, el("h3", {}, "Buat kode promo"), code, type, val, mx, days,
    el("button", { class: "btn block", on: { click: guard(async () => { const r = await api("/owner/codes", { method: "POST", body: { code: code.value, type: type.value, value: val.value, max_uses: mx.value, days: days.value } }); toast("Kode dibuat: " + r.code); load(); }) } }, "Buat kode")), el("div", { style: "height:14px" }), list);
  load();
}

boot();
})();
