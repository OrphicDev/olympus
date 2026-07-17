"use strict";
const $ = (id) => document.getElementById(id);

// ══════════ THÈME (sombre / clair) ══════════
function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); localStorage.setItem("olympusTheme", t); }
applyTheme(localStorage.getItem("olympusTheme") || "dark");
$("themeToggle").onclick = () => applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");

// ══════════ NAVIGATION ══════════
document.querySelectorAll(".nav-item").forEach((it) => {
  it.onclick = () => {
    if (it.classList.contains("locked")) return;
    document.querySelectorAll(".nav-item").forEach((x) => x.classList.remove("active"));
    it.classList.add("active");
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("show"));
    $("page-" + it.dataset.page).classList.add("show");
  };
});
function goTo(page) {
  const it = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (it && !it.classList.contains("locked")) it.click();
}
document.querySelectorAll("[data-ext]").forEach((b) => { b.onclick = () => window.olympus.openExternal(b.dataset.ext); });

// ══════════ APPS : verrouillage (Pegasus / Zevs) ══════════
async function refreshLocks() {
  const peg = await window.olympus.pegasusStatus();
  const pegNav = document.querySelector('.nav-item[data-app="pegasus"]');
  const lock = pegNav.querySelector(".lock");
  const badge = $("libPegBadge"), btn = $("libPegBtn");
  if (peg.installed) {
    pegNav.classList.remove("locked"); if (lock) lock.style.display = "none";
    badge.className = "badge yes"; badge.innerHTML = '<span class="dot"></span> Installé';
    btn.className = "btn ok"; btn.textContent = "Ouvrir les réglages"; btn.onclick = () => goTo("pegasus");
  } else {
    pegNav.classList.add("locked"); if (lock) lock.style.display = "";
    badge.className = "badge no"; badge.innerHTML = '<span class="dot"></span> Non installé';
    btn.className = "btn"; btn.textContent = "Installer"; btn.onclick = () => $("libPegBox").classList.toggle("show");
  }

  const zevs = await window.olympus.zevsStatus();
  const zevNav = document.querySelector('.nav-item[data-app="zevs"]');
  const zevLock = zevNav.querySelector(".lock");
  const zevBadge = $("libZevBadge"), zevBtn = $("libZevBtn");
  if (zevs.installed) {
    zevNav.classList.remove("locked"); if (zevLock) zevLock.style.display = "none";
    zevBadge.className = "badge yes"; zevBadge.innerHTML = '<span class="dot"></span> Installé';
    zevBtn.textContent = "Ouvrir Zevs"; zevBtn.onclick = () => window.olympus.openZevs();
  } else {
    zevNav.classList.add("locked"); if (zevLock) zevLock.style.display = "";
    zevBadge.className = "badge no"; zevBadge.innerHTML = '<span class="dot"></span> Non installé';
    zevBtn.textContent = "Télécharger · 101 Mo"; zevBtn.onclick = installZevs;
  }
}

// ── Zevs : téléchargement + install
window.olympus.onZevsProgress((d) => {
  $("zevProg").classList.add("show");
  if (d.phase === "download") { $("zevBar").style.width = d.pct + "%"; $("zevText").textContent = "Téléchargement… " + d.pct + "%"; }
  else if (d.phase === "install") { $("zevBar").style.width = "100%"; $("zevText").textContent = d.pct < 100 ? "Installation…" : "Presque fini…"; }
});
async function installZevs() {
  const btn = $("libZevBtn"), msg = $("zevMsg");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>En cours…'; msg.className = "msg"; msg.textContent = "";
  const r = await window.olympus.installZevs();
  btn.disabled = false;
  if (r.ok) { $("zevProg").classList.remove("show"); msg.className = "msg ok"; msg.innerHTML = "✅ Zevs installé !"; await refreshLocks(); goTo("zevs"); }
  else { $("zevProg").classList.remove("show"); msg.className = "msg err"; msg.textContent = r.error || "Échec."; btn.textContent = "Réessayer"; }
}
$("zevOpenBtn").onclick = () => window.olympus.openZevs();

