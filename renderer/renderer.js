"use strict";
const $ = (id) => document.getElementById(id);

// ── Navigation (les onglets verrouillés sont inertes)
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

// ── Liens externes
document.querySelectorAll("[data-ext]").forEach((b) => {
  b.onclick = () => window.olympus.openExternal(b.dataset.ext);
});

// ── Verrouillage des onglets selon l'état d'installation
async function refreshLocks() {
  const peg = await window.olympus.pegasusStatus();
  const pegNav = document.querySelector('.nav-item[data-app="pegasus"]');
  const lock = pegNav.querySelector(".lock");
  if (peg.installed) {
    pegNav.classList.remove("locked");
    if (lock) lock.style.display = "none";
  } else {
    pegNav.classList.add("locked");
    if (lock) lock.style.display = "";
  }
  // Pegasus dans la Bibliothèque
  const badge = $("libPegBadge");
  const btn = $("libPegBtn");
  if (peg.installed) {
    badge.className = "badge yes";
    badge.innerHTML = '<span class="dot"></span> Installé';
    btn.className = "btn ok";
    btn.textContent = "Ouvrir les réglages";
    btn.onclick = () => goTo("pegasus");
  } else {
    badge.className = "badge no";
    badge.innerHTML = '<span class="dot"></span> Non installé';
    btn.className = "btn";
    btn.textContent = "Installer";
    btn.onclick = () => $("libPegBox").classList.toggle("show");
  }

  // ── Zevs
  const zevs = await window.olympus.zevsStatus();
  const zevNav = document.querySelector('.nav-item[data-app="zevs"]');
  const zevLock = zevNav.querySelector(".lock");
  const zevBadge = $("libZevBadge");
  const zevBtn = $("libZevBtn");
  if (zevs.installed) {
    zevNav.classList.remove("locked");
    if (zevLock) zevLock.style.display = "none";
    zevBadge.className = "badge yes";
    zevBadge.innerHTML = '<span class="dot"></span> Installé';
    zevBtn.textContent = "Ouvrir Zevs";
    zevBtn.onclick = () => window.olympus.openZevs();
  } else {
    zevNav.classList.add("locked");
    if (zevLock) zevLock.style.display = "";
    zevBadge.className = "badge no";
    zevBadge.innerHTML = '<span class="dot"></span> Non installé';
    zevBtn.textContent = "Télécharger · 101 Mo";
    zevBtn.onclick = installZevs;
  }
}

// ── Téléchargement + install Zevs
window.olympus.onZevsProgress((d) => {
  const prog = $("zevProg"), bar = $("zevBar"), txt = $("zevText");
  prog.classList.add("show");
  if (d.phase === "download") { bar.style.width = d.pct + "%"; txt.textContent = "Téléchargement… " + d.pct + "%"; }
  else if (d.phase === "install") { bar.style.width = "100%"; txt.textContent = d.pct < 100 ? "Installation…" : "Presque fini…"; }
});

async function installZevs() {
  const btn = $("libZevBtn"), msg = $("zevMsg");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>En cours…';
  msg.className = "msg"; msg.textContent = "";
  const r = await window.olympus.installZevs();
  btn.disabled = false;
  if (r.ok) {
    $("zevProg").classList.remove("show");
    msg.className = "msg ok"; msg.innerHTML = "✅ Zevs installé !";
    await refreshLocks();
    goTo("zevs");
  } else {
    $("zevProg").classList.remove("show");
    msg.className = "msg err"; msg.textContent = r.error || "Échec.";
    btn.textContent = "Réessayer";
  }
}

// Bouton Ouvrir (page réglages Zevs)
$("zevOpenBtn").onclick = () => window.olympus.openZevs();

// ══════════ RÔLES + TITAN ══════════
let currentRole = localStorage.getItem("olympusRole") || "classic";

