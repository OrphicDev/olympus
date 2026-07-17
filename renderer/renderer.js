"use strict";
const $ = (id) => document.getElementById(id);

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
  refreshLocks(); refreshEnv(); refreshTitan(); startChat();
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