// ══════════ ENVIRONNEMENT ══════════
async function refreshEnv() {
  const env = await window.olympus.checkEnv();
  const rows = [["Node.js", env.node], ["Claude Code", env.claude], ["WordPress local", env.wp]];
  $("envList").innerHTML = rows.map(([name, e]) => {
    const cls = e.ok ? "ok" : "miss", icon = e.ok ? "✓" : "!";
    return `<div class="env-row"><div class="st ${cls}">${icon}</div><div><div class="nm">${name}</div><div class="meta">${e.detail}</div></div></div>`;
  }).join("");
}

// ══════════ PEGASUS : widget d'installation par code ══════════
function wireInstaller(codeId, connectId, msgId, boxId) {
  const codeEl = $(codeId), btn = $(connectId), msg = $(msgId);
  codeEl.addEventListener("input", () => {
    const raw = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    codeEl.value = raw.match(/.{1,4}/g)?.join("-") || raw;
  });
  codeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  btn.onclick = run;
  async function run() {
    const code = codeEl.value.trim();
    if (code.replace(/[^A-Z0-9]/g, "").length < 8) { msg.className = "msg err"; msg.textContent = "Entre ton code complet."; return; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Connexion…'; msg.className = "msg"; msg.textContent = "";
    const r = await window.olympus.installPegasus(code);
    btn.disabled = false; btn.textContent = "Connecter";
    if (r.ok) { msg.className = "msg ok"; msg.innerHTML = "✅ Clé installée !"; if (boxId) $(boxId).classList.remove("show"); codeEl.value = ""; await refreshLocks(); goTo("pegasus"); }
    else { msg.className = "msg err"; msg.textContent = r.error || "Échec."; }
  }
}
$("setPegBtn").onclick = () => $("setPegBox").classList.toggle("show");
wireInstaller("libPegCode", "libPegConnect", "libPegMsg", "libPegBox");
wireInstaller("setPegCode", "setPegConnect", "setPegMsg", "setPegBox");

// ══════════ RÔLE (depuis la session) ══════════
let currentRole = "classic";
let currentUserId = null;
function applyRole() {
  const isAdmin = currentRole === "super_admin";
  const titanNav = document.querySelector('.nav-item[data-app="titan"]');
  const lock = titanNav.querySelector(".lock");
  if (isAdmin) { titanNav.classList.remove("locked"); if (lock) lock.style.display = "none"; }
  else { titanNav.classList.add("locked"); if (lock) lock.style.display = ""; if ($("page-titan").classList.contains("show")) goTo("library"); }
  $("membersSection").style.display = isAdmin ? "" : "none";
}

// ══════════ TITAN ══════════
async function refreshTitan() {
  const t = await window.olympus.titanStatus();
  const pathEl = $("titanDestPath");
  if (pathEl) { pathEl.textContent = t.workspace; pathEl.title = t.workspace; }
  $("titanOpenBtn").style.display = t.installed ? "" : "none";
  $("titanInstallBtn").textContent = t.installed ? "Mettre à jour l'espace dev" : "Tout installer en un clic";
}
$("titanOpenBtn").onclick = () => window.olympus.openTitan();
$("titanPickBtn").onclick = async () => {
  const r = await window.olympus.pickTitanFolder();
  if (r && r.workspace) { const el = $("titanDestPath"); el.textContent = r.workspace; el.title = r.workspace; }
};
window.olympus.onTitanProgress((d) => {
  $("titanProg").classList.add("show");
  $("titanBar").style.width = (d.pct || 0) + "%"; $("titanText").textContent = d.msg || "";
});
$("titanInstallBtn").onclick = async () => {
  const btn = $("titanInstallBtn"), msg = $("titanMsg");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>En cours…'; msg.className = "msg"; msg.textContent = "";
  const r = await window.olympus.installTitan();
  btn.disabled = false;
  if (r.ok) { $("titanProg").classList.remove("show"); msg.className = "msg ok"; msg.innerHTML = "✅ Espace dev prêt : " + r.workspace; refreshTitan(); }
  else { $("titanProg").classList.remove("show"); msg.className = "msg err"; msg.textContent = r.error || "Échec."; btn.textContent = "Réessayer"; }
};

// ══════════ MEMBRES (super admin) ══════════
async function refreshMembers() {
  const r = await window.olympus.membersList();
  const list = $("membersList");
  if (!r.ok) { list.innerHTML = `<div class="env-row"><div class="st miss">!</div><div><div class="nm">${r.error}</div></div></div>`; return; }
  if (!r.members.length) { list.innerHTML = '<div class="env-row"><div><div class="meta">Aucun membre.</div></div></div>'; return; }
  list.innerHTML = r.members.map((m) => {
    const name = ((m.first_name || "") + " " + (m.last_name || "")).trim() || m.email;
    const roleLabel = m.role === "super_admin" ? "super admin" : "classic";
    const mark = m.role === "super_admin" ? "★" : "•";
    const toggleRole = m.role === "super_admin" ? "classic" : "super_admin";
    const toggleLabel = m.role === "super_admin" ? "Passer classic" : "Passer super admin";
    const actions = m.id === currentUserId
      ? '<span class="member-self">vous</span>'
      : `<div class="member-actions">
           <button class="member-btn" data-act="role" data-id="${m.id}" data-role="${toggleRole}">${toggleLabel}</button>
           <button class="member-btn" data-act="reset" data-id="${m.id}" data-name="${name}">Réinit. mdp</button>
           <button class="member-btn danger" data-act="delete" data-id="${m.id}" data-name="${name}">Supprimer</button>
         </div>`;
    return `<div class="env-row"><div class="st ${m.role === "super_admin" ? "ok" : ""}">${mark}</div><div style="flex:1"><div class="nm">${name}</div><div class="meta">${m.email} · ${roleLabel}</div></div>${actions}</div>`;
  }).join("");
}

// Actions sur un membre (délégation)
$("membersList").onclick = async (e) => {
  const btn = e.target.closest(".member-btn");
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act, name = btn.dataset.name || "ce membre", msg = $("mMsg");
  if (act === "role") {
    btn.disabled = true;
    const r = await window.olympus.membersSetRole(id, btn.dataset.role);
    msg.className = r.ok ? "msg ok" : "msg err"; msg.textContent = r.ok ? "Rôle mis à jour." : (r.error || "Échec.");
    refreshMembers();
  } else if (act === "reset") {
    btn.disabled = true;
    const r = await window.olympus.membersResetPassword(id);
    if (r.ok) { msg.className = "msg ok"; msg.textContent = `Nouveau mot de passe temporaire de ${name} : ${r.tempPassword}  — transmets-le, il devra le changer.`; }
    else { msg.className = "msg err"; msg.textContent = r.error || "Échec."; }
    btn.disabled = false;
  } else if (act === "delete") {
    if (!confirm(`Supprimer ${name} ? Cette action est définitive.`)) return;
    btn.disabled = true;
    const r = await window.olympus.membersDelete(id);
    msg.className = r.ok ? "msg ok" : "msg err"; msg.textContent = r.ok ? `${name} supprimé.` : (r.error || "Échec.");
    refreshMembers();
  }
};
$("mCreateBtn").onclick = async () => {
  const d = { first_name: $("mFirst").value.trim(), last_name: $("mLast").value.trim(), email: $("mEmail").value.trim(), password: $("mPw").value, role: $("mRole").value };
  const msg = $("mMsg"), btn = $("mCreateBtn");
  btn.disabled = true; btn.textContent = "Création…"; msg.className = "msg"; msg.textContent = "";
  const r = await window.olympus.membersCreate(d);
  btn.disabled = false; btn.textContent = "Créer le membre";
  if (!r.ok) { msg.className = "msg err"; msg.textContent = r.error; return; }
  msg.className = "msg ok"; msg.textContent = `✅ ${d.first_name} créé. Transmets-lui son mot de passe temporaire.`;
  ["mFirst", "mLast", "mEmail", "mPw"].forEach((id) => ($(id).value = ""));
  refreshMembers();
};

// ══════════ HERMÈS (chat) ══════════
let chatLastId = 0, chatTimer = null;
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtTime(iso) { try { return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }
function appendMessage(m) {
  const box = $("chatMessages");
  const mine = m.user_id === currentUserId;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const el = document.createElement("div");
  el.className = "bubble " + (mine ? "me" : "them");
  el.innerHTML = `${mine ? "" : `<div class="author">${escapeHtml(m.author_name || "?")}</div>`}<div>${escapeHtml(m.body)}</div><div class="time">${fmtTime(m.created_at)}</div>`;
  box.appendChild(el);
  if (mine || near) box.scrollTop = box.scrollHeight;
}
async function chatTick() {
  const r = await window.olympus.chatList(chatLastId);
  if (r.ok && r.messages && r.messages.length) {
    r.messages.forEach(appendMessage);
    chatLastId = r.messages[r.messages.length - 1].id;
  }
}
function startChat() {
  $("chatMessages").innerHTML = ""; chatLastId = 0;
  chatTick();
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = setInterval(chatTick, 3000);
}
async function sendMsg() {
  const input = $("chatInput"), body = input.value.trim();
  if (!body) return;
  input.value = "";
  const r = await window.olympus.chatSend(body);
  if (r.ok && r.message) { appendMessage(r.message); chatLastId = Math.max(chatLastId, r.message.id); }
  else if (!r.ok) { input.value = body; }
}
$("chatSend").onclick = sendMsg;
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendMsg(); });