function applyRole() {
  const titanNav = document.querySelector('.nav-item[data-app="titan"]');
  const lock = titanNav.querySelector(".lock");
  const isAdmin = currentRole === "super_admin";
  if (isAdmin) {
    titanNav.classList.remove("locked");
    if (lock) lock.style.display = "none";
  } else {
    titanNav.classList.add("locked");
    if (lock) lock.style.display = "";
    // Si on était sur Titan sans y avoir droit → retour Bibliothèque
    if ($("page-titan").classList.contains("show")) goTo("library");
  }
  // Reflète le rôle dans le compte
  const who = document.querySelector(".account .who small");
  if (who) who.textContent = isAdmin ? "super admin" : "utilisateur classic";
}

function setRole(role) {
  currentRole = role;
  localStorage.setItem("olympusRole", role);
  applyRole();
  const msg = $("roleMsg");
  msg.className = "msg ok";
  msg.textContent = role === "super_admin" ? "Mode super admin — Titan déverrouillé." : "Mode classic — Titan verrouillé.";
}
$("roleClassic").onclick = () => setRole("classic");
$("roleAdmin").onclick = () => setRole("super_admin");

// ── Titan : statut + emplacement + install
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
  if (r && r.workspace) {
    const el = $("titanDestPath");
    el.textContent = r.workspace; el.title = r.workspace;
  }
};

window.olympus.onTitanProgress((d) => {
  const prog = $("titanProg");
  prog.classList.add("show");
  $("titanBar").style.width = (d.pct || 0) + "%";
  $("titanText").textContent = d.msg || "";
});

$("titanInstallBtn").onclick = async () => {
  const btn = $("titanInstallBtn"), msg = $("titanMsg");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>En cours…';
  msg.className = "msg"; msg.textContent = "";
  const r = await window.olympus.installTitan();
  btn.disabled = false;
  if (r.ok) {
    $("titanProg").classList.remove("show");
    msg.className = "msg ok"; msg.innerHTML = "✅ Espace dev prêt : " + r.workspace;
    refreshTitan();
  } else {
    $("titanProg").classList.remove("show");
    msg.className = "msg err"; msg.textContent = r.error || "Échec.";
    btn.textContent = "Réessayer";
  }
};

// ── Init rôle/Titan
applyRole();
refreshTitan();

// ── Détection environnement
async function refreshEnv() {
  const env = await window.olympus.checkEnv();
  const rows = [["Node.js", env.node], ["Claude Code", env.claude], ["WordPress local", env.wp]];
  $("envList").innerHTML = rows
    .map(([name, e]) => {
      const cls = e.ok ? "ok" : "miss";
      const icon = e.ok ? "✓" : "!";
      return `<div class="env-row"><div class="st ${cls}">${icon}</div><div><div class="nm">${name}</div><div class="meta">${e.detail}</div></div></div>`;
    })
    .join("");
}

// ── Widget d'installation réutilisable (Bibliothèque + Réglages)
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
    if (code.replace(/[^A-Z0-9]/g, "").length < 8) {
      msg.className = "msg err"; msg.textContent = "Entre ton code complet."; return;
    }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Connexion…';
    msg.className = "msg"; msg.textContent = "";
    const r = await window.olympus.installPegasus(code);
    btn.disabled = false; btn.textContent = "Connecter";
    if (r.ok) {
      msg.className = "msg ok";
      msg.innerHTML = "✅ Clé installée !";
      if (boxId) $(boxId).classList.remove("show");
      codeEl.value = "";
      await refreshLocks();
      goTo("pegasus");
    } else {
      msg.className = "msg err"; msg.textContent = r.error || "Échec.";
    }
  }
}

// ── Réinstaller (page réglages Pegasus)
$("setPegBtn").onclick = () => $("setPegBox").classList.toggle("show");

wireInstaller("libPegCode", "libPegConnect", "libPegMsg", "libPegBox");
wireInstaller("setPegCode", "setPegConnect", "setPegMsg", "setPegBox");

// ── Init
refreshLocks();
refreshEnv();