// ══════════ CHRONOS (calendrier) ══════════
let calDate = new Date();
let calSelected = null;
let editingEvent = null;
let chronosEvents = [];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const pad2 = (n) => String(n).padStart(2, "0");
const isoD = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

async function renderChronos() {
  const y = calDate.getFullYear(), m = calDate.getMonth();
  $("calMonth").textContent = MONTHS[m] + " " + y;
  $("calDow").innerHTML = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("");

  const startOffset = (new Date(y, m, 1).getDay() + 6) % 7; // Lundi = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const startCell = new Date(y, m, 1 - startOffset);
  const endCell = new Date(y, m, 1 - startOffset + totalCells - 1);
  const from = isoD(startCell.getFullYear(), startCell.getMonth(), startCell.getDate());
  const to = isoD(endCell.getFullYear(), endCell.getMonth(), endCell.getDate());

  const r = await window.olympus.chronosList(from, to);
  chronosEvents = r.ok ? r.events : [];
  const byDate = {};
  for (const ev of chronosEvents) (byDate[ev.date] = byDate[ev.date] || []).push(ev);

  const now = new Date();
  const todayIso = isoD(now.getFullYear(), now.getMonth(), now.getDate());
  let html = "";
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(y, m, 1 - startOffset + i);
    const dIso = isoD(d.getFullYear(), d.getMonth(), d.getDate());
    const cls = (d.getMonth() !== m ? " other" : "") + (dIso === todayIso ? " today" : "") + (dIso === calSelected ? " sel" : "");
    const chips = (byDate[dIso] || []).map((ev) =>
      `<div class="ev-chip cat-${ev.category || "general"}${ev.done ? " done" : ""}" data-ev="${ev.id}">${ev.time ? ev.time.slice(0, 5) + " " : ""}${escapeHtml(ev.title)}</div>`
    ).join("");
    html += `<div class="cal-cell${cls}" data-date="${dIso}"><div class="cal-daynum">${d.getDate()}</div>${chips}</div>`;
  }
  $("calGrid").innerHTML = html;
}

$("calPrev").onclick = () => { calDate = new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1); renderChronos(); };
$("calNext").onclick = () => { calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1); renderChronos(); };
$("calToday").onclick = () => { calDate = new Date(); renderChronos(); };
$("calAdd").onclick = () => { const n = new Date(); openEventForm(calSelected || isoD(n.getFullYear(), n.getMonth(), n.getDate())); };

$("calGrid").onclick = (e) => {
  const chip = e.target.closest(".ev-chip");
  if (chip) { const ev = chronosEvents.find((x) => String(x.id) === chip.dataset.ev); if (ev) openEventForm(ev.date, ev); return; }
  const cell = e.target.closest(".cal-cell");
  if (cell) { calSelected = cell.dataset.date; openEventForm(cell.dataset.date); }
};

function openEventForm(date, ev) {
  editingEvent = ev || null;
  $("evTitle").value = ev?.title || "";
  $("evDate").value = date;
  $("evTime").value = ev?.time ? ev.time.slice(0, 5) : "";
  $("evCat").value = ev?.category || "general";
  $("evAssignee").value = ev?.assignee || "";
  $("evSave").textContent = ev ? "Enregistrer" : "Ajouter";
  $("evDelete").style.display = ev ? "" : "none";
  $("evDone").style.display = ev ? "" : "none";
  if (ev) $("evDone").textContent = ev.done ? "Marquer à faire" : "Marquer fait";
  $("evMsg").textContent = "";
  $("calForm").classList.add("show");
  $("evTitle").focus();
}
$("evCancel").onclick = () => $("calForm").classList.remove("show");
$("evSave").onclick = async () => {
  const data = { title: $("evTitle").value.trim(), date: $("evDate").value, time: $("evTime").value || null, category: $("evCat").value, assignee: $("evAssignee").value.trim() || null };
  if (!data.title || !data.date) { $("evMsg").className = "msg err"; $("evMsg").textContent = "Titre et date requis."; return; }
  const r = editingEvent ? await window.olympus.chronosUpdate(editingEvent.id, data) : await window.olympus.chronosCreate(data);
  if (r.ok) { $("calForm").classList.remove("show"); renderChronos(); refreshRightbar(); }
  else { $("evMsg").className = "msg err"; $("evMsg").textContent = r.error || "Échec."; }
};
$("evDelete").onclick = async () => {
  if (!editingEvent) return;
  const r = await window.olympus.chronosDelete(editingEvent.id);
  if (r.ok) { $("calForm").classList.remove("show"); renderChronos(); refreshRightbar(); }
};
$("evDone").onclick = async () => {
  if (!editingEvent) return;
  const r = await window.olympus.chronosUpdate(editingEvent.id, { done: !editingEvent.done });
  if (r.ok) { $("calForm").classList.remove("show"); renderChronos(); refreshRightbar(); }
};
document.querySelector('.nav-item[data-page="chronos"]').addEventListener("click", renderChronos);

// ══════════ COLONNE DROITE (infos) + présence ══════════
let rbTimer = null;
async function refreshRightbar() {
  const now = new Date();
  const today = isoD(now.getFullYear(), now.getMonth(), now.getDate());
  const in30 = new Date(now.getTime() + 30 * 864e5);
  const to = isoD(in30.getFullYear(), in30.getMonth(), in30.getDate());
  const r = await window.olympus.chronosList(today, to);
  const evs = (r.ok ? r.events : []).filter((e) => !e.done);
  const todayEvs = evs.filter((e) => e.date === today);
  const soonEvs = evs.filter((e) => e.date > today).slice(0, 5);
  $("rbToday").innerHTML = todayEvs.length
    ? todayEvs.map((e) => `<div class="rb-ev"><span class="rb-time">${e.time ? e.time.slice(0, 5) : "—"}</span><span class="rb-t">${escapeHtml(e.title)}</span></div>`).join("")
    : '<div class="rb-empty">Rien de prévu.</div>';
  $("rbSoon").innerHTML = soonEvs.length
    ? soonEvs.map((e) => { const d = new Date(e.date + "T00:00"); return `<div class="rb-ev"><span class="rb-time">${d.getDate()}/${d.getMonth() + 1}</span><span class="rb-t">${escapeHtml(e.title)}</span></div>`; }).join("")
    : '<div class="rb-empty">—</div>';
  const p = await window.olympus.presenceOnline();
  const users = p.ok ? p.users : [];
  const nowMs = Date.now();
  const isOn = (u) => nowMs - new Date(u.last_seen).getTime() < 120000;
  users.sort((a, b) => (isOn(b) - isOn(a)) || (a.name || "").localeCompare(b.name || ""));
  $("rbOnline").innerHTML = users.length
    ? users.map((u) => { const on = isOn(u); const n = u.name || "?"; return `<div class="rb-user"><div class="avatar-sm">${escapeHtml(n.charAt(0).toUpperCase())}</div><span style="flex:1${on ? "" : ";color:var(--muted)"}">${escapeHtml(n)}</span><span class="status-dot ${on ? "on" : "off"}"></span></div>`; }).join("")
    : '<div class="rb-empty">—</div>';
}
function startPresence() {
  window.olympus.presenceBeat();
  refreshRightbar();
  if (rbTimer) clearInterval(rbTimer);
  rbTimer = setInterval(() => { window.olympus.presenceBeat(); refreshRightbar(); }, 30000);
}

// ══════════ IRIS (email · CRM) ══════════
async function refreshIris() {
  const st = await window.olympus.irisStatus();
  $("irisConnect").style.display = st.connected ? "none" : "";
  $("irisMain").style.display = st.connected ? "" : "none";
  if (st.connected) { $("irisFrom").textContent = "· " + st.email; refreshCrm(); }
}
async function refreshCrm() {
  const r = await window.olympus.crmEmails();
  const list = $("crmList");
  const emails = r.ok ? r.emails : [];
  list.innerHTML = emails.length ? emails.map((e) => {
    const opened = (e.open_count || 0) > 0;
    const when = new Date(e.sent_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const info = opened ? `Ouvert ✓${e.open_count > 1 ? " ×" + e.open_count : ""}` : "Non ouvert";
    return `<div class="crm-row"><div style="flex:1;min-width:0"><div class="crm-to">${escapeHtml(e.to_name || e.to_email)}</div><div class="crm-sub">${escapeHtml(e.subject || "")}</div><div class="crm-meta">${escapeHtml(e.to_email)} · ${when}${e.sent_by_name ? " · " + escapeHtml(e.sent_by_name) : ""}</div></div><span class="crm-open ${opened ? "yes" : "no"}">${info}</span></div>`;
  }).join("") : '<div class="rb-empty">Aucun mail envoyé.</div>';
}
$("gmConnectBtn").onclick = async () => {
  const email = $("gmEmail").value.trim(), pass = $("gmPass").value.trim(), msg = $("gmMsg"), btn = $("gmConnectBtn");
  if (!email || !pass) { msg.className = "msg err"; msg.textContent = "Email et mot de passe requis."; return; }
  btn.disabled = true; msg.className = "msg"; msg.textContent = "Vérification…";
  const r = await window.olympus.irisConnect(email, pass);
  btn.disabled = false;
  if (r.ok) { $("gmPass").value = ""; msg.textContent = ""; refreshIris(); }
  else { msg.className = "msg err"; msg.textContent = r.error; }
};
$("gmDisconnect").onclick = async () => { await window.olympus.irisDisconnect(); refreshIris(); };
$("mailSendBtn").onclick = async () => {
  const d = { to: $("mailTo").value.trim(), toName: $("mailToName").value.trim(), subject: $("mailSubject").value.trim(), body: $("mailBody").value.trim() };
  const msg = $("mailMsg"), btn = $("mailSendBtn");
  if (!d.to || !d.subject || !d.body) { msg.className = "msg err"; msg.textContent = "Destinataire, sujet et message requis."; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Envoi…'; msg.className = "msg"; msg.textContent = "";
  const r = await window.olympus.irisSend(d);
  btn.disabled = false; btn.textContent = "Envoyer";
  if (r.ok) { msg.className = "msg ok"; msg.textContent = "✅ Envoyé — suivi d'ouverture actif."; ["mailTo", "mailToName", "mailSubject", "mailBody"].forEach((id) => ($(id).value = "")); refreshCrm(); }
  else { msg.className = "msg err"; msg.textContent = r.error; }
};
document.querySelector('.nav-item[data-page="iris"]').addEventListener("click", refreshIris);

// ══════════ AUTH ══════════
let pendingUser = null;

function showAuthView(id) {
  ["view-login", "view-bootstrap", "view-setpw"].forEach((v) => $(v).classList.toggle("hidden", v !== id));
  $("auth").classList.remove("hidden");
  $("hub").classList.add("hidden");
}

function enterHub(user) {
  currentRole = user.role || "classic";
  currentUserId = user.id || null;
  $("auth").classList.add("hidden");
  $("hub").classList.remove("hidden");
  const name = ((user.first_name || "") + " " + (user.last_name || "")).trim() || user.email;
  $("accName").textContent = name;
  $("accRole").textContent = user.role === "super_admin" ? "super admin" : "membre";
  $("accAvatar").textContent = (user.first_name || user.email || "?").charAt(0).toUpperCase();
  applyRole();
  refreshLocks(); refreshEnv(); refreshTitan(); startChat(); renderChronos(); startPresence(); refreshIris();
  if (currentRole === "super_admin") refreshMembers();
  goTo("library");
}

// Connexion
$("loginBtn").onclick = doLogin;
$("loginPw").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
async function doLogin() {
  const email = $("loginEmail").value, pw = $("loginPw").value, msg = $("loginMsg"), btn = $("loginBtn");
  btn.disabled = true; btn.textContent = "Connexion…"; msg.className = "auth-msg"; msg.textContent = "";
  const r = await window.olympus.authLogin(email, pw);
  btn.disabled = false; btn.textContent = "Se connecter";
  if (!r.ok) { msg.className = "auth-msg err"; msg.textContent = r.error; return; }
  if (r.mustReset) { pendingUser = r.user; showAuthView("view-setpw"); return; }
  enterHub(r.user);
}

// Première install (bootstrap super admin)
$("bootstrapLink").onclick = () => showAuthView("view-bootstrap");
$("bsBackLink").onclick = () => showAuthView("view-login");
$("bsBtn").onclick = async () => {
  const d = { first_name: $("bsFirst").value.trim(), last_name: $("bsLast").value.trim(), email: $("bsEmail").value.trim(), password: $("bsPw").value };
  const msg = $("bsMsg"), btn = $("bsBtn");
  btn.disabled = true; btn.textContent = "Création…"; msg.className = "auth-msg"; msg.textContent = "";
  const r = await window.olympus.authBootstrap(d);
  if (!r.ok) { btn.disabled = false; btn.textContent = "Créer mon compte"; msg.className = "auth-msg err"; msg.textContent = r.error; return; }
  const lr = await window.olympus.authLogin(d.email, d.password);
  btn.disabled = false; btn.textContent = "Créer mon compte";
  if (lr.ok) enterHub(lr.user);
  else { showAuthView("view-login"); $("loginEmail").value = d.email; }
};

// Changement de mot de passe (1ʳᵉ connexion)
$("spwBtn").onclick = async () => {
  const p1 = $("spwNew").value, p2 = $("spwConfirm").value, msg = $("spwMsg");
  if (p1.length < 8) { msg.className = "auth-msg err"; msg.textContent = "8 caractères minimum."; return; }
  if (p1 !== p2) { msg.className = "auth-msg err"; msg.textContent = "Les mots de passe ne correspondent pas."; return; }
  const btn = $("spwBtn"); btn.disabled = true; btn.textContent = "Enregistrement…";
  const r = await window.olympus.authSetPassword(p1);
  btn.disabled = false; btn.textContent = "Enregistrer et continuer";
  if (!r.ok) { msg.className = "auth-msg err"; msg.textContent = r.error; return; }
  enterHub(pendingUser || { role: "classic" });
};

// Déconnexion
$("logoutBtn").onclick = async () => { await window.olympus.authLogout(); location.reload(); };

// ══════════ DÉMARRAGE ══════════
(async function boot() {
  const s = await window.olympus.authSession();
  if (s && s.user) {
    if (s.mustReset) { pendingUser = s.user; showAuthView("view-setpw"); }
    else enterHub(s.user);
  } else {
    const nb = await window.olympus.authNeedsBootstrap();
    if (nb && nb.possible) $("bootstrapLink").classList.remove("hidden");
    showAuthView("view-login");
  }
})();
