"use strict";
const $ = (id) => document.getElementById(id);

// ══════════ MOTION (doctrine skill : version calme obligatoire) ══════════
// Les animations JS (inertie de la roue, scroll doux, compteurs) se coupent
// si le système demande moins de mouvement. Le CSS est neutralisé à part.
const M_REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Pose l'« arrivée » sur une page : les listes émergent en cascade, une fois.
// La classe tombe après 700 ms pour que les rafraîchissements de données ne rejouent rien.
function mArrive(pageEl) {
  if (M_REDUCED || !pageEl) return;
  pageEl.classList.remove("arrive");
  void pageEl.offsetWidth; // force le redémarrage des animations
  pageEl.classList.add("arrive");
  clearTimeout(pageEl._arriveT);
  pageEl._arriveT = setTimeout(() => pageEl.classList.remove("arrive"), 700);
}
// MATÉRIALISER — la donnée se compte sous les yeux (KPIs entiers uniquement)
function mCountUp(root, sel) {
  if (M_REDUCED || !root) return;
  root.querySelectorAll(sel).forEach((el) => {
    const raw = el.textContent.trim();
    if (!/^\d{1,6}$/.test(raw)) return; // jamais sur les versions ("7.0.2") ni les tirets
    const n = +raw;
    if (n < 2) return;
    const t0 = performance.now(), dur = 560;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(n * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

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
    const pg = $("page-" + it.dataset.page);
    pg.classList.add("show");
    mArrive(pg);
    setTimeout(() => mCountUp(pg, ".ir-kpi .n, .ag-kpi .n, .ir-stat .n"), 80); // les KPIs se comptent à l'arrivée
    $("hub").classList.toggle("with-rail", it.dataset.page === "chronos"); // roue + agenda : Chronos uniquement
  };
});
function goTo(page) {
  const it = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (it && !it.classList.contains("locked")) it.click();
}
// Clic sur le profil (en haut) → page profil
$("profileCard").onclick = () => {
  document.querySelectorAll(".nav-item").forEach((x) => x.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("show"));
  $("page-profile").classList.add("show");
  mArrive($("page-profile"));
  $("hub").classList.remove("with-rail");
};
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

// ══════════ PEGASUS — colonne à catégories dépliables + parc/bibliothèque ══════════
let pgSites = [], pgSel = null, pgView = "parc", pgSelProj = null;
let pgProjects = JSON.parse(localStorage.getItem("pg-projets") || "[]");
const pgSaveProjects = () => localStorage.setItem("pg-projets", JSON.stringify(pgProjects));
// Facette de bibliothèque active : n'importe quelle combinaison kind / niveau / registre
let pgFacet = { label: "Toutes les références" };
const pgFacetOf = (el) => ({ kind: el.dataset.kind || "", niveau: el.dataset.niveau || "", registre: el.dataset.registre || "", business: el.dataset.business || "", label: el.dataset.label || el.querySelector(".lname").textContent });
const pgFacetEq = (el) => (el.dataset.kind || "") === (pgFacet.kind || "") && (el.dataset.niveau || "") === (pgFacet.niveau || "") && (el.dataset.registre || "") === (pgFacet.registre || "") && (el.dataset.business || "") === (pgFacet.business || "");
const pgHealth = {}, pgInspect = {}, pgSeo = {}, pgPerf = {};
let pgSiteTab = "general"; // onglet du détail site : general | seo | perf | secu
let pgSecAction = null; // panneau des 3 gros boutons : copy | push | rollback | null
let pgCarousel = 0; // vue de la colonne en carrousel : 0 Parc · 1 Bibliothèque · 2 Réglages
const PG_CVIEWS = ["parc", "biblio", "reglages"];

// Remplissage fantôme maison : on dépasse le bas, le fader mange la dernière ligne.
function pgFillGhosts(el) {
  el.querySelectorAll(".ir-ghostrow").forEach((g) => g.remove());
  let i = 0;
  while (el.scrollHeight <= el.clientHeight + 30 && i < 40) {
    const g = document.createElement("div");
    g.className = "ir-ghostrow";
    g.style.opacity = String(Math.max(0.13, 0.5 - i * 0.05));
    g.innerHTML = `<span class="gdot"></span><i style="width:${34 + ((i * 37) % 46)}%"></i>`;
    el.appendChild(g);
    i++;
  }
}

function pgSideGhosts() { const sc = $("pgScrollParc"); if (sc) pgFillGhosts(sc); }

// Carrousel de la colonne : fait glisser + synchronise la vue du stage
function pgSetCarousel(i) {
  pgCarousel = i;
  $("pgCSlider").style.transform = `translateX(-${i * 100}%)`;
  $("pgCTabs").querySelectorAll("span").forEach((s) => s.classList.toggle("active", +s.dataset.pv === i));
  $("pgFoot").style.display = i === 0 ? "" : "none"; // les boutons site n'ont de sens que sur le Parc
  pgSetView(PG_CVIEWS[i]);
}
$("pgCTabs").querySelectorAll("span").forEach((s) => { s.onclick = () => pgSetCarousel(+s.dataset.pv); });

function pgSetView(view) {
  pgView = view;
  $("pgViewParc").classList.toggle("show", view === "parc");
  $("pgViewBiblio").classList.toggle("show", view === "biblio");
  $("pgViewReglages").classList.toggle("show", view === "reglages");
  $("pgViewNew").classList.toggle("show", view === "new");
  $("pgViewConnect").classList.toggle("show", view === "connect");
  if (view !== "reglages") document.querySelectorAll(".pg-regfold").forEach((x) => x.classList.remove("active"));
  if (view !== "biblio") document.querySelectorAll(".pg-bibfold").forEach((x) => x.classList.remove("active"));
  if (view === "parc") pgLoadSites();
  if (view === "biblio") pgLoadRefs();
}
// Facettes de la bibliothèque (Racine, Secteur, par niveau, par type…) + ancres des réglages
document.querySelectorAll(".pg-bibfold").forEach((el) => {
  el.onclick = () => { pgFacet = pgFacetOf(el); pgSetView("biblio"); };
});
document.querySelectorAll(".pg-regfold").forEach((el) => {
  el.onclick = () => {
    pgSetView("reglages");
    document.querySelectorAll(".pg-regfold").forEach((x) => x.classList.toggle("active", x === el));
    const sec = $(el.dataset.sec);
    if (sec) sec.scrollIntoView({ behavior: M_REDUCED ? "auto" : "smooth", block: "start" });
  };
});

// ── Le parc : registre + santé en direct (les sites vivent dans la colonne)
async function pgLoadSites() {
  const box = $("pgBody-parc");
  const r = await window.olympus.pegasusSites();
  if (!r.ok) { box.innerHTML = `<div class="pg-sidenote">${escapeHtml(r.error || "Registre indisponible.")}</div>`; pgSideGhosts(); return; }
  pgSites = r.sites || [];
  $("pgCntParc").textContent = pgSites.length || "";
  pgRenderSide();
  for (const s of pgSites) {
    if (pgHealth[s.key]) continue;
    window.olympus.pegasusSiteHealth(s.key).then((h) => {
      pgHealth[s.key] = h;
      pgRenderSide();
      if (pgSel === s.key) pgRenderDetail();
    });
  }
  if (pgSites.length && !pgSel && !pgSelProj) pgSelect(pgSites[0].key);
  else if (!pgSelProj) pgRenderDetail();
}

function pgRenderSide() {
  const box = $("pgBody-parc");
  let html = "";
  if (pgProjects.length) {
    html += `<div class="pg-subh" style="margin-top:2px;">Projets</div>`;
    html += pgProjects.map((p) => `<div class="ir-folder pg-projfold ${pgSelProj === p.id ? "active" : ""}" data-pid="${p.id}"><span class="pg-dot draft"></span><span class="lname">${escapeHtml(p.nom)}</span><span class="cnt">à connecter</span></div>`).join("");
    html += `<div class="pg-subh">Connectés</div>`;
  }
  if (pgSites.length) {
    html += pgSites.map((s) => {
      const h = pgHealth[s.key];
      const dot = !h ? "wait" : h.ok ? "ok" : "err";
      let row = `<div class="ir-folder pg-sitefold ${pgSel === s.key ? "active" : ""}" data-key="${escapeHtml(s.key)}"><span class="pg-dot ${dot}"></span><span class="lname">${escapeHtml(s.label)}</span></div>`;
      if (pgSel === s.key) {
        row += `<div class="pg-sitetabs">` + PG_TABS.map((t) =>
          `<div class="ir-folder pg-tabfold ${pgSiteTab === t.id ? "active" : ""}" data-tab="${t.id}"><span class="fic">·</span><span class="lname">${t.label}</span></div>`
        ).join("") + `
          <div class="pg-subh">actions</div>
          <div class="ir-folder pg-actfold work" data-act="work"><span class="fic">▶</span><span class="lname">Travailler sur le site</span></div>
          <div class="ir-folder pg-actfold ${pgSecAction === "copy" ? "active" : ""}" data-sec="copy"><span class="fic">↓</span><span class="lname">Télécharger la copie</span></div>
          <div class="ir-folder pg-actfold ${pgSecAction === "push" ? "active" : ""}" data-sec="push"><span class="fic">↑</span><span class="lname">Pousser en ligne</span></div>
          <div class="ir-folder pg-actfold ${pgSecAction === "rollback" ? "active" : ""}" data-sec="rollback"><span class="fic">⟲</span><span class="lname">Revenir en arrière</span></div>
        </div>`;
      }
      return row;
    }).join("");
  } else if (!pgProjects.length) {
    html = '<div class="pg-sidenote">Aucun site connecté. Utilise les boutons ci-dessous pour démarrer un projet ou connecter un site existant.</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll(".pg-sitefold").forEach((el) => { el.onclick = () => { if (pgView !== "parc") pgSetView("parc"); pgSelect(el.dataset.key); }; });
  box.querySelectorAll(".pg-tabfold").forEach((el) => { el.onclick = () => { pgSiteTab = el.dataset.tab; pgRenderSide(); pgRenderDetail(); }; });
  box.querySelectorAll(".pg-actfold[data-sec]").forEach((el) => {
    el.onclick = () => { pgSecAction = pgSecAction === el.dataset.sec ? null : el.dataset.sec; pgRenderSide(); pgRenderDetail(); };
  });
  const wf = box.querySelector('.pg-actfold[data-act="work"]');
  if (wf) wf.onclick = () => pgWorkOn(wf);
  box.querySelectorAll(".pg-projfold").forEach((el) => { el.onclick = () => { if (pgView !== "parc") pgSetView("parc"); pgSelectProject(el.dataset.pid); }; });
  pgSideGhosts();
}

// ▶ Travailler sur le site : prépare le local, lance, ouvre Claude Code (feedback dans le stage)
async function pgWorkOn(rowEl) {
  const s = pgSites.find((x) => x.key === pgSel);
  if (!s) return;
  const m = $("pgWorkMsg");
  rowEl.style.opacity = ".55"; rowEl.style.pointerEvents = "none";
  if (m) { m.className = "msg"; m.textContent = "Préparation du local + ouverture de Claude Code…"; }
  const r = await window.olympus.pegasusWorkOn(s.key);
  rowEl.style.opacity = ""; rowEl.style.pointerEvents = "";
  if (!m) return;
  if (!r.ok) { m.className = "msg err"; m.textContent = r.error || "Échec."; return; }
  m.className = "msg ok";
  m.textContent = (r.copied ? "Copie créée. " : "") + (r.mode === "wordpress" ? "WordPress lancé en local (wp-now) + Claude Code ouvert." : r.mode === "static" ? "Site ouvert dans le navigateur + Claude Code ouvert." : "Dossier prêt + Claude Code ouvert.");
}

function pgSelectProject(pid) {
  pgSelProj = pid; pgSel = null;
  pgRenderSide();
  const p = pgProjects.find((x) => x.id === pid);
  const box = $("pgDetail");
  if (!p) { box.innerHTML = ""; pgFillGhosts(box); return; }
  const line = (k, v) => v ? `<div class="pg-line"><span class="k">${k}</span><span class="v">${escapeHtml(v)}</span></div>` : "";
  const NIV = { N1: "N1 · Premium", N2: "N2 · Luxe", N3: "N3 · Luxe supérieur", N4: "N4 · Ultra luxe" };
  box.innerHTML = `<div class="pg-dhead">
      <span class="pg-dot draft"></span>
      <h2>${escapeHtml(p.nom)}</h2>
      ${p.url ? `<button class="btn sec pg-open" data-url="${escapeHtml(p.url)}" style="padding:6px 14px;font-size:12px;">Ouvrir ↗</button>` : ""}
    </div>
    <div class="pg-alert" style="border:0;color:var(--dim);">Projet en cours — pas encore connecté à Pegasus.</div>
    <div class="pg-sub">Cadrage</div>
    ${line("Type de projet", p.type === "wordpress" ? "WordPress (local)" : p.type === "custom" ? "Site sur-mesure (code)" : "")}
    ${line("Secteur", p.secteur)}
    ${line("Niveau visé", NIV[p.niveau] || p.niveau)}
    ${line("Type de design", p.registre)}
    ${line("Intention", p.intention)}
    ${line("URL", p.url)}
    ${line("Créé le", p.created ? new Date(p.created).toLocaleDateString("fr-FR") : "")}
    ${p.notes ? `<div class="pg-sub">Notes</div><div class="pg-alert" style="border:0;">${escapeHtml(p.notes)}</div>` : ""}
    <div class="pg-sub">Dossier de travail</div>
    <div id="pgProjFolder"><div class="rb-empty">Vérification…</div></div>
    <div class="pg-sub">Actions</div>
    <div style="display:flex;gap:10px;margin-top:4px;">
      <button class="cal-btn primary" id="pgProjConnect">Connecter ce site</button>
      <button class="btn sec" id="pgProjDelete">Supprimer le projet</button>
    </div>`;
  box.querySelectorAll(".pg-open").forEach((b) => { b.onclick = () => window.olympus.openExternal(b.dataset.url); });
  pgRenderProjFolder(p);
  $("pgProjConnect").onclick = () => pgSetView("connect");
  $("pgProjDelete").onclick = () => {
    pgProjects = pgProjects.filter((x) => x.id !== pid);
    pgSaveProjects(); pgSelProj = null;
    pgRenderSide();
    if (pgSites.length) pgSelect(pgSites[0].key); else { $("pgDetail").innerHTML = ""; pgFillGhosts($("pgDetail")); }
  };
  pgFillGhosts(box);
}

// Section « Dossier de travail » d'un projet (état + révéler / (re)créer)
async function pgRenderProjFolder(p) {
  const box = $("pgProjFolder");
  if (!box) return;
  const slug = p.slug || p.nom;
  const st = await window.olympus.pegasusFolderExists(slug);
  const kindTxt = p.type === "wordpress" ? "WordPress local (./wordpress/)" : "fichiers de développement";
  if (st.exists) {
    box.innerHTML = `<div class="pg-line"><span class="k">Emplacement</span><span class="v">~/Pegasus/${escapeHtml(String(st.path).split("/").pop())}/</span></div>
      <div class="pg-line"><span class="k">Contenu</span><span class="v">${escapeHtml(kindTxt)}</span></div>
      <div style="margin-top:10px;"><button class="btn sec" id="pgProjReveal">Révéler dans le Finder</button></div>`;
    $("pgProjReveal").onclick = async () => { await window.olympus.pegasusRevealFolder(slug); };
  } else {
    box.innerHTML = `<div class="rb-empty">Dossier non créé.</div>
      <div style="margin-top:8px;"><button class="cal-btn" id="pgProjScaffold">${p.type === "wordpress" ? "Télécharger WordPress en local" : "Créer les fichiers de développement"}</button><span class="msg" id="pgProjScaffMsg" style="margin-left:8px;"></span></div>`;
    $("pgProjScaffold").onclick = async () => {
      const m = $("pgProjScaffMsg"), b = $("pgProjScaffold");
      b.disabled = true; m.className = "msg"; m.textContent = p.type === "wordpress" ? "Téléchargement de WordPress…" : "Création…";
      const r = await window.olympus.pegasusScaffold(p);
      b.disabled = false;
      if (!r.ok) { m.className = "msg err"; m.textContent = r.error || "Échec."; return; }
      p.slug = r.slug; p.folder = r.path; p.scaffolded = true; pgSaveProjects();
      pgRenderProjFolder(p);
    };
  }
}

// Compteurs de chaque facette de la colonne (kind/niveau/registre), tous statuts
async function pgBibCounts() {
  const r = await window.olympus.pegasusRefs({ statut: "tous", limit: 500 });
  if (!r.ok) return;
  const refs = r.refs || [];
  $("pgCntBib").textContent = refs.length || "";
  document.querySelectorAll(".pg-bibfold").forEach((el) => {
    const k = el.dataset.kind || "", n = el.dataset.niveau || "", g = el.dataset.registre || "", b = el.dataset.business || "";
    const c = refs.filter((x) => (!k || x.kind === k) && (!n || x.niveau === n) && (!g || x.registre === g) && (!b || x.business === b)).length;
    const cnt = el.querySelector(".cnt");
    if (cnt) cnt.textContent = c || "";
  });
  // Compteur de l'en-tête « Sites » (non cliquable)
  document.querySelectorAll(".cnt[data-cntkind]").forEach((cnt) => {
    cnt.textContent = refs.filter((x) => x.kind === cnt.dataset.cntkind).length || "";
  });
}

async function pgSelect(key) {
  pgSel = key; pgSelProj = null; pgSiteTab = "general"; pgSecAction = null;
  pgRenderSide();
  pgRenderDetail();
  if (!pgInspect[key]) {
    const r = await window.olympus.pegasusSiteInspect(key);
    pgInspect[key] = r;
    if (pgSel === key) pgRenderDetail();
  }
}

const PG_TABS = [
  { id: "general", label: "Général" },
  { id: "pipeline", label: "Pipeline" },
  { id: "arbo", label: "Arborescence" },
  { id: "mood", label: "Moodboard" },
  { id: "seo", label: "SEO" },
  { id: "perf", label: "Performance" },
  { id: "secu", label: "Sécurité" },
];

function pgRenderDetail() {
  const box = $("pgDetail");
  const s = pgSites.find((x) => x.key === pgSel);
  if (!s) { box.innerHTML = ""; pgFillGhosts(box); return; }
  const h = pgHealth[s.key];
  let html = `<div class="pg-dhead">
    <span class="pg-dot ${!h ? "wait" : h.ok ? "ok" : "err"}"></span>
    <h2>${escapeHtml(s.label)}</h2>
    <button class="btn sec pg-open" data-url="${escapeHtml(s.base_url)}" style="padding:6px 14px;font-size:12px;">Ouvrir ↗</button>
    <button class="btn sec pg-open" data-url="${escapeHtml(s.base_url)}/wp-admin" style="padding:6px 14px;font-size:12px;">wp-admin</button>
  </div>`;
  html += `<div class="msg" id="pgWorkMsg" style="margin:2px 0 6px;"></div>
    <div id="pgSecPanel"></div>`;
  html += `<div class="pg-tabcontent">${pgTabHTML(pgSiteTab, s)}</div>`;

  box.innerHTML = html;
  box.querySelectorAll(".pg-open").forEach((b) => { b.onclick = () => window.olympus.openExternal(b.dataset.url); });
  const sb = box.querySelector("#pgSeoBtn"); if (sb) sb.onclick = () => pgRunSeo(s.key);
  const pb = box.querySelector("#pgPerfBtn"); if (pb) pb.onclick = () => pgRunPerf(s.key);
  pgRenderSecPanel(s);
  if (pgSiteTab === "pipeline") pgPipelineRender(s);
  if (pgSiteTab === "arbo") pgArboRender(s);
  if (pgSiteTab === "mood") pgMoodRender(s);
  // Le nombre de pages se compte une seule fois par site (pas à chaque rafraîchissement)
  const insOk = pgInspect[s.key] && pgInspect[s.key].ok;
  if (insOk && !pgCounted.has(s.key)) { pgCounted.add(s.key); mCountUp(box, ".pg-kpi .n"); }
  pgFillGhosts(box);
}
const pgCounted = new Set();

function pgTabHTML(tab, s) {
  if (tab === "general") return pgTabGeneral(s);
  if (tab === "pipeline") return `<div id="pgPipeline"><div class="rb-empty">Chargement du pipeline…</div></div>`;
  if (tab === "arbo") return `<div id="pgArbo"><div class="rb-empty">Chargement de l'arborescence…</div></div>`;
  if (tab === "mood") return `<div id="pgMood"><div class="rb-empty">Chargement du moodboard…</div></div>`;
  if (tab === "seo") return pgTabSeo(s);
  if (tab === "perf") return pgTabPerf(s);
  if (tab === "secu") return pgTabSecu(s);
  return "";
}

// ══ Arborescence : canvas de nodes — pages flottantes, câbles = où chaque section emmène ══
const pgArboCache = {};                       // par site : l'arborescence en cours d'édition
let pgArboSaveT = null;
function pgArboSave(key) {
  clearTimeout(pgArboSaveT);
  pgArboSaveT = setTimeout(() => window.olympus.pegasusArboSave(key, pgArboCache[key]), 400);
}
const pgArboId = () => "n" + Math.random().toString(36).slice(2, 8);
const AB_COLORS = ["#e8c268", "#8fd6a6", "#7fb2e8", "#e0868f", "#c9a2e8", "#8fd6cf"];
let pgAbLink = null;                          // {p, s} : section en cours de câblage
const pgAbSel = new Set();                    // maj+clic : sélection multiple de nodes
// Géométrie des colonnes (partagée entre le layout auto et le changement de niveau)
const AB_X0 = 70, AB_Y0 = 70, AB_COLX = 340, AB_GAP = 26;
const abNodeH = (n) => 64 + (n.wp_id ? 27 : 0) + (n.sections.length ? 15 + n.sections.length * 23 : 0);

// Rangement par NIVEAUX en colonnes : home = niveau 1 (à gauche), les pages
// qu'elle atteint = niveau 2 (colonne suivante), etc. Header/Footer = artefacts
// posés au-dessus / en-dessous de la home. `force` réorganise tout.
function pgAbLayout(nodes, force) {
  if (force) nodes.forEach((n) => { n.x = null; n.y = null; });
  const pages = nodes.filter((n) => !n.artefact);
  const artefacts = nodes.filter((n) => n.artefact);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const H = abNodeH;
  // Niveaux : LA HIÉRARCHIE DU MENU PRIME. Phase 1 (menu) : Header/Footer → niveau 2,
  // sections marquées menu → niveau parent + 1. Phase 2 (contenu) : les pages restantes
  // héritent du BFS sur les liens de contenu — un raccourci de contenu ne remonte
  // jamais une page au-dessus de sa place dans le menu.
  const level = new Map();
  const home = pages.find((n) => n.home) || pages[0];
  if (home) level.set(home.id, 1);
  const bfs = (edgesOf, seeds) => {
    const queue = [...seeds];
    while (queue.length) {
      const id = queue.shift();
      for (const sc of edgesOf(byId.get(id))) {
        const t = sc.cible && byId.get(sc.cible);
        if (t && !t.artefact && !level.has(t.id)) { level.set(t.id, level.get(id) + 1); queue.push(t.id); }
      }
    }
  };
  // Phase 1 — le menu : artefacts (niveau 2) puis sous-menus en cascade
  const menuSeeds = [];
  for (const a of artefacts) for (const sc of a.sections) {
    const t = sc.cible && byId.get(sc.cible);
    if (t && !t.artefact && !level.has(t.id)) { level.set(t.id, 2); menuSeeds.push(t.id); }
  }
  bfs((n) => (n.sections || []).filter((sc) => sc.menu), menuSeeds);
  // Phase 2 — le contenu : complète les pages hors menu (sections + liens node→node manuels)
  bfs((n) => [...(n.sections || []), ...((n.links || []).map((l) => ({ cible: l.to })))], [...level.keys()]);
  // Phase 3 — les pages TERMINALES ferment le pipeline (dernière colonne) :
  // conversion = ciblée par la majorité des pages de contenu et quasi sans liens
  // sortants (ex : Contact, où tous les CTA mènent) ; utilitaire = accessible
  // uniquement depuis le Footer (ex : Mentions légales). Lecture : home →
  // rubriques → sous-pages → terminus.
  const inHeader = new Set((artefacts.find((a) => a.artefact === "header")?.sections || []).map((sc) => sc.cible).filter(Boolean));
  const inFooter = new Set((artefacts.find((a) => a.artefact === "footer")?.sections || []).map((sc) => sc.cible).filter(Boolean));
  const contentPages = pages.filter((p) => (p.sections || []).length);
  const hitBy = new Map();
  for (const p of contentPages) {
    const seen = new Set();
    for (const sc of p.sections || []) {
      const t = sc.cible && byId.get(sc.cible);
      if (t && !t.artefact && t.id !== p.id && !seen.has(t.id)) { seen.add(t.id); hitBy.set(t.id, (hitBy.get(t.id) || 0) + 1); }
    }
  }
  const terminal = new Set();
  for (const n of pages) {
    if (n === home) continue;
    const sortants = (n.sections || []).filter((sc) => sc.cible && sc.cible !== n.id).length;
    const conversion = contentPages.length >= 4 && sortants <= 2 && (hitBy.get(n.id) || 0) >= Math.ceil(contentPages.length * 0.6);
    const utilitaire = inFooter.has(n.id) && !inHeader.has(n.id);
    if (conversion || utilitaire) terminal.add(n.id);
  }
  let maxL = 1;
  for (const [id, v] of level) if (!terminal.has(id)) maxL = Math.max(maxL, v);
  for (const id of terminal) level.set(id, maxL + 1);
  for (const n of pages) if (!level.has(n.id)) level.set(n.id, maxL + (terminal.size ? 2 : 1));
  // Un niveau fixé À LA MAIN (p.level) prime sur le calcul automatique.
  for (const n of pages) if (Number.isFinite(n.level)) level.set(n.id, n.level);
  // Niveau résolu, exposé pour l'affichage du badge (recalculé à chaque rendu).
  for (const n of nodes) n._lvl = n.artefact ? 1 : Math.max(2, level.get(n.id) || 2);
  if (home) home._lvl = 1;
  // Positions : ne (re)calculées que si au moins un node n'en a pas (ou force).
  if (!nodes.some((n) => n.x == null)) return false;
  // Colonnes : niveau 1 = [Header, home, Footer] empilés ; niveaux suivants à droite
  const X0 = AB_X0, Y0 = AB_Y0, COLX = AB_COLX, GAP = AB_GAP;
  const col1 = [artefacts.find((a) => a.artefact === "header"), home, artefacts.find((a) => a.artefact === "footer")].filter(Boolean);
  let y = Y0;
  for (const n of col1) { n.x = X0; n.y = y; y += H(n) + GAP; }
  const cols = new Map();
  for (const n of pages) {
    if (n === home) continue;
    const l = n._lvl;
    if (!cols.has(l)) cols.set(l, []);
    cols.get(l).push(n);
  }
  for (const [l, list] of cols) {
    let cy = Y0;
    for (const n of list) { n.x = X0 + (l - 1) * COLX; n.y = cy; cy += H(n) + GAP; }
  }
  return true;
}

// Pose un node en bas de la colonne du niveau `lvl`, sans déranger les autres.
function pgAbPlace(p, lvl, pages) {
  const x = AB_X0 + (lvl - 1) * AB_COLX;
  let y = AB_Y0;
  for (const n of pages) {
    if (n === p || n.artefact) continue;
    if (Math.abs((n.x || 0) - x) < 4) y = Math.max(y, (n.y || 0) + abNodeH(n) + AB_GAP);
  }
  p.x = x; p.y = y;
}
// Fixe le niveau d'un node à la main (override persisté).
function pgAbSetLevel(p, lvl, pages) {
  p.level = Math.max(2, Math.min(9, lvl));
  pgAbPlace(p, p.level, pages);
}

// Fusionne un scan du site avec l'arborescence existante : positions/accueil/pages
// manuelles conservés, sections remplacées par les liens réellement détectés.
function pgAbMerge(cur, scanned) {
  if (!cur) return scanned;
  const byWp = new Map(cur.pages.filter((p) => p.wp_id).map((p) => [p.wp_id, p]));
  const byArt = new Map(cur.pages.filter((p) => p.artefact).map((p) => [p.artefact, p]));
  const idMap = new Map();
  for (const np of scanned.pages) { const old = np.wp_id && byWp.get(np.wp_id); idMap.set(np.id, old ? old.id : np.id); }
  const hadHome = cur.pages.some((p) => p.home);
  for (const np of scanned.pages) {
    const old = np.wp_id && byWp.get(np.wp_id);
    np.id = idMap.get(np.id);
    if (old) {
      if (old.x != null) { np.x = old.x; np.y = old.y; }
      if (hadHome) np.home = !!old.home;
      if (Number.isFinite(old.level)) np.level = old.level; // niveau fixé à la main conservé
      if (old.links && old.links.length) np.links = old.links; // liens node→node manuels conservés
      if (old.titre && old.titre !== np.titre && !old.wp_id) np.titre = old.titre;
      // Maquette conservée : contexte de page + textes/animations de sections (matchés par titre)
      if (old.contexte) np.contexte = old.contexte;
      const oldTxt = new Map((old.sections || []).filter((x) => x.texte || x.animation).map((x) => [x.titre, x]));
      for (const sc of np.sections) {
        const o = oldTxt.get(sc.titre);
        if (!o) continue;
        if (!sc.texte && o.texte) sc.texte = o.texte;
        if (!sc.animation && o.animation) sc.animation = o.animation;
      }
    }
    for (const sc of np.sections) sc.cible = idMap.get(sc.cible) || "";
  }
  for (const np of scanned.pages) {
    if (!np.artefact) continue;
    const old = byArt.get(np.artefact);
    if (old && old.x != null) { np.x = old.x; np.y = old.y; }
  }
  const manual = cur.pages.filter((p) => !p.wp_id && !p.artefact);
  return { pages: [...scanned.pages, ...manual], zoom: cur.zoom };
}

// Titre éditable au DOUBLE-clic (le simple clic sert au drag)
function pgAbEditable(el, commit) {
  el.ondblclick = (e) => {
    e.stopPropagation();
    el.contentEditable = "true"; el.focus();
    const r = document.createRange(); r.selectNodeContents(el);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  };
  el.onblur = () => { el.contentEditable = "false"; commit(el.textContent.trim()); };
  el.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } };
}

async function pgArboRender(s) {
  const box = $("pgArbo"); if (!box) return;
  if (!pgArboCache[s.key]) {
    const r = await window.olympus.pegasusArboGet(s.key);
    if (!r.ok) { box.innerHTML = `<div class="rb-empty">${escapeHtml(r.error || "Indisponible.")}</div>`; return; }
    pgArboCache[s.key] = r.arbo || null;
  }
  const arbo = pgArboCache[s.key];

  // Pas encore d'arborescence → scan auto du site (pages + liens réels), ou zéro
  if (!arbo) {
    box.innerHTML = `<div class="ab-empty">
        <p class="pg-mnote">Aucune arborescence pour ce site. Comme il est connecté à Pegasus, je peux la générer <b>déjà câblée</b> : pages réelles + liens réels entre elles.</p>
        <div class="pg-actrow">
          <button class="cal-btn primary" id="abGen">Scanner le site (pages + connexions)</button>
          <button class="btn sec" id="abBlank">Partir de zéro</button>
          <span class="msg" id="abMsg"></span>
        </div>
      </div>`;
    box.querySelector("#abGen").onclick = async (e) => {
      const m = box.querySelector("#abMsg"); e.currentTarget.disabled = true;
      m.className = "msg"; m.textContent = "Scan du site : pages, liens, connexions… (quelques secondes)";
      const r = await window.olympus.pegasusArboScan(s.key, null);
      if (!r.ok) { m.className = "msg err"; m.textContent = r.error || "Échec."; e.target.disabled = false; return; }
      pgArboCache[s.key] = r.arbo;
      pgArboSave(s.key); pgArboRender(s);
    };
    box.querySelector("#abBlank").onclick = () => {
      pgArboCache[s.key] = { pages: [{ id: pgArboId(), titre: "Accueil", home: true, sections: [] }] };
      pgArboSave(s.key); pgArboRender(s);
    };
    return;
  }

  // La version en ligne (le socle) n'est PAS éditable : on ne modifie jamais le site
  // en place. Pour toucher au wireframe il faut une version de travail distincte.
  const man = await pgWirePrep(s);
  const editable = (arbo.versionId ?? null) !== man.deployed;

  const pages = arbo.pages || [];
  let dirty = pgAbLayout(pages);
  // Couleur pour toute section qui n'en a pas encore (dot devant le nom)
  let ci = 0;
  for (const p of pages) for (const sec of p.sections) {
    if (!sec.color) { sec.color = AB_COLORS[ci % AB_COLORS.length]; dirty = true; }
    ci++;
  }
  if (dirty && editable) pgArboSave(s.key);
  pgAbLink = null;
  pgAbSel.clear();
  const HINT = `Glisse d'un <b>port</b> (section ou bord droit du node) jusqu'à une page pour tracer un lien · double-clique un nom pour le renommer · clique un <b>câble</b> pour le supprimer`;

  box.innerHTML = `
    <div class="pg-actrow" style="margin-bottom:12px;">
      ${editable ? `
      <button class="cal-btn" id="abAddPage">＋ Page</button>
      <button class="btn sec" id="abRescan" title="Repart des pages et liens réels du site (positions conservées)">⟳ Rescanner le site</button>
      <button class="btn sec" id="abRelayout" title="Range les nodes par niveaux, en colonnes de gauche à droite">⇄ Réorganiser</button>
      <button class="cal-btn primary" id="abSaveVer" title="Fige l'état actuel comme une version du wireframe">✓ Enregistrer une version</button>
      <span class="ab-hint" id="abHint">${HINT}</span>
      ` : `
      <span class="ab-lock">🔒 Version en ligne — lecture seule. Pour modifier le wireframe, crée une version de travail :</span>
      <button class="cal-btn primary" id="abDupLive" title="Repart de la structure du site actuel">Dupliquer la version en ligne</button>
      <button class="btn sec" id="abBlankNew" title="Nouvelle arborescence vide">Partir d'une page blanche</button>
      `}
    </div>
    <div class="ab-layout${editable ? "" : " readonly"}">
    <div class="ab-canvas" id="abCanvas">
      <div class="ab-stage" id="abStage" style="width:${Math.max(2600, (Math.max(...pages.map((p) => p.x || 0)) + 700))}px;height:${Math.max(1600, (Math.max(...pages.map((p) => p.y || 0)) + 700))}px;">
        <svg class="ab-wires" id="abWires"></svg>
        ${pages.map((p) => `
          <div class="ab-node${p.home ? " home" : ""}${p.artefact ? " artefact" : ""}" data-p="${p.id}" style="left:${p.x}px;top:${p.y}px;">
            ${p.artefact ? "" : '<span class="inport"></span>'}
            ${p.artefact ? "" : '<span class="ab-outport" data-outport title="Glisse jusqu\'à la page vers laquelle ce node pointe"></span>'}
            <div class="ab-phead">
              <div class="ab-title" data-f="titre" title="Double-clic pour renommer">${escapeHtml(p.titre)}</div>
              ${p.artefact ? '<span class="ab-badge dim">artefact</span>' : p.home ? '<span class="ab-badge">accueil</span>' : `<button class="ab-mini" data-act="home" title="Définir comme accueil">⌂</button>`}
              ${p.artefact ? "" : `<button class="ab-mini${p.contexte || (p.sections || []).some((sc) => sc.texte || sc.animation) ? " has" : ""}" data-act="maquette" title="Maquette : contexte, explication des sections, destinations, animations">📝</button>`}
              <button class="ab-mini" data-act="rename" title="Renommer">✎</button>
              <button class="ab-mini" data-act="addsec" title="Ajouter une section">＋</button>
              <button class="ab-mini" data-act="delpage" title="Supprimer la page">✕</button>
            </div>
            ${p.artefact ? "" : `<div class="ab-meta">
              ${p.wp_id ? `<span class="ab-badge dim">WP #${p.wp_id}</span>` : ""}
              ${p.home ? '<span class="ab-badge dim">niveau 1</span>' : `<span class="ab-lvl${p.level != null ? " fixed" : ""}" title="${p.level != null ? "Niveau fixé à la main — clic droit pour revenir à l'auto" : "Niveau calculé — utilise ‹ › pour le fixer"}">
                <button class="ab-lvlb" data-act="lvldn" title="Reculer d'une colonne">‹</button>
                <b data-lvl>N${p._lvl}</b>
                <button class="ab-lvlb" data-act="lvlup" title="Avancer d'une colonne">›</button>
              </span>`}
            </div>`}
            ${p.sections.length ? `<div class="ab-secs">${p.sections.map((sec) => `
              <div class="ab-sec" data-s="${sec.id}">
                <span class="ab-secdot" style="background:${sec.color};box-shadow:0 0 6px ${sec.color}55;"></span>
                <div class="ab-title sec" data-f="sec-titre" title="Double-clic pour renommer">${escapeHtml(sec.titre)}</div>
                <button class="ab-mini" data-act="delsec" title="Supprimer la section">✕</button>
                <span class="ab-port${sec.cible ? " linked" : ""}" data-port ${sec.cible ? `style="background:${sec.color};border-color:transparent;box-shadow:0 0 7px ${sec.color}88;"` : ""} title="${sec.cible ? "⇢ " + escapeHtml((pages.find((x) => x.id === sec.cible) || {}).titre || "?") + " — clic droit pour détacher" : "Glisse jusqu'à la page de destination"}"></span>
              </div>`).join("")}</div>` : ""}
          </div>`).join("")}
      </div>
    </div>
    <div class="ab-versions" id="abVersions"><div class="rb-empty">Versions…</div></div>
    </div>`;

  const stage = $("abStage"), canvas = $("abCanvas"), svgW = $("abWires");
  const find = (pid) => pages.find((x) => x.id === pid);
  const hintReset = () => { $("abHint").innerHTML = HINT; };

  // Zoom au scroll (molette / pincement), centré sur le curseur — persisté
  let abZoom = arbo.zoom || 1;
  stage.style.zoom = abZoom;
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const old = abZoom;
    abZoom = Math.min(1.8, Math.max(0.3, abZoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    if (abZoom === old) return;
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    const lx = (canvas.scrollLeft + ox) / old, ly = (canvas.scrollTop + oy) / old;
    stage.style.zoom = abZoom;
    canvas.scrollLeft = lx * abZoom - ox;
    canvas.scrollTop = ly * abZoom - oy;
    arbo.zoom = abZoom;
    pgArboSave(s.key);
    requestAnimationFrame(drawWires);
  }, { passive: false });

  // Câbles : du port de chaque section vers l'entrée de sa page cible (couleur = celle de la section).
  // Au survol d'un node, seuls SES câbles (départs + arrivées) restent vifs — les autres s'estompent.
  let abHot = null;
  function drawWires() {
    const sr = stage.getBoundingClientRect();
    const z = abZoom || 1;
    // Un câble = une zone de clic large (invisible) + le trait visible. Cliquer la
    // zone supprime le lien (le survol l'épaissit). meta = data pour la suppression.
    const seg = (fromEl, toEl, color, dashed, hot, meta) => {
      const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
      const x1 = (a.left - sr.left + a.width / 2) / z, y1 = (a.top - sr.top + a.height / 2) / z;
      const x2 = (b.left - sr.left + b.width / 2) / z, y2 = (b.top - sr.top + b.height / 2) / z;
      const dx = Math.max(50, Math.abs(x2 - x1) * 0.45);
      const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      const op = hot ? (abHot ? ".95" : ".7") : ".07";
      return `<path class="ab-hit" d="${d}" ${meta}><title>Cliquer pour supprimer ce lien</title></path>`
        + `<path class="ab-wire" style="stroke:${color};opacity:${op};${dashed ? "stroke-dasharray:5 5;" : ""}" d="${d}"/>`;
    };
    const paths = [];
    for (const p of pages) {
      for (const sec of p.sections) {
        if (!sec.cible) continue;
        const from = stage.querySelector(`.ab-sec[data-s="${sec.id}"] .ab-port`);
        const to = stage.querySelector(`.ab-node[data-p="${sec.cible}"] .inport`);
        if (!from || !to) continue;
        const hot = !abHot || p.id === abHot || sec.cible === abHot;
        paths.push(seg(from, to, sec.color || "var(--line2)", false, hot, `data-kind="sec" data-p="${p.id}" data-s="${sec.id}"`));
      }
      for (const lk of p.links || []) {
        const from = stage.querySelector(`.ab-node[data-p="${p.id}"] .ab-outport`);
        const to = stage.querySelector(`.ab-node[data-p="${lk.to}"] .inport`);
        if (!from || !to) continue;
        const hot = !abHot || p.id === abHot || lk.to === abHot;
        paths.push(seg(from, to, "var(--muted)", true, hot, `data-kind="node" data-p="${p.id}" data-to="${lk.to}"`));
      }
    }
    svgW.innerHTML = paths.join("");
  }
  drawWires();
  pgWireRenderCol(s);

  // ── Version en ligne (lecture seule) : proposer une version de travail ──
  if (!editable) {
    box.querySelector("#abDupLive").onclick = () => {
      const copy = JSON.parse(JSON.stringify(arbo));
      copy.versionId = null;            // brouillon non enregistré = éditable
      pgArboCache[s.key] = copy; pgArboSave(s.key); pgArboRender(s);
    };
    box.querySelector("#abBlankNew").onclick = () => {
      pgArboCache[s.key] = { pages: [{ id: pgArboId(), titre: "Accueil", home: true, sections: [] }], versionId: null, zoom: arbo.zoom };
      pgArboSave(s.key); pgArboRender(s);
    };
  }

  if (editable) {
    // Cliquer un câble = supprimer le lien (section→page ou node→node)
    svgW.onclick = (e) => {
      const hit = e.target.closest(".ab-hit"); if (!hit) return;
      const src = find(hit.dataset.p); if (!src) return;
      if (hit.dataset.kind === "sec") { const sec = src.sections.find((x) => x.id === hit.dataset.s); if (sec) sec.cible = ""; }
      else src.links = (src.links || []).filter((l) => l.to !== hit.dataset.to);
      pgArboSave(s.key); pgArboRender(s);
    };
    // Barre d'actions
    box.querySelector("#abAddPage").onclick = () => {
      pages.push({ id: pgArboId(), titre: "Nouvelle page", sections: [], x: 70 + canvas.scrollLeft, y: 70 + canvas.scrollTop });
      pgArboSave(s.key); pgArboRender(s);
    };
    box.querySelector("#abRelayout").onclick = () => {
      pgAbLayout(pages, true);
      pgArboSave(s.key); pgArboRender(s);
    };
    box.querySelector("#abSaveVer").onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      // Numérote les brouillons de wireframe (« Version N »), indépendamment du socle « Site en ligne ».
      const existing = (pgWireCache[s.key] && pgWireCache[s.key].versions) || [];
      const n = existing.filter((v) => /^Version \d+$/.test(v.label || "")).length + 1;
      const label = "Version " + n;
      const r = await window.olympus.pegasusWireSave(s.key, pgArboCache[s.key], label, false);
      if (r.ok) { arbo.versionId = r.id; pgArboSave(s.key); } // on édite désormais cette version
      delete pgWireCache[s.key];
      await pgWireRenderCol(s);
      btn.disabled = false;
      const msg = $("pgWorkMsg");
      if (r.ok && msg) { msg.className = "msg ok"; msg.textContent = label + " enregistrée."; }
      if (!r.ok) alert("Échec de l'enregistrement : " + (r.error || ""));
    };
    box.querySelector("#abRescan").onclick = async (e) => {
      e.currentTarget.disabled = true;
      $("abHint").innerHTML = "Scan du site en cours… (pages + connexions réelles)";
      const homeWp = (pages.find((x) => x.home) || {}).wp_id || null;
      const r = await window.olympus.pegasusArboScan(s.key, homeWp);
      if (r.ok) { pgArboCache[s.key] = pgAbMerge(pgArboCache[s.key], r.arbo); pgArboSave(s.key); }
      pgArboRender(s);
    };
  }

  // Glisser-connecter : rester appuyé d'un port (A) jusqu'à une page (B) trace le lien.
  const stageXY = (cx, cy) => { const sr = stage.getBoundingClientRect(); const z = abZoom || 1; return [(cx - sr.left) / z, (cy - sr.top) / z]; };
  const portXY = (el) => { const sr = stage.getBoundingClientRect(); const b = el.getBoundingClientRect(); const z = abZoom || 1; return [(b.left - sr.left + b.width / 2) / z, (b.top - sr.top + b.height / 2) / z]; };
  const curve = (x1, y1, x2, y2) => { const dx = Math.max(50, Math.abs(x2 - x1) * 0.45); return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`; };
  function startLink(e, src, portEl) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const [x1, y1] = portXY(portEl);
    portEl.classList.add("linking");
    stage.querySelectorAll(".ab-node").forEach((x) => x.classList.toggle("linktarget", x.dataset.p !== src.p && !x.classList.contains("artefact")));
    const h = $("abHint"); if (h) h.innerHTML = "Relâche sur la <b>page de destination</b>";
    const temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
    temp.setAttribute("class", "ab-wire");
    temp.setAttribute("style", `stroke:${src.color || "var(--accent2)"};opacity:.9;stroke-dasharray:5 5;`);
    svgW.appendChild(temp);
    let hover = null;
    const nodeAt = (cx, cy) => { const el = document.elementFromPoint(cx, cy); const n = el && el.closest(".ab-node"); return n && n.dataset.p !== src.p && !n.classList.contains("artefact") ? n : null; };
    const move = (ev) => {
      const [x2, y2] = stageXY(ev.clientX, ev.clientY);
      temp.setAttribute("d", curve(x1, y1, x2, y2));
      const n = nodeAt(ev.clientX, ev.clientY);
      if (hover !== n) { if (hover) hover.classList.remove("linkhover"); hover = n; if (hover) hover.classList.add("linkhover"); }
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const n = nodeAt(ev.clientX, ev.clientY);
      const source = find(src.p);
      let done = false;
      if (n && source) {
        const to = n.dataset.p;
        if (src.kind === "sec") { const sec = source.sections.find((x) => x.id === src.s); if (sec) { sec.cible = to; done = true; } }
        else { source.links = source.links || []; if (!source.links.some((l) => l.to === to)) { source.links.push({ id: pgArboId(), to }); done = true; } }
      }
      if (done) { pgArboSave(s.key); pgArboRender(s); }
      else { temp.remove(); portEl.classList.remove("linking"); stage.querySelectorAll(".ab-node").forEach((x) => x.classList.remove("linktarget", "linkhover")); hintReset(); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Pan du canvas (fond)
  const abSyncSel = () => stage.querySelectorAll(".ab-node").forEach((x) => x.classList.toggle("selected", pgAbSel.has(x.dataset.p)));
  stage.addEventListener("pointerdown", (e) => {
    if (e.target !== stage) return;
    if (pgAbLink) { pgAbLink = null; pgArboRender(s); return; }
    if (pgAbSel.size) { pgAbSel.clear(); abSyncSel(); }
    canvas.classList.add("panning");
    const sx = e.clientX, sy = e.clientY, sl = canvas.scrollLeft, st = canvas.scrollTop;
    const move = (ev) => { canvas.scrollLeft = sl - (ev.clientX - sx); canvas.scrollTop = st - (ev.clientY - sy); };
    const up = () => { canvas.classList.remove("panning"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  // Nodes : survol (toujours) ; drag / câblage / édition seulement si éditable
  stage.querySelectorAll(".ab-node").forEach((ne) => {
    const p = find(ne.dataset.p);
    ne.addEventListener("mouseenter", () => { abHot = p.id; drawWires(); });
    ne.addEventListener("mouseleave", () => { abHot = null; drawWires(); });
    // La maquette se CONSULTE même en lecture seule (édition sur version de travail)
    const mqBtn = ne.querySelector('[data-act="maquette"]');
    if (mqBtn) mqBtn.onclick = (e) => { e.stopPropagation(); pgAbMaquetteModal(s, p, !editable); };
    if (!editable) return;
    ne.addEventListener("pointerdown", (e) => {
      if (e.target.closest('button,.ab-port,.ab-outport,[contenteditable="true"]')) return;
      if (e.shiftKey) return; // maj+clic = sélection (gérée au clic)
      e.preventDefault();
      // Déplacement groupé si ce node fait partie de la sélection multiple
      const group = pgAbSel.has(p.id) && pgAbSel.size > 1
        ? [...pgAbSel].map((pid) => ({ n: find(pid), el: stage.querySelector(`.ab-node[data-p="${pid}"]`) })).filter((g) => g.n && g.el)
        : [{ n: p, el: ne }];
      if (!pgAbSel.has(p.id) && pgAbSel.size) { pgAbSel.clear(); abSyncSel(); }
      const sx = e.clientX, sy = e.clientY;
      const origins = group.map((g) => ({ x: g.n.x, y: g.n.y }));
      let moved = false;
      const move = (ev) => {
        moved = true;
        const dx = (ev.clientX - sx) / abZoom, dy = (ev.clientY - sy) / abZoom;
        group.forEach((g, i) => {
          g.n.x = Math.max(0, origins[i].x + dx);
          g.n.y = Math.max(0, origins[i].y + dy);
          g.el.style.left = g.n.x + "px"; g.el.style.top = g.n.y + "px";
        });
        requestAnimationFrame(drawWires);
      };
      const up = () => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
        if (moved) { group.forEach((g) => { g.n.x = Math.round(g.n.x); g.n.y = Math.round(g.n.y); }); pgArboSave(s.key); }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    // Maj+clic = sélection multiple
    ne.addEventListener("click", (e) => {
      if (!e.shiftKey) return;
      if (pgAbSel.has(p.id)) pgAbSel.delete(p.id); else pgAbSel.add(p.id);
      abSyncSel();
    });
    // Port de sortie du node : glisser jusqu'à une page = lien direct node → node
    const outp = ne.querySelector(".ab-outport");
    if (outp) outp.addEventListener("pointerdown", (e) => startLink(e, { kind: "node", p: p.id, color: "var(--muted)" }, outp));
    const titleEl = ne.querySelector('[data-f="titre"]');
    pgAbEditable(titleEl, (v) => { p.titre = v || "Sans titre"; titleEl.textContent = p.titre; pgArboSave(s.key); });
    ne.querySelectorAll(".ab-phead [data-act]").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        if (b.dataset.act === "maquette") { pgAbMaquetteModal(s, p); return; }
        if (b.dataset.act === "rename") { titleEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return; }
        if (b.dataset.act === "addsec") p.sections.push({ id: pgArboId(), titre: "Nouvelle section", cible: "", color: AB_COLORS[p.sections.length % AB_COLORS.length] });
        if (b.dataset.act === "home") pages.forEach((x) => { x.home = x.id === p.id; });
        if (b.dataset.act === "delpage") {
          arbo.pages = pages.filter((x) => x.id !== p.id);
          for (const q of arbo.pages) {
            for (const sc of q.sections) if (sc.cible === p.id) sc.cible = "";
            if (q.links) q.links = q.links.filter((l) => l.to !== p.id);
          }
          pgArboCache[s.key] = arbo;
        }
        pgArboSave(s.key); pgArboRender(s);
      };
    });
    // Steppers de niveau : ‹ recule, › avance ; clic droit = retour au niveau auto
    ne.querySelectorAll(".ab-meta [data-act]").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        pgAbSetLevel(p, (Number.isFinite(p.level) ? p.level : p._lvl) + (b.dataset.act === "lvlup" ? 1 : -1), pages);
        pgArboSave(s.key); pgArboRender(s);
      };
    });
    const lvlEl = ne.querySelector(".ab-lvl");
    if (lvlEl) lvlEl.oncontextmenu = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (p.level == null) return;
      delete p.level;
      pgAbLayout(pages);        // recalcule _lvl (auto) sans repositionner les autres
      pgAbPlace(p, p._lvl, pages);
      pgArboSave(s.key); pgArboRender(s);
    };
    ne.querySelectorAll(".ab-sec").forEach((se) => {
      const sec = p.sections.find((x) => x.id === se.dataset.s);
      const secTitle = se.querySelector('[data-f="sec-titre"]');
      pgAbEditable(secTitle, (v) => { sec.titre = v || "Section"; secTitle.textContent = sec.titre; pgArboSave(s.key); });
      se.querySelector('[data-act="delsec"]').onclick = (e) => {
        e.stopPropagation();
        p.sections = p.sections.filter((x) => x.id !== sec.id);
        pgArboSave(s.key); pgArboRender(s);
      };
      const port = se.querySelector("[data-port]");
      // Glisser du port jusqu'à une page = destination ; clic droit = détacher
      port.addEventListener("pointerdown", (e) => startLink(e, { kind: "sec", p: p.id, s: sec.id, color: sec.color }, port));
      port.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        sec.cible = ""; pgArboSave(s.key); pgArboRender(s);
      };
    });
  });
}

// ══ Versions de wireframe : colonne de droite dans l'arborescence ══
// Point 3 : la dernière version est en haut. Point 4 : la version « en ligne »
// (celle du site réel, pas forcément la dernière) est marquée. Point 5 : « Pousser ».
const pgWireCache = {};
let pgWireBaselining = false;
// Garantit que la version « Site en ligne » existe (socle = état scanné, toujours
// présent, marqué en ligne) et rattache le doc de travail à cette version quand
// c'est le tout premier chargement. Renvoie le manifeste {versions, deployed}.
async function pgWirePrep(s) {
  let r = await window.olympus.pegasusWireList(s.key);
  const arbo = pgArboCache[s.key];
  if (r.ok && (!r.versions || r.versions.length === 0) && arbo && arbo.pages && !pgWireBaselining) {
    pgWireBaselining = true;
    const sr = await window.olympus.pegasusWireSave(s.key, arbo, "Site en ligne", true);
    pgWireBaselining = false;
    if (sr.ok) { arbo.versionId = sr.id; pgArboSave(s.key); } // le doc de travail = la version en ligne (lecture seule)
    r = await window.olympus.pegasusWireList(s.key);
  }
  return pgWireCache[s.key] = r.ok ? { versions: r.versions || [], deployed: r.deployed || null } : { versions: [], deployed: null };
}
async function pgWireRenderCol(s) {
  const box = $("abVersions"); if (!box) return;
  const r = await window.olympus.pegasusWireList(s.key);
  const man = pgWireCache[s.key] = r.ok ? { versions: r.versions || [], deployed: r.deployed || null } : { versions: [], deployed: null };
  const vs = [...man.versions].sort((a, b) => (a.ts < b.ts ? 1 : -1)); // plus récent en haut
  const fmt = (ts) => { try { return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ts; } };
  box.innerHTML = `
    <div class="abv-h">Versions du wireframe</div>
    ${vs.length ? vs.map((v, i) => `
      <div class="abv-item${man.deployed === v.id ? " deployed" : ""}" data-id="${v.id}">
        <div class="abv-top">
          <span class="abv-name" data-f="vname" title="Double-clic pour renommer">${escapeHtml(v.label || "Sans nom")}</span>
          ${i === 0 ? '<span class="abv-tag last">dernière</span>' : ""}
        </div>
        <div class="abv-date">${fmt(v.ts)}</div>
        ${man.deployed === v.id ? '<div class="abv-live">● version en ligne</div>' : ""}
        <button class="abv-work" data-act="work" title="Ouvre la version locale et travaille d'après ce wireframe">Travailler sur le site depuis ce wireframe</button>
        <div class="abv-acts">
          <button class="abv-open" data-act="load" title="Ouvrir cette version dans l'éditeur">Ouvrir dans l'éditeur ↗</button>
          ${man.deployed === v.id ? '<button class="abv-b" data-act="del" disabled title="La version en ligne ne peut pas être supprimée" style="opacity:.35;cursor:default;">✕</button>' : '<button class="abv-b" data-act="del" title="Supprimer">✕</button>'}
        </div>
      </div>`).join("") : '<div class="abv-empty">Aucune version. Clique « Enregistrer une version » pour figer l\'état actuel du wireframe.</div>'}`;

  box.querySelectorAll(".abv-item").forEach((el) => {
    const id = el.dataset.id;
    const version = man.versions.find((x) => x.id === id) || { id, label: "" };
    const nameEl = el.querySelector('[data-f="vname"]');
    pgAbEditable(nameEl, async (v) => { await window.olympus.pegasusWireRename(s.key, id, v || "Sans nom"); delete pgWireCache[s.key]; });
    el.querySelector('[data-act="load"]').onclick = async () => {
      if (!confirm("Ouvrir cette version dans l'éditeur ? L'état actuel sera remplacé (enregistre-le d'abord si besoin).")) return;
      const lr = await window.olympus.pegasusWireLoad(s.key, id);
      if (lr.ok) { lr.arbo.versionId = id; pgArboCache[s.key] = lr.arbo; pgArboSave(s.key); pgArboRender(s); }
      else alert("Échec : " + (lr.error || ""));
    };
    el.querySelector('[data-act="work"]').onclick = () => pgWireWorkModal(s, version);
    const delBtn = el.querySelector('[data-act="del"]');
    if (delBtn && !delBtn.disabled) delBtn.onclick = async () => {
      if (!confirm("Supprimer cette version ?")) return;
      await window.olympus.pegasusWireDelete(s.key, id);
      delete pgWireCache[s.key]; await pgWireRenderCol(s);
    };
  });
}

// Modale « Travailler sur le site depuis ce wireframe » : ouvre la version locale et,
// au choix, laisse Claude générer automatiquement les pages/sections/boutons/liens
// depuis le wireframe ciblé, ou laisse l'utilisateur construire à la main.
function pgWireWorkModal(s, v) {
  const ov = document.createElement("div");
  ov.className = "modal-overlay show";
  ov.innerHTML = `
    <div class="modal-panel" style="width:600px;">
      <div class="modal-head"><h2>Travailler depuis « ${escapeHtml(v.label || "Sans nom")} »</h2><button class="modal-x" data-x aria-label="Fermer">✕</button></div>
      <div class="modal-body">
        <p class="pg-mnote" style="margin-top:0;">La version locale du site va s'ouvrir. Comment veux-tu créer les pages, sections, boutons et connexions de ce wireframe ?</p>
        <div class="wk-choices">
          <button class="wk-choice" data-mode="auto">
            <div class="wk-t">✨ Génération automatique</div>
            <div class="wk-d">Claude crée et adapte les pages, sections, boutons et liens d'après le wireframe et le moodboard. Une session Claude Code démarre avec les instructions.</div>
          </button>
          <button class="wk-choice" data-mode="manual">
            <div class="wk-t">✋ Manuellement</div>
            <div class="wk-d">La version locale s'ouvre et une session Claude Code prête, sans instructions — tu construis toi-même.</div>
          </button>
        </div>
        <div class="msg" id="wkMsg" style="margin-top:14px;"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelectorAll(".wk-choice").forEach((b) => b.onclick = async () => {
    const mode = b.dataset.mode;
    ov.querySelectorAll(".wk-choice").forEach((x) => x.disabled = true);
    const msg = ov.querySelector("#wkMsg"); msg.className = "msg"; msg.textContent = "Ouverture de la version locale…";
    const r = await window.olympus.pegasusWireWork(s.key, v.id, mode);
    if (r.ok) {
      msg.className = "msg ok";
      msg.textContent = mode === "auto"
        ? "Version locale ouverte + session Claude Code lancée avec les instructions du wireframe."
        : "Version locale ouverte + session Claude Code prête.";
      setTimeout(close, 2000);
    } else {
      msg.className = "msg err"; msg.textContent = r.error || "Échec.";
      ov.querySelectorAll(".wk-choice").forEach((x) => x.disabled = false);
    }
  });
}

// Modale « Maquette » d'une page du wireframe : le contexte de la page + le texte
// de chaque section. C'est la matière que le brief transmet à la construction.
function pgAbMaquetteModal(s, p, ro) {
  const ov = document.createElement("div");
  ov.className = "modal-overlay show";
  ov.innerHTML = `
    <div class="modal-panel" style="width:640px;">
      <div class="modal-head"><h2>Maquette — ${escapeHtml(p.titre)}</h2><button class="modal-x" data-x aria-label="Fermer">✕</button></div>
      <div class="modal-body">
        ${ro ? `<div class="pg-alert" style="border:0;color:var(--dim);margin-bottom:10px;">🔒 Version en ligne — lecture seule. Duplique la version en ligne (barre du haut) pour modifier la maquette.</div>` : ""}
        <div class="mood-h" style="margin-bottom:8px;">Contexte de la page</div>
        <textarea class="mood-in mood-ta" data-mq="ctx" placeholder="À quoi sert cette page, à qui elle parle, ce qu'elle doit provoquer…" ${ro ? "disabled" : ""}>${escapeHtml(p.contexte || "")}</textarea>
        ${(p.sections || []).length ? `<div class="mood-h" style="margin:16px 0 8px;">Les sections</div>` : ""}
        ${(p.sections || []).map((sec, i) => {
          const cible = sec.cible && (pgArboCache[s.key]?.pages || []).find((x) => x.id === sec.cible);
          return `
          <div class="mq-sec">
            <div class="mq-t">
              <span class="ab-secdot" style="background:${sec.color || "var(--line2)"};"></span>${escapeHtml(sec.titre)}
              <span class="mq-dest${cible ? " on" : ""}">${cible ? `⇢ emmène vers <b>${escapeHtml(cible.titre)}</b>` : "⇢ n'emmène nulle part"}</span>
            </div>
            <textarea class="mood-in mood-ta mini" data-mq="${i}" placeholder="Explique la section : son rôle, ce qu'elle raconte, son texte…" ${ro ? "disabled" : ""}>${escapeHtml(sec.texte || "")}</textarea>
            <textarea class="mood-in mood-ta mini mq-anim" data-mqa="${i}" placeholder="Les animations : à l'arrivée, au scroll, au survol…" ${ro ? "disabled" : ""}>${escapeHtml(sec.animation || "")}</textarea>
          </div>`;
        }).join("")}
      </div>
      <div class="modal-foot"><span class="ab-hint" style="flex:1;">${ro ? "Consultation seule." : "Enregistré automatiquement — repris dans le brief de construction."}</span><button class="btn" data-x>Fermer</button></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelectorAll("[data-x]").forEach((b) => b.onclick = close);
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelectorAll("[data-mq],[data-mqa]").forEach((t) => t.oninput = () => {
    if (t.dataset.mqa !== undefined) p.sections[+t.dataset.mqa].animation = t.value;
    else if (t.dataset.mq === "ctx") p.contexte = t.value;
    else p.sections[+t.dataset.mq].texte = t.value;
    pgArboSave(s.key);
    // Le badge 📝 du node s'allume dès qu'une maquette existe
    const btn = document.querySelector(`.ab-node[data-p="${p.id}"] [data-act="maquette"]`);
    if (btn) btn.classList.toggle("has", !!(p.contexte || (p.sections || []).some((sc) => sc.texte || sc.animation)));
  });
}

// ══ Pipeline de travail : le fil conducteur d'un site ══
// Nouveau site (9 étapes guidées) / Refonte complète (mêmes étapes, vues
// préremplies) / Micro-modifications (tout prérempli, retouches libres).
// Chaque étape : guidée, passable, « laisser l'IA choisir », discussion Claude.
// Le dev peut générer le site QUAND il veut — étapes vides = résultat plus
// éloigné de ses attentes, et il en est averti.
const pgPlCache = {};
let pgPlSaveT = null;
function pgPlSave(key) {
  clearTimeout(pgPlSaveT);
  pgPlSaveT = setTimeout(() => window.olympus.pegasusPipelineSave(key, pgPlCache[key]), 400);
}
const PL_ETAPES = [
  { id: "wireframe", titre: "Mise en place du wireframe", vue: "arbo",
    desc: "Structure du site en nodes : pages, sections, connexions. Scanne le site ou pars de zéro, puis enregistre une version.",
    prompt: "On travaille le wireframe du site (arborescence.json : pages, sections, connexions). Regarde l'existant et aide-moi à structurer les pages et les parcours. Quand on décide quelque chose, mets à jour arborescence.json." },
  { id: "maquette", titre: "Maquette — textes & contexte", vue: "arbo",
    desc: "Chaque page du wireframe porte sa maquette : le contexte de la page et le texte de chaque section (bouton 📝 sur les nodes). C'est la matière du site.",
    prompt: "On remplit la maquette : le contexte de chaque page (champ contexte) et le texte de chaque section (champ texte) dans arborescence.json. Propose des textes fidèles au positionnement du site, page par page — je valide ou j'ajuste." },
  { id: "charte", titre: "Charte graphique", vue: "mood",
    desc: "Couleurs, typographies, logo — dans le Moodboard. Pré-remplie si le site existe déjà.",
    prompt: "On définit la charte graphique dans moodboard.json (couleurs, typos, logo, notes). Propose une direction cohérente avec le secteur et l'ambition du site." },
  { id: "niveau", titre: "Niveau du site (1 à 4)", vue: "mood",
    desc: "Le dev choisit le palier de l'offre Orphic : N1 Premium → N4 Ultra luxe. Il conditionne les étapes Blender (7-8).",
    prompt: "Aide-moi à choisir le niveau du site (1 à 4, l'offre Orphic : N1 Premium, N2 Luxe, N3 Luxe supérieur, N4 Ultra luxe) selon le budget, le secteur et l'ambition. Inscris le choix dans moodboard.json (champ niveau)." },
  { id: "references", titre: "Choix des références", vue: "mood",
    desc: "Les références du projet, placées dans le Moodboard. La bibliothèque Orphic est là pour piocher.",
    prompt: "On choisit les références du projet (moodboard.json → refs, format {url, note}). Puise dans la bibliothèque Orphic si les outils pegasus_get_references sont disponibles, et propose-moi une short-list argumentée." },
  { id: "local", titre: "Création du projet en local", action: "local",
    desc: "Le projet prend forme sur le disque. Site de niveau 1-2 (pas de scène Blender) : première génération complète dès cette étape.",
    prompt: "Prépare le projet en local dans ce dossier. Si le site est de niveau 1-2 (pas de scène Blender), lance une première génération complète : suis wireframes/build-*/BRIEF.md s'il existe, sinon construis depuis arborescence.json + moodboard.json, en suivant la doctrine orphic-build." },
  { id: "storytelling", titre: "Scène Blender — le storytelling", n34: true, inline: "story",
    desc: "Site de niveau 3-4 : explique ce que tu recherches — l'émotion, le parcours, ce que la scène raconte.",
    prompt: "On écrit le storytelling de la scène Blender (site de niveau 3-4) : ce que je recherche, l'émotion, le parcours de l'utilisateur, ce que la scène raconte. Mets le résultat dans pipeline.json → etapes.storytelling.texte." },
  { id: "assets", titre: "Les assets", n34: true, inline: "assets",
    desc: "Claude établit la liste des assets nécessaires depuis le storytelling — et te dit quoi fournir. Coche au fur et à mesure.",
    prompt: "Lis le storytelling (pipeline.json → etapes.storytelling.texte), le wireframe (arborescence.json) et le moodboard, puis établis la liste complète des assets nécessaires (images, vidéos, modèles/scènes Blender, textures, sons). Écris-la dans pipeline.json → etapes.assets.liste (format [{nom, note, fourni:false}]) et dis-moi précisément ce que je dois te fournir." },
  { id: "generation", titre: "Génération du site", action: "gen",
    desc: "La construction, en collaboration : Claude peut demander des optimisations d'assets ou des assets supplémentaires.",
    prompt: "On génère le site : suis le brief le plus récent (wireframes/build-*/BRIEF.md) et la doctrine orphic-build. Si un asset manque ou mérite d'être optimisé, demande-le-moi explicitement." },
];
const PL_STATUTS = { afaire: "À faire", fait: "✓ Fait", passee: "Passée", ia: "🤖 IA" };
function pgPlNew(mode) {
  return { mode, etapes: Object.fromEntries(PL_ETAPES.map((e) => [e.id, { statut: "afaire" }])) };
}
async function pgPipelineRender(s) {
  const box = $("pgPipeline"); if (!box) return;
  if (!pgPlCache[s.key]) {
    const r = await window.olympus.pegasusPipelineGet(s.key);
    pgPlCache[s.key] = (r.ok && r.pipeline) || null;
  }
  const pl = pgPlCache[s.key];

  // ── Pas encore de pipeline : choisir le mode de travail ──
  if (!pl || !pl.mode) {
    box.innerHTML = `
      <p class="pg-mnote">Comment veux-tu travailler sur <b>${escapeHtml(s.label)}</b> ? Le pipeline te guide étape par étape — chaque étape peut être passée ou confiée à l'IA, et tu génères le site quand tu veux.</p>
      <div class="wk-choices" style="max-width:640px;">
        <button class="wk-choice" data-mode="nouveau">
          <div class="wk-t">🆕 Nouveau site</div>
          <div class="wk-d">Le site part de zéro. 9 étapes guidées : wireframe → maquette → charte → niveau → références → local → (scène Blender) → génération.</div>
        </button>
        <button class="wk-choice" data-mode="refonte">
          <div class="wk-t">🔄 Refonte complète</div>
          <div class="wk-d">Le site existe : tout est prérempli depuis le site réel (wireframe scanné, charte extraite), et tu reprends chaque étape pour le réinventer.</div>
        </button>
        <button class="wk-choice" data-mode="micro">
          <div class="wk-t">🔧 Micro-modifications</div>
          <div class="wk-d">Tout est prérempli — tu fais des retouches ponctuelles quand nécessaire, sans suivre de pipeline.</div>
        </button>
      </div>`;
    box.querySelectorAll(".wk-choice").forEach((b) => b.onclick = () => {
      pgPlCache[s.key] = pgPlNew(b.dataset.mode);
      pgPlSave(s.key); pgPipelineRender(s);
    });
    return;
  }

  // ── Micro-modifications : pas de stepper, des raccourcis ──
  if (pl.mode === "micro") {
    box.innerHTML = `
      <p class="pg-mnote">Mode <b>micro-modifications</b> : les vues sont préremplies depuis le site réel. Tu retouches ce que tu veux, quand tu veux — le wireframe, la charte, ou directement le code en local.</p>
      <div class="pl-shortcuts">
        <button class="pg-bigbtn" data-goto="arbo"><span class="t">Arborescence</span><span class="d">retoucher le wireframe</span></button>
        <button class="pg-bigbtn" data-goto="mood"><span class="t">Moodboard</span><span class="d">retoucher la charte</span></button>
        <button class="pg-bigbtn" id="plWorkBtn"><span class="t">Travailler sur le site</span><span class="d">local + session Claude</span></button>
      </div>
      <div style="margin-top:18px;"><button class="btn sec" id="plReset">Changer de mode de travail</button></div>`;
    box.querySelectorAll("[data-goto]").forEach((b) => b.onclick = () => { pgSiteTab = b.dataset.goto; pgRenderSide(); pgRenderDetail(); });
    $("plWorkBtn").onclick = async () => {
      if (!confirm("Lancer le site en local + ouvrir une session Claude Code ?")) return;
      await window.olympus.pegasusWorkOn(s.key);
    };
    $("plReset").onclick = () => { if (confirm("Changer de mode ? (les statuts d'étapes seront conservés)")) { pl.mode = null; pgPlSave(s.key); pgPipelineRender(s); } };
    return;
  }

  // ── Nouveau / Refonte : le stepper des 9 étapes ──
  // Le niveau choisi (moodboard) conditionne les étapes Blender (7-8)
  let niveau = pgMoodCache[s.key]?.niveau;
  if (niveau === undefined) {
    const mr = await window.olympus.pegasusMoodboardGet(s.key);
    niveau = (mr.ok && mr.moodboard && mr.moodboard.niveau) || null;
  }
  const et = pl.etapes;
  const remplies = PL_ETAPES.filter((e) => ["fait", "ia"].includes(et[e.id]?.statut)).length;
  const passees = PL_ETAPES.filter((e) => et[e.id]?.statut === "passee");
  const stBadge = (st) => `<span class="pl-badge ${st}">${PL_STATUTS[st] || st}</span>`;

  box.innerHTML = `
    <div class="pl-head">
      <div class="pl-progress"><div class="pl-bar" style="width:${Math.round((remplies / PL_ETAPES.length) * 100)}%"></div></div>
      <span class="pl-count">${remplies}/${PL_ETAPES.length} étapes remplies · mode ${pl.mode === "nouveau" ? "nouveau site" : "refonte"}</span>
      <button class="cal-btn primary" id="plGen">⚡ Générer le site</button>
      <button class="btn sec" id="plReset" title="Revenir au choix du mode">Mode…</button>
    </div>
    ${passees.length ? `<div class="pg-alert warn">⚠ Étapes passées sans être remplies : ${passees.map((e) => e.titre).join(", ")}. Le résultat pourra s'éloigner de tes attentes sur ces points.</div>` : ""}
    <div class="pl-steps">
    ${PL_ETAPES.map((e, i) => {
      const st = et[e.id]?.statut || "afaire";
      const na = e.n34 && niveau && niveau <= 2;
      return `<div class="pl-step ${st}${na ? " na" : ""}" data-e="${e.id}">
        <div class="pl-num">${i + 1}</div>
        <div class="pl-body">
          <div class="pl-t">${e.titre} ${na ? '<span class="pl-badge na">non applicable · site N1-N2</span>' : stBadge(st)}</div>
          <div class="pl-d">${e.desc}${e.n34 && !niveau ? " <i>(selon le niveau choisi à l'étape 4)</i>" : ""}</div>
          ${!na && e.inline === "story" ? `<textarea class="mood-in mood-ta pl-story" placeholder="Ce que tu recherches : l'émotion, le parcours, ce que la scène raconte…">${escapeHtml(et.storytelling?.texte || "")}</textarea>` : ""}
          ${!na && e.inline === "assets" ? `<div class="pl-assets">${(et.assets?.liste || []).map((a, j) => `
            <label class="pl-asset"><input type="checkbox" data-j="${j}" ${a.fourni ? "checked" : ""}><span>${escapeHtml(a.nom)}${a.note ? ` <i>— ${escapeHtml(a.note)}</i>` : ""}</span><button class="mood-del" data-delasset="${j}">✕</button></label>`).join("")}
            <button class="mood-add" id="plAddAsset">＋ Ajouter un asset</button></div>` : ""}
          ${na ? "" : `<div class="pl-acts">
            ${e.vue ? `<button class="pl-b" data-act="open">Ouvrir ${e.vue === "arbo" ? "l'arborescence" : "le moodboard"} →</button>` : ""}
            ${e.action === "local" ? `<button class="pl-b" data-act="work">Lancer en local + Claude</button>` : ""}
            ${e.action === "gen" ? `<button class="pl-b" data-act="gen">⚡ Générer</button>` : ""}
            <button class="pl-b ok${st === "fait" ? " on" : ""}" data-act="fait">✓ Fait</button>
            <button class="pl-b${st === "passee" ? " on" : ""}" data-act="passee">Passer</button>
            <button class="pl-b${st === "ia" ? " on" : ""}" data-act="ia" title="Claude décidera pour cette étape, en suivant la doctrine Orphic">🤖 Laisser l'IA choisir</button>
            <button class="pl-b" data-act="discuss" title="Ouvre une session Claude Code dans le dossier du site, sur cette étape">💬 Discuter avec Claude</button>
          </div>`}
        </div>
      </div>`;
    }).join("")}
    </div>`;

  const gen = async () => {
    const manquantes = PL_ETAPES.filter((e) => {
      const na = e.n34 && niveau && niveau <= 2;
      return !na && e.id !== "generation" && (et[e.id]?.statut || "afaire") === "afaire";
    });
    if (manquantes.length && !confirm(`Étapes non remplies : ${manquantes.map((e) => e.titre).join(", ")}.\n\nTu peux générer quand même, mais le résultat pourra s'éloigner de tes attentes. Continuer ?`)) return;
    const wl = await window.olympus.pegasusWireList(s.key);
    const vs = ((wl.ok && wl.versions) || []).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    if (!vs.length) { alert("Aucune version de wireframe. Va dans l'onglet Arborescence et enregistre une version d'abord."); return; }
    pgWireWorkModal(s, vs[0]);
  };
  $("plGen").onclick = gen;
  $("plReset").onclick = () => { pl.mode = null; pgPlSave(s.key); pgPipelineRender(s); };

  box.querySelectorAll(".pl-step").forEach((el) => {
    const e = PL_ETAPES.find((x) => x.id === el.dataset.e);
    const st = () => et[e.id] || (et[e.id] = { statut: "afaire" });
    el.querySelectorAll(".pl-acts .pl-b").forEach((b) => b.onclick = async () => {
      const act = b.dataset.act;
      if (act === "open") { pgSiteTab = e.vue; pgRenderSide(); pgRenderDetail(); return; }
      if (act === "work") {
        if (!confirm("Créer/lancer le projet en local + ouvrir une session Claude Code ?")) return;
        await window.olympus.pegasusWorkOn(s.key); return;
      }
      if (act === "gen") { gen(); return; }
      if (act === "discuss") {
        const p = `Site « ${s.label} » — pipeline Pegasus, étape « ${e.titre} » (statuts dans pipeline.json). ${e.prompt} Discute avec moi avant d'écrire, et mets à jour les fichiers du projet quand on tranche.`;
        const r = await window.olympus.pegasusPipelineDiscuss(s.key, p);
        if (!r.ok) alert("Échec : " + (r.error || ""));
        return;
      }
      // fait / passee / ia : toggle (re-cliquer = revenir à « à faire »)
      st().statut = st().statut === act ? "afaire" : act;
      pgPlSave(s.key); pgPipelineRender(s);
    });
    // Storytelling inline
    const story = el.querySelector(".pl-story");
    if (story) story.oninput = (ev) => { (et.storytelling = et.storytelling || { statut: "afaire" }).texte = ev.target.value; pgPlSave(s.key); };
    // Assets inline
    el.querySelectorAll(".pl-asset input[type=checkbox]").forEach((c) => c.onchange = () => { et.assets.liste[+c.dataset.j].fourni = c.checked; pgPlSave(s.key); });
    el.querySelectorAll("[data-delasset]").forEach((d) => d.onclick = (ev) => { ev.preventDefault(); et.assets.liste.splice(+d.dataset.delasset, 1); pgPlSave(s.key); pgPipelineRender(s); });
    const add = el.querySelector("#plAddAsset");
    if (add) add.onclick = () => {
      (et.assets = et.assets || { statut: "afaire" }).liste = et.assets.liste || [];
      et.assets.liste.push({ nom: "Nouvel asset", note: "", fourni: false });
      pgPlSave(s.key); pgPipelineRender(s);
    };
  });
}

// ══ Moodboard : charte graphique (couleurs, typos, logo) + références du site ══
// Même logique que le wireframe : pré-réglé depuis le SITE RÉEL (scan des couleurs,
// typos et logo), versionné (socle « Site en ligne » toujours présent, lecture
// seule), duplicable pour être modifié.
const pgMoodCache = {};
let pgMoodSaveT = null;
function pgMoodSave(key) {
  clearTimeout(pgMoodSaveT);
  pgMoodSaveT = setTimeout(() => window.olympus.pegasusMoodboardSave(key, pgMoodCache[key]), 400);
}
const pgMoodBlank = () => ({ couleurs: [], typos: [], logo: "", notes: "", refs: [] });
let pgMbBaselining = false;
// Prépare le moodboard : pré-réglage par scan du site réel au tout premier
// chargement, puis socle « Site en ligne » (version deployed, toujours présente).
async function pgMbPrep(s) {
  if (!pgMoodCache[s.key]) {
    const r = await window.olympus.pegasusMoodboardGet(s.key);
    if (r.ok && r.moodboard) pgMoodCache[s.key] = r.moodboard;
    else {
      const sc = await window.olympus.pegasusMoodboardScan(s.key);
      pgMoodCache[s.key] = (sc.ok && sc.moodboard) || pgMoodBlank();
      pgMoodSave(s.key);
    }
  }
  let l = await window.olympus.pegasusMbList(s.key);
  const mb = pgMoodCache[s.key];
  if (l.ok && (!l.versions || !l.versions.length) && !pgMbBaselining) {
    pgMbBaselining = true;
    const sr = await window.olympus.pegasusMbSave(s.key, mb, "Site en ligne", true);
    pgMbBaselining = false;
    if (sr.ok) { mb.versionId = sr.id; pgMoodSave(s.key); }
    l = await window.olympus.pegasusMbList(s.key);
  }
  return l.ok ? { versions: l.versions || [], deployed: l.deployed || null } : { versions: [], deployed: null };
}
async function pgMoodRender(s) {
  const box = $("pgMood"); if (!box) return;
  box.innerHTML = `<div class="rb-empty">Lecture de la charte du site…</div>`;
  const man = await pgMbPrep(s);
  const mb = pgMoodCache[s.key];
  const editable = (mb.versionId ?? null) !== man.deployed;
  const ro = !editable;
  const save = () => pgMoodSave(s.key);
  box.innerHTML = `
    <div class="pg-actrow" style="margin-bottom:12px;">
      ${editable ? `
      <button class="cal-btn primary" id="mbSaveVer" title="Fige l'état actuel comme une version du moodboard">✓ Enregistrer une version</button>
      <span class="ab-hint">Charte de travail — modifie librement, puis enregistre une version.</span>
      ` : `
      <span class="ab-lock">🔒 Charte du site en ligne — lecture seule. Pour la modifier, crée une version de travail :</span>
      <button class="cal-btn primary" id="mbDupLive" title="Repart de la charte actuelle du site">Dupliquer la version en ligne</button>
      <button class="btn sec" id="mbBlankNew" title="Charte vierge">Partir de zéro</button>
      `}
    </div>
    <div class="mood-layout">
    <div class="mood-main">
    <p class="pg-mnote">La charte graphique de <b>${escapeHtml(s.label)}</b> : couleurs, typographies, logo et références. C'est la base sur laquelle Pegasus construit le site quand tu travailles depuis un wireframe.</p>
    <div class="mood-grid${ro ? " readonly" : ""}">
      <div class="mood-card mood-wide">
        <div class="mood-h">Niveau du site</div>
        <div class="mood-nivs">
          ${[[1, "N1", "Premium"], [2, "N2", "Luxe"], [3, "N3", "Luxe supérieur"], [4, "N4", "Ultra luxe"]].map(([n, t, l]) =>
            `<button class="mood-niv${mb.niveau === n ? " on" : ""}" data-niv="${n}" ${ro ? "disabled" : ""}><b>${t}</b><span>${l}</span>${n >= 3 ? '<i>scène Blender</i>' : ""}</button>`).join("")}
        </div>
      </div>
      <div class="mood-card">
        <div class="mood-h">Couleurs ${ro ? "" : '<button class="mood-add" data-add="couleur">＋</button>'}</div>
        <div class="mood-swatches" id="mbColors">${mb.couleurs.map((c, i) => moodSwatch(c, i, ro)).join("") || '<span class="mood-empty">Aucune couleur</span>'}</div>
      </div>
      <div class="mood-card">
        <div class="mood-h">Typographies ${ro ? "" : '<button class="mood-add" data-add="typo">＋</button>'}</div>
        <div id="mbTypos">${mb.typos.map((t, i) => moodTypo(t, i, ro)).join("") || '<span class="mood-empty">Aucune typo</span>'}</div>
      </div>
      <div class="mood-card">
        <div class="mood-h">Logo</div>
        <input class="mood-in" id="mbLogo" placeholder="URL ou chemin du logo" value="${escapeHtml(mb.logo || "")}" ${ro ? "disabled" : ""}>
        ${mb.logo ? `<div class="mood-logo">${/^https?:|^\/|\.(svg|png|jpe?g|webp)$/i.test(mb.logo) ? `<img src="${escapeHtml(mb.logo)}" alt="logo">` : escapeHtml(mb.logo)}</div>` : ""}
      </div>
      <div class="mood-card mood-wide">
        <div class="mood-h">Références ${ro ? "" : '<button class="mood-add" data-add="ref">＋</button>'}</div>
        <div id="mbRefs">${mb.refs.map((r, i) => moodRef(r, i, ro)).join("") || '<span class="mood-empty">Aucune référence</span>'}</div>
      </div>
      <div class="mood-card mood-wide">
        <div class="mood-h">Notes de direction artistique</div>
        <textarea class="mood-in mood-ta" id="mbNotes" placeholder="Ambiance, intentions, contraintes…" ${ro ? "disabled" : ""}>${escapeHtml(mb.notes || "")}</textarea>
      </div>
    </div>
    </div>
    <div class="ab-versions" id="mbVersions"></div>
    </div>`;

  pgMbRenderCol(s, man);
  // Ouvrir une référence marche dans tous les modes (même en lecture seule)
  box.querySelectorAll("#mbRefs .mood-row .mood-open").forEach((b, i) => {
    b.onclick = () => { if (mb.refs[i] && mb.refs[i].url) window.olympus.openExternal(mb.refs[i].url); };
  });

  if (!editable) {
    box.querySelector("#mbDupLive").onclick = () => {
      const copy = JSON.parse(JSON.stringify(mb));
      copy.versionId = null;            // brouillon non enregistré = éditable
      pgMoodCache[s.key] = copy; pgMoodSave(s.key); pgMoodRender(s);
    };
    box.querySelector("#mbBlankNew").onclick = () => {
      pgMoodCache[s.key] = { ...pgMoodBlank(), versionId: null };
      pgMoodSave(s.key); pgMoodRender(s);
    };
    return; // lecture seule : aucun handler d'édition
  }

  box.querySelector("#mbSaveVer").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    const l = await window.olympus.pegasusMbList(s.key);
    const n = ((l.ok && l.versions) || []).filter((v) => /^Version \d+$/.test(v.label || "")).length + 1;
    const r = await window.olympus.pegasusMbSave(s.key, mb, "Version " + n, false);
    if (r.ok) { mb.versionId = r.id; pgMoodSave(s.key); }
    btn.disabled = false;
    pgMoodRender(s);
  };
  // Niveau du site (1-4) — conditionne les étapes Blender du pipeline
  box.querySelectorAll(".mood-niv").forEach((b) => b.onclick = () => {
    mb.niveau = mb.niveau === +b.dataset.niv ? null : +b.dataset.niv;
    save(); pgMoodRender(s);
  });
  box.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
    if (b.dataset.add === "couleur") mb.couleurs.push({ hex: "#b23a48", nom: "" });
    if (b.dataset.add === "typo") mb.typos.push({ nom: "", role: "" });
    if (b.dataset.add === "ref") mb.refs.push({ url: "", note: "" });
    save(); pgMoodRender(s);
  });
  // Couleurs
  box.querySelectorAll("#mbColors .mood-swatch").forEach((el) => {
    const i = +el.dataset.i;
    el.querySelector('[data-f="hex"]').oninput = (e) => { mb.couleurs[i].hex = e.target.value; el.querySelector(".mood-chip").style.background = e.target.value; el.querySelector('[data-f="hextxt"]').value = e.target.value; save(); };
    el.querySelector('[data-f="hextxt"]').onchange = (e) => { mb.couleurs[i].hex = e.target.value; save(); pgMoodRender(s); };
    el.querySelector('[data-f="nom"]').oninput = (e) => { mb.couleurs[i].nom = e.target.value; save(); };
    el.querySelector(".mood-del").onclick = () => { mb.couleurs.splice(i, 1); save(); pgMoodRender(s); };
  });
  // Typos
  box.querySelectorAll("#mbTypos .mood-row").forEach((el) => {
    const i = +el.dataset.i;
    el.querySelector('[data-f="nom"]').oninput = (e) => { mb.typos[i].nom = e.target.value; save(); };
    el.querySelector('[data-f="role"]').oninput = (e) => { mb.typos[i].role = e.target.value; save(); };
    el.querySelector(".mood-del").onclick = () => { mb.typos.splice(i, 1); save(); pgMoodRender(s); };
  });
  // Refs
  box.querySelectorAll("#mbRefs .mood-row").forEach((el) => {
    const i = +el.dataset.i;
    el.querySelector('[data-f="url"]').oninput = (e) => { mb.refs[i].url = e.target.value; save(); };
    el.querySelector('[data-f="note"]').oninput = (e) => { mb.refs[i].note = e.target.value; save(); };
    el.querySelector(".mood-del").onclick = () => { mb.refs.splice(i, 1); save(); pgMoodRender(s); };
  });
  box.querySelector("#mbLogo").onchange = (e) => { mb.logo = e.target.value.trim(); save(); pgMoodRender(s); };
  box.querySelector("#mbNotes").oninput = (e) => { mb.notes = e.target.value; save(); };
}
// Colonne des versions du moodboard (mêmes cartes que les wireframes, sans « Travailler »)
function pgMbRenderCol(s, man) {
  const box = $("mbVersions"); if (!box) return;
  const vs = [...man.versions].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const fmt = (ts) => { try { return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ts; } };
  box.innerHTML = `
    <div class="abv-h">Versions du moodboard</div>
    ${vs.length ? vs.map((v, i) => `
      <div class="abv-item${man.deployed === v.id ? " deployed" : ""}" data-id="${v.id}">
        <div class="abv-top">
          <span class="abv-name" data-f="vname" title="Double-clic pour renommer">${escapeHtml(v.label || "Sans nom")}</span>
          ${i === 0 ? '<span class="abv-tag last">dernière</span>' : ""}
        </div>
        <div class="abv-date">${fmt(v.ts)}</div>
        ${man.deployed === v.id ? '<div class="abv-live">● version en ligne</div>' : ""}
        <div class="abv-acts">
          <button class="abv-open" data-act="load" title="Ouvrir cette version dans l'éditeur">Ouvrir dans l'éditeur ↗</button>
          ${man.deployed === v.id ? '<button class="abv-b" data-act="del" disabled title="La version en ligne ne peut pas être supprimée" style="opacity:.35;cursor:default;">✕</button>' : '<button class="abv-b" data-act="del" title="Supprimer">✕</button>'}
        </div>
      </div>`).join("") : '<div class="abv-empty">Aucune version.</div>'}`;

  box.querySelectorAll(".abv-item").forEach((el) => {
    const id = el.dataset.id;
    const nameEl = el.querySelector('[data-f="vname"]');
    pgAbEditable(nameEl, async (v) => { await window.olympus.pegasusMbRename(s.key, id, v || "Sans nom"); });
    el.querySelector('[data-act="load"]').onclick = async () => {
      if (!confirm("Ouvrir cette version du moodboard ? L'état actuel sera remplacé (enregistre-le d'abord si besoin).")) return;
      const lr = await window.olympus.pegasusMbLoad(s.key, id);
      if (lr.ok) { lr.moodboard.versionId = id; pgMoodCache[s.key] = lr.moodboard; pgMoodSave(s.key); pgMoodRender(s); }
      else alert("Échec : " + (lr.error || ""));
    };
    const delBtn = el.querySelector('[data-act="del"]');
    if (delBtn && !delBtn.disabled) delBtn.onclick = async () => {
      if (!confirm("Supprimer cette version du moodboard ?")) return;
      await window.olympus.pegasusMbDelete(s.key, id);
      pgMoodRender(s);
    };
  });
}
function moodSwatch(c, i, ro) {
  return `<div class="mood-swatch" data-i="${i}">
    <label class="mood-chip" style="background:${escapeHtml(c.hex || "#000")}"><input type="color" data-f="hex" value="${escapeHtml(c.hex || "#000000")}" ${ro ? "disabled" : ""}></label>
    <input class="mood-in mini" data-f="hextxt" value="${escapeHtml(c.hex || "")}" ${ro ? "disabled" : ""}>
    <input class="mood-in mini" data-f="nom" placeholder="nom" value="${escapeHtml(c.nom || "")}" ${ro ? "disabled" : ""}>
    ${ro ? "" : '<button class="mood-del" title="Supprimer">✕</button>'}
  </div>`;
}
function moodTypo(t, i, ro) {
  return `<div class="mood-row" data-i="${i}">
    <input class="mood-in" data-f="nom" placeholder="Nom de la police" value="${escapeHtml(t.nom || "")}" ${ro ? "disabled" : ""}>
    <input class="mood-in mini" data-f="role" placeholder="rôle (titres…)" value="${escapeHtml(t.role || "")}" ${ro ? "disabled" : ""}>
    ${ro ? "" : '<button class="mood-del" title="Supprimer">✕</button>'}
  </div>`;
}
function moodRef(r, i, ro) {
  return `<div class="mood-row" data-i="${i}">
    <input class="mood-in" data-f="url" placeholder="https://…" value="${escapeHtml(r.url || "")}" ${ro ? "disabled" : ""}>
    <input class="mood-in mini" data-f="note" placeholder="note" value="${escapeHtml(r.note || "")}" ${ro ? "disabled" : ""}>
    <button class="mood-open" title="Ouvrir">↗</button>
    ${ro ? "" : '<button class="mood-del" title="Supprimer">✕</button>'}
  </div>`;
}

function pgTabGeneral(s) {
  const h = pgHealth[s.key], ins = pgInspect[s.key];
  const since = s.created_at ? new Date(s.created_at).toLocaleDateString("fr-FR") : "";
  const hh = h && h.ok ? h.health : null;
  let html = `<p class="pg-mnote">Fiche du site telle que Pegasus la voit à distance (aucun FTP). Les onglets dans la colonne donnent un rapport par thème : <b>SEO</b>, <b>Performance</b>, <b>Sécurité</b>.</p>`;
  if (h && !h.ok) html += `<div class="rb-empty">Site injoignable : ${escapeHtml(h.error || "")}</div>`;
  html += `<div class="pg-kpis">
    <div class="pg-kpi"><div class="n">${hh ? escapeHtml(hh.wp) : "—"}</div><div class="l">WordPress</div></div>
    <div class="pg-kpi"><div class="n">${hh ? escapeHtml(String(hh.php).split("-")[0]) : "—"}</div><div class="l">PHP</div></div>
    <div class="pg-kpi"><div class="n">${hh ? escapeHtml(hh.pegasus) : "—"}</div><div class="l">Pegasus</div></div>
    <div class="pg-kpi"><div class="n">${ins && ins.ok ? (ins.inspect.counts?.page ?? "—") : "—"}</div><div class="l">Pages</div></div>
  </div>`;
  if (ins && ins.ok) {
    const d = ins.inspect;
    const actifs = (d.plugins || []).filter((p) => p.active);
    html += `<div class="pg-sub">Structure</div>`;
    html += `<div class="pg-line"><span class="k">Thème</span><span class="v">${escapeHtml(d.theme?.name || "?")} ${escapeHtml(d.theme?.version || "")}</span></div>`;
    html += `<div class="pg-line"><span class="k">Constructeur</span><span class="v">${escapeHtml(d.page_builder || "?")}</span></div>`;
    html += `<div class="pg-line"><span class="k">Permaliens</span><span class="v">${escapeHtml(d.permalinks || "par défaut (?p=)")}</span></div>`;
    html += `<div class="pg-line"><span class="k">Langue</span><span class="v">${escapeHtml(d.site?.lang || "?")}</span></div>`;
    html += `<div class="pg-line"><span class="k">Contenus</span><span class="v">${d.counts?.page ?? 0} pages · ${d.counts?.post ?? 0} articles</span></div>`;
    html += `<div class="pg-line"><span class="k">Connecté</span><span class="v">${escapeHtml(s.username)}${since ? " · depuis " + since : ""}</span></div>`;
    html += `<div class="pg-sub">Extensions actives · ${actifs.length}</div>`;
    html += actifs.map((p) => `<div class="pg-line"><span class="k">${escapeHtml(p.name)}</span><span class="v">${escapeHtml(p.version || "")}</span></div>`).join("");
    const inactifs = (d.plugins || []).length - actifs.length;
    if (inactifs > 0) html += `<div class="pg-line"><span class="k" style="color:var(--dim);">+ ${inactifs} inactive(s)</span><span class="v"></span></div>`;
  } else if (!ins) {
    html += `<div class="pg-sub">Structure</div><div class="rb-empty">Inspection…</div>`;
  }
  return html;
}

// Panneau des 3 gros boutons (copie / push / retour arrière)
function pgRenderSecPanel(s) {
  const box = $("pgSecPanel"); if (!box) return;
  if (pgSecAction === "copy") return pgSecCopy(s, box);
  if (pgSecAction === "push") return pgSecPush(s, box);
  if (pgSecAction === "rollback") return pgSecRollback(s, box);
  box.innerHTML = "";
}

// ↓ Télécharger la copie locale (deux boutons, pas de fenêtre qui demande)
async function pgSecCopy(s, box) {
  const slug = s.host || s.key;
  box.innerHTML = `<div class="pg-panel"><div class="rb-empty">Vérification du dossier…</div></div>`;
  const st = await window.olympus.pegasusFolderExists(slug);
  const inner = st.exists
    ? `<div class="pg-line"><span class="k">Dossier</span><span class="v">~/Pegasus/${escapeHtml(String(st.path).split("/").pop())}/</span></div>
       <div class="pg-actrow"><button class="cal-btn primary" id="pgCopyVer">Nouvelle version</button><button class="cal-btn" id="pgCopyOver">Rafraîchir (écrase)</button><button class="btn sec" id="pgCopyReveal">Révéler</button><span class="msg" id="pgCopyMsg"></span></div>
       <p class="pg-mnote dim" style="margin-top:6px;">« Nouvelle version » garde l'historique (dossier daté) · « Rafraîchir » écrase pour économiser la place.</p>`
    : `<p class="pg-mnote">Télécharge une copie locale (structure, contenus, page d'accueil) dans le dossier du site.</p>
       <div class="pg-actrow"><button class="cal-btn primary" id="pgCopyVer">Télécharger la copie</button><span class="msg" id="pgCopyMsg"></span></div>`;
  box.innerHTML = `<div class="pg-panel">${inner}</div>`;
  const doCopy = async (mode, btn) => {
    const m = box.querySelector("#pgCopyMsg"); btn.disabled = true; m.className = "msg"; m.textContent = "Copie en cours…";
    const r = await window.olympus.pegasusCopySite(s.key, mode);
    btn.disabled = false;
    if (!r.ok) { m.className = "msg err"; m.textContent = r.error || "Échec."; return; }
    m.className = "msg ok"; m.textContent = r.version ? "Nouvelle version enregistrée." : "Copie à jour.";
    setTimeout(() => pgSecCopy(s, box), 800);
  };
  box.querySelector("#pgCopyVer").onclick = (e) => doCopy(st.exists ? "version" : "overwrite", e.currentTarget);
  const ov = box.querySelector("#pgCopyOver"); if (ov) ov.onclick = (e) => doCopy("overwrite", e.currentTarget);
  const rv = box.querySelector("#pgCopyReveal"); if (rv) rv.onclick = () => window.olympus.pegasusRevealFolder(slug);
}

// ↑ Pousser en ligne : sauvegarde de l'ancien → déploie le thème local → sauvegarde du nouveau
async function pgSecPush(s, box) {
  box.innerHTML = `<div class="pg-panel"><div class="rb-empty">Analyse du dossier local…</div></div>`;
  const info = await window.olympus.pegasusPushInfo(s.key);
  if (!info.ok) { box.innerHTML = `<div class="pg-panel"><p class="pg-mnote">${escapeHtml(info.error || "Rien à déployer.")}</p></div>`; return; }
  box.innerHTML = `<div class="pg-panel">
      <p class="pg-mnote">Déployer le thème local <b>« ${escapeHtml(info.theme)} »</b> vers le site <b>EN LIGNE</b> (${escapeHtml(info.label || info.url)}).</p>
      <p class="pg-mnote dim">Sécurité automatique : une sauvegarde de l'ancien site est prise <b>avant</b>, et une du nouveau <b>après</b> — tu pourras revenir en arrière depuis « Revenir en arrière ».</p>
      <div class="pg-actrow"><button class="cal-btn primary" id="pgPushGo">Déployer maintenant</button><button class="btn sec" id="pgPushCancel">Annuler</button><span class="msg" id="pgPushMsg"></span></div>
    </div>`;
  box.querySelector("#pgPushCancel").onclick = () => { pgSecAction = null; pgRenderDetail(); };
  box.querySelector("#pgPushGo").onclick = async (e) => {
    const m = box.querySelector("#pgPushMsg"), b = e.currentTarget;
    b.disabled = true; box.querySelector("#pgPushCancel").disabled = true;
    m.className = "msg"; m.textContent = "Sauvegarde de sécurité + déploiement…";
    const r = await window.olympus.pegasusPush(s.key);
    b.disabled = false; box.querySelector("#pgPushCancel").disabled = false;
    if (!r.ok) { m.className = "msg err"; m.textContent = "Échec (site inchangé si la sauvegarde a bloqué) : " + (r.error || ""); return; }
    m.className = "msg ok"; m.textContent = `Thème « ${r.theme} » déployé. Sauvegardes avant/après créées.`;
    delete pgInspect[s.key]; delete pgHealth[s.key];
    window.olympus.pegasusSiteHealth(s.key).then((h) => { pgHealth[s.key] = h; });
    window.olympus.pegasusSiteInspect(s.key).then((i) => { pgInspect[s.key] = i; });
  };
}

// ⟲ Revenir en arrière : point de restauration manuel + liste des sauvegardes
function pgSecRollback(s, box) {
  box.innerHTML = `<div class="pg-panel">
      <p class="pg-mnote">Enregistre l'état actuel du site en ligne, ou restaure une version précédente (la version restaurée revient en local, prête à re-déployer — le site en ligne n'est pas touché).</p>
      <div class="pg-actrow"><button class="cal-btn" id="pgBkNow">Enregistrer un point de restauration</button><span class="msg" id="pgBkNowMsg"></span></div>
      <div class="pg-mini">Versions sauvegardées</div>
      <div id="pgSiteBackups"><div class="rb-empty">Chargement…</div></div>
    </div>`;
  box.querySelector("#pgBkNow").onclick = async (e) => {
    const m = box.querySelector("#pgBkNowMsg"), b = e.currentTarget;
    b.disabled = true; m.className = "msg"; m.textContent = "Sauvegarde en cours…";
    const r = await window.olympus.pegasusBackup(s.key, "manual");
    b.disabled = false;
    if (!r.ok) { m.className = "msg err"; m.textContent = r.missing_table ? "Table de sauvegardes non installée (voir ci-dessous)." : (r.error || "Échec."); pgRenderBackups(s); return; }
    m.className = "msg ok"; m.textContent = "Point de restauration enregistré.";
    pgRenderBackups(s);
  };
  pgRenderBackups(s);
}

async function pgRenderBackups(s) {
  const box = $("pgSiteBackups"); if (!box) return;
  const r = await window.olympus.pegasusBackups(s.key);
  if (!r.ok && r.missing_table) {
    const setup = await window.olympus.pegasusBackupsSetup();
    box.innerHTML = `<div class="pg-setup">
      <p><b>Le filet de sauvegarde n'est pas encore installé.</b><br>Colle le SQL <kbd>site-backups.sql</kbd> dans le SQL Editor du Supabase Pegasus, puis reviens ici.</p>
      <div class="act">${setup.sql ? '<button class="cal-btn primary" id="pgBkCopySql">Copier le SQL</button>' : ""}${setup.editor ? `<button class="btn sec pg-open" data-url="${escapeHtml(setup.editor)}" style="padding:8px 16px;font-size:12.5px;">Ouvrir le SQL Editor ↗</button>` : ""}</div>
      <div class="msg" id="pgBkSqlMsg"></div></div>`;
    const cp = box.querySelector("#pgBkCopySql");
    if (cp) cp.onclick = async () => { await navigator.clipboard.writeText(setup.sql); const m = box.querySelector("#pgBkSqlMsg"); m.className = "msg ok"; m.textContent = "SQL copié."; };
    box.querySelectorAll(".pg-open").forEach((b) => { b.onclick = () => window.olympus.openExternal(b.dataset.url); });
    return;
  }
  if (!r.ok) { box.innerHTML = `<div class="rb-empty">${escapeHtml(r.error || "Indisponible.")}</div>`; return; }
  const bks = r.backups || [];
  if (!bks.length) { box.innerHTML = '<div class="rb-empty">Aucune sauvegarde pour l\'instant.</div>'; return; }
  const KIND = { manual: "Manuelle", "pre-push": "Avant déploiement", "post-push": "Après déploiement" };
  box.innerHTML = bks.map((b) => `<div class="pg-bk" data-id="${b.id}">
      <div><div class="t">${escapeHtml(KIND[b.kind] || b.kind)}${b.note ? " · " + escapeHtml(b.note) : ""}</div><div class="meta">${new Date(b.created_at).toLocaleString("fr-FR")}</div></div>
      <button class="btn sec" data-restore="${b.id}">Restaurer</button>
    </div>`).join("");
  box.querySelectorAll("[data-restore]").forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true; const prev = btn.textContent; btn.textContent = "Restauration…";
      const rr = await window.olympus.pegasusRestore(s.key, btn.dataset.restore);
      btn.disabled = false; btn.textContent = prev;
      if (rr.ok) { btn.textContent = "Restaurée ↓"; window.olympus.pegasusRevealFolder(s.host || s.key); }
      else { btn.textContent = "Échec"; }
    };
  });
}

function pgTabSeo(s) {
  const seo = pgSeo[s.key];
  if (!seo) return `<p class="pg-mnote">Audit SEO : lecture du HTML rendu de chaque page (title, meta description, H1, canonical, Open Graph, alt, langue) + détection du plugin SEO, sitemap et robots.txt.</p><button class="cal-btn" id="pgSeoBtn" style="margin-top:4px;">Lancer l'audit SEO</button>`;
  if (seo.loading) return `<div class="rb-empty">Audit en cours… (lecture du HTML rendu de chaque page)</div>`;
  if (!seo.ok) return `<div class="rb-empty">Audit impossible : ${escapeHtml(seo.error || "")}</div><button class="cal-btn" id="pgSeoBtn" style="margin-top:8px;">Réessayer</button>`;
  const a = seo.seo;
  let html = `<div class="pg-line"><span class="k">Plugin SEO</span><span class="v">${escapeHtml(a.plugin_seo)}</span></div>`;
  html += `<div class="pg-line"><span class="k">Sitemap</span><span class="v">${escapeHtml(a.sitemap)}</span></div>`;
  html += `<div class="pg-line"><span class="k">robots.txt</span><span class="v">${escapeHtml(a.robots_txt)}</span></div>`;
  const res = Object.entries(a.resume_problemes || {}).filter(([, n]) => n > 0);
  html += `<div class="pg-sub">Problèmes · ${a.pages_auditees} page(s)</div>`;
  if (!res.length) html += `<div class="pg-alert"><span>✓</span> Aucun problème détecté.</div>`;
  else res.forEach(([k, n]) => { html += `<div class="pg-alert"><span>·</span> ${escapeHtml(k.replace(/_/g, " "))} : <b style="color:var(--txt)">${n}</b></div>`; });
  (a.detail || []).filter((p) => p.problemes && p.problemes[0] !== "aucun").slice(0, 10).forEach((p) => {
    html += `<div class="pg-alert"><span style="color:var(--dim)">${escapeHtml(p.page)}</span> ${escapeHtml((p.problemes || []).join(" · "))}</div>`;
  });
  html += `<button class="cal-btn" id="pgSeoBtn" style="margin-top:12px;">Relancer l'audit</button>`;
  return html;
}

function pgTabPerf(s) {
  const perf = pgPerf[s.key];
  if (!perf) return `<p class="pg-mnote">Rapport de performance via Google PageSpeed (budgets Orphic : LCP &lt; 2,5 s, CLS &lt; 0,1). L'analyse prend 20 à 60 s.</p><button class="cal-btn" id="pgPerfBtn" style="margin-top:4px;">Lancer l'analyse (mobile)</button>`;
  if (perf.loading) return `<div class="rb-empty">Analyse PageSpeed en cours… (20-60 s)</div>`;
  if (!perf.ok) return `<div class="rb-empty">Analyse impossible : ${escapeHtml(perf.error || "")}</div><button class="cal-btn" id="pgPerfBtn" style="margin-top:8px;">Réessayer</button>`;
  const p = perf.perf;
  const lcpOk = p.lcp_ms != null ? p.lcp_ms <= 2500 : null;
  const clsOk = p.cls_val != null ? p.cls_val <= 0.1 : null;
  const mark = (ok) => ok == null ? "" : ok ? ` <b style="color:var(--ok)">✓</b>` : ` <b style="color:var(--err)">✕ hors budget</b>`;
  let html = `<div class="pg-kpis">
    <div class="pg-kpi"><div class="n" style="color:${p.score >= 90 ? "var(--ok)" : p.score >= 50 ? "var(--warn)" : "var(--err)"}">${p.score}</div><div class="l">Score perf · ${escapeHtml(p.strategy)}</div></div>
  </div>`;
  html += `<div class="pg-sub">Métriques (terrain / labo PageSpeed)</div>`;
  html += `<div class="pg-line"><span class="k">LCP</span><span class="v">${escapeHtml(p.lcp || "—")}${mark(lcpOk)}</span></div>`;
  html += `<div class="pg-line"><span class="k">CLS</span><span class="v">${escapeHtml(p.cls || "—")}${mark(clsOk)}</span></div>`;
  html += `<div class="pg-line"><span class="k">First Contentful Paint</span><span class="v">${escapeHtml(p.fcp || "—")}</span></div>`;
  html += `<div class="pg-line"><span class="k">Total Blocking Time</span><span class="v">${escapeHtml(p.tbt || "—")}</span></div>`;
  html += `<div class="pg-line"><span class="k">Speed Index</span><span class="v">${escapeHtml(p.si || "—")}</span></div>`;
  html += `<button class="cal-btn" id="pgPerfBtn" style="margin-top:12px;">Relancer l'analyse</button>`;
  return html;
}

function pgTabSecu(s) {
  const h = pgHealth[s.key], ins = pgInspect[s.key];
  const hh = h && h.ok ? h.health : null;
  const https = /^https:\/\//i.test(s.base_url);
  const phpMajor = hh ? parseFloat(String(hh.php)) : null;
  let html = `<p class="pg-mnote">Points de vigilance dérivés de ce que Pegasus lit à distance. Un vrai suivi CVE/uptime viendra avec l'agent de monitoring.</p>`;
  html += `<div class="pg-sub">Vigilance</div>`;
  html += `<div class="pg-alert"><span style="color:${https ? "var(--ok)" : "var(--err)"}">${https ? "✓" : "✕"}</span> Connexion HTTPS ${https ? "active" : "absente — requise par les mots de passe d'application"}</div>`;
  if (hh) {
    html += `<div class="pg-alert"><span style="color:var(--dim)">·</span> WordPress <b style="color:var(--txt)">${escapeHtml(hh.wp)}</b> — garder à jour</div>`;
    const phpFlag = phpMajor != null && phpMajor < 8.1;
    html += `<div class="pg-alert"><span style="color:${phpFlag ? "var(--warn)" : "var(--ok)"}">${phpFlag ? "!" : "✓"}</span> PHP <b style="color:var(--txt)">${escapeHtml(String(hh.php).split("-")[0])}</b>${phpFlag ? " — version un peu ancienne, envisager une mise à niveau" : ""}</div>`;
  }
  if (ins && ins.ok) {
    const d = ins.inspect;
    const total = (d.plugins || []).length, actifs = (d.plugins || []).filter((p) => p.active).length;
    html += `<div class="pg-alert"><span style="color:var(--dim)">·</span> ${total} extension(s) installée(s), ${actifs} active(s) — surface à tenir à jour</div>`;
    html += `<div class="pg-sub">Versions des extensions actives</div>`;
    html += (d.plugins || []).filter((p) => p.active).map((p) => `<div class="pg-line"><span class="k">${escapeHtml(p.name)}</span><span class="v">${escapeHtml(p.version || "?")}</span></div>`).join("");
  } else if (!ins) {
    html += `<div class="rb-empty">Inspection…</div>`;
  }
  return html;
}

async function pgRunSeo(key) {
  pgSeo[key] = { loading: true };
  pgRenderDetail();
  const r = await window.olympus.pegasusSiteSeo(key, 10);
  pgSeo[key] = r;
  if (pgSel === key) pgRenderDetail();
}
async function pgRunPerf(key) {
  pgPerf[key] = { loading: true };
  pgRenderDetail();
  const r = await window.olympus.pegasusSitePerf(key, "mobile");
  pgPerf[key] = r;
  if (pgSel === key) pgRenderDetail();
}

// ── La bibliothèque Orphic (références vivantes — Supabase via Pegasus)
function pgRefFilters() {
  return {
    q: $("pgRefQ").value.trim(),
    kind: pgFacet.kind || "",
    niveau: pgFacet.niveau || "",
    registre: pgFacet.registre || "",
    business: pgFacet.business || "",
    statut: $("pgRefStatut").value,
  };
}
async function pgLoadRefs() {
  const box = $("pgRefs");
  document.querySelectorAll(".pg-bibfold").forEach((el) => el.classList.toggle("active", pgFacetEq(el)));
  $("pgLibTitle").textContent = pgFacet.label || "Bibliothèque";
  pgBibCounts();
  const r = await window.olympus.pegasusRefs(pgRefFilters());
  if (!r.ok && r.missing_table) {
    const setup = await window.olympus.pegasusRefsSetup();
    box.innerHTML = `<div class="pg-setup">
      <p><b>La bibliothèque n'est pas encore installée.</b><br>Une seule étape : coller le SQL <kbd>references-library.sql</kbd> dans le SQL Editor du Supabase Pegasus, puis revenir ici.</p>
      <div class="act">
        ${setup.sql ? '<button class="cal-btn primary" id="pgCopySql">Copier le SQL</button>' : ""}
        ${setup.editor ? `<button class="btn sec pg-open" data-url="${escapeHtml(setup.editor)}" style="padding:8px 16px;font-size:12.5px;">Ouvrir le SQL Editor ↗</button>` : ""}
      </div>
      <div class="msg" id="pgSqlMsg"></div>
    </div>`;
    const cp = box.querySelector("#pgCopySql");
    if (cp) cp.onclick = async () => { await navigator.clipboard.writeText(setup.sql); const m = box.querySelector("#pgSqlMsg"); m.className = "msg ok"; m.textContent = "SQL copié — colle-le dans le SQL Editor."; };
    box.querySelectorAll(".pg-open").forEach((b) => { b.onclick = () => window.olympus.openExternal(b.dataset.url); });
    pgFillGhosts(box);
    return;
  }
  if (!r.ok) { box.innerHTML = `<div class="rb-empty">${escapeHtml(r.error || "Bibliothèque indisponible.")}</div>`; pgFillGhosts(box); return; }
  const refs = r.refs || [];
  if (!refs.length) { box.innerHTML = '<div class="rb-empty">Aucune référence — la bibliothèque se remplit par l\'usage (veille, projets).</div>'; pgFillGhosts(box); return; }

  const rowHTML = (x, opts = {}) => {
    const dot = x.statut === "valide" ? "ok" : x.statut === "rejete" ? "err" : "warn";
    const badgeVals = (opts.showKind === false ? [] : [x.kind]).concat([x.niveau, x.registre]).filter(Boolean);
    const badges = badgeVals.map((b) => `<span class="pg-badge">${escapeHtml(b)}</span>`).join("");
    const metaBits = [opts.hideBusiness ? "" : x.business, x.technique, x.ingredients, x.auteur ? "par " + x.auteur : "", opts.hideDate ? "" : (x.created_at ? new Date(x.created_at).toLocaleDateString("fr-FR") : "")].filter(Boolean);
    const title = opts.label || x.titre;
    const acts = x.statut === "candidat"
      ? `<button data-act="valide">Valider</button><button data-act="rejete">Rejeter</button>`
      : x.statut === "valide"
        ? `<button data-act="rejete">Rejeter</button>`
        : `<button data-act="valide">Valider</button><button data-act="suppr">✕</button>`;
    return `<div class="pg-ref" data-id="${x.id}">
      <span class="pg-dot ${dot}"></span>
      <div>
        <div class="t">${x.url ? `<a data-url="${escapeHtml(x.url)}">${escapeHtml(title)} ↗</a>` : escapeHtml(title)}</div>
        <div class="meta">${escapeHtml(metaBits.join(" · "))}</div>
      </div>
      ${badges}
      <div class="pg-ract">${acts}</div>
    </div>`;
  };

  box.innerHTML = refs.map((x) => rowHTML(x)).join("");
  mArrive(box); // la bibliothèque émerge en cascade au changement de facette
  box.querySelectorAll(".pg-ref .t a[data-url]").forEach((a) => { a.onclick = () => window.olympus.openExternal(a.dataset.url); });
  box.querySelectorAll(".pg-ract button").forEach((b) => {
    b.onclick = async () => {
      const id = b.closest(".pg-ref").dataset.id;
      if (b.dataset.act === "suppr") await window.olympus.pegasusRefDelete(id);
      else await window.olympus.pegasusRefSet(id, b.dataset.act);
      pgLoadRefs();
    };
  });
  pgFillGhosts(box);
}
let pgRefQTimer;
$("pgRefQ").addEventListener("input", () => { clearTimeout(pgRefQTimer); pgRefQTimer = setTimeout(pgLoadRefs, 300); });
$("pgRefStatut").addEventListener("change", pgLoadRefs);

// ── Proposer une référence
$("pgRefNew").onclick = () => {
  const open = $("pgRefForm").classList.toggle("show");
  if (open) { // pré-classe la référence dans la facette ouverte
    if (pgFacet.kind) $("pgRfKind").value = pgFacet.kind;
    if (pgFacet.niveau) $("pgRfNiveau").value = pgFacet.niveau;
    if (pgFacet.registre) $("pgRfRegistre").value = pgFacet.registre;
  }
};
$("pgRfCancel").onclick = () => { $("pgRefForm").classList.remove("show"); };
$("pgRfSave").onclick = async () => {
  const msg = $("pgRfMsg");
  const row = {
    titre: $("pgRfTitre").value.trim(),
    url: $("pgRfUrl").value.trim(),
    kind: $("pgRfKind").value,
    niveau: $("pgRfNiveau").value,
    registre: $("pgRfRegistre").value,
    business: $("pgRfBusiness").value.trim(),
    ingredients: $("pgRfIngredients").value.trim(),
    statut: $("pgRfValide").checked ? "valide" : "candidat",
  };
  if (!row.titre) { msg.className = "msg err"; msg.textContent = "Le titre est obligatoire."; return; }
  const r = await window.olympus.pegasusRefAdd(row);
  if (!r.ok) { msg.className = "msg err"; msg.textContent = r.error || "Enregistrement impossible."; return; }
  msg.className = "msg ok"; msg.textContent = row.statut === "valide" ? "Référence enregistrée (validée)." : "Proposée en candidate — à valider.";
  ["pgRfTitre", "pgRfUrl", "pgRfBusiness", "pgRfIngredients"].forEach((id) => { $(id).value = ""; });
  $("pgRfValide").checked = false;
  setTimeout(() => { $("pgRefForm").classList.remove("show"); msg.textContent = ""; }, 900);
  pgLoadRefs();
};

document.querySelector('.nav-item[data-app="pegasus"]').addEventListener("click", (e) => {
  if (e.currentTarget.classList.contains("locked")) return;
  pgSetCarousel(pgCarousel);
});

// ── Footer : nouveau site & connexion d'un site existant (vues plein écran)
document.querySelectorAll("[data-pgback]").forEach((b) => { b.onclick = () => pgSetView("parc"); });
$("pgConnectSite").onclick = () => pgSetView("connect");
$("pgNewSite").onclick = () => { $("pgNsMsg").textContent = ""; pgSetView("new"); };

// Connexion : révéler le plugin WordPress + rafraîchir le parc
$("pgRevealPlugin").onclick = async () => {
  const m = $("pgRevealMsg");
  const r = await window.olympus.pegasusRevealPlugin();
  if (r.ok) { m.className = "msg ok"; m.textContent = "Ouvert dans le Finder."; }
  else { m.className = "msg err"; m.textContent = r.error || "Introuvable."; }
};
$("pgRefreshParc").onclick = async () => {
  Object.keys(pgHealth).forEach((k) => delete pgHealth[k]);
  Object.keys(pgInspect).forEach((k) => delete pgInspect[k]);
  pgSetView("parc");
};

// Type de projet (WordPress local / sur-mesure)
let pgNsType = "wordpress";
$("pgNsType").querySelectorAll(".toggle").forEach((b) => {
  b.onclick = () => { pgNsType = b.dataset.t; $("pgNsType").querySelectorAll(".toggle").forEach((x) => x.classList.toggle("on", x === b)); };
});

// Nouveau site : crée le projet + son dossier de travail (~/Pegasus/<slug>/)
$("pgNsSave").onclick = async () => {
  const nom = $("pgNsNom").value.trim();
  const msg = $("pgNsMsg");
  if (!nom) { msg.className = "msg err"; msg.textContent = "Le nom du site est obligatoire."; return; }
  const proj = {
    id: "p" + Date.now().toString(36),
    nom,
    type: pgNsType,
    url: $("pgNsUrl").value.trim(),
    secteur: $("pgNsSecteur").value,
    niveau: $("pgNsNiveau").value,
    registre: $("pgNsRegistre").value,
    intention: $("pgNsIntention").value,
    notes: $("pgNsNotes").value.trim(),
    created: Date.now(),
  };
  const btn = $("pgNsSave"); btn.disabled = true;
  msg.className = "msg"; msg.textContent = pgNsType === "wordpress" ? "Création du dossier + téléchargement de WordPress…" : "Création des fichiers de développement…";
  const r = await window.olympus.pegasusScaffold(proj);
  btn.disabled = false;
  if (r.ok) { proj.slug = r.slug; proj.folder = r.path; proj.scaffolded = true; }
  else { msg.className = "msg err"; msg.textContent = "Projet créé, mais dossier non généré : " + (r.error || "") + " — tu pourras réessayer depuis la fiche."; }
  pgProjects.unshift(proj);
  pgSaveProjects();
  ["pgNsNom", "pgNsUrl", "pgNsNotes"].forEach((id) => { $(id).value = ""; });
  ["pgNsSecteur", "pgNsNiveau", "pgNsRegistre", "pgNsIntention"].forEach((id) => { $(id).value = ""; });
  pgNsType = "wordpress"; $("pgNsType").querySelectorAll(".toggle").forEach((x) => x.classList.toggle("on", x.dataset.t === "wordpress"));
  msg.textContent = "";
  pgSetView("parc");
  pgSelectProject(proj.id);
};

// ══════════ CHRONOS — support de la modal (équipe · fichiers · lieu) ══════════
async function renderParticipantChips(selected) {
  const set = new Set((Array.isArray(selected) ? selected : (selected || "").split(",")).map((s) => String(s).trim()).filter(Boolean));
  const p = await window.olympus.presenceOnline();
  const names = [...new Set((p.users || []).map((u) => u.name).filter(Boolean).concat(FAKE_MEMBERS.map((f) => f.name)))];
  const box = $("evParticipants");
  box.innerHTML = names.length
    ? names.map((n) => `<span class="chip-toggle${set.has(n) ? " selected" : ""}" data-name="${escapeHtml(n)}">${escapeHtml(n)}</span>`).join("")
    : '<div class="rb-empty">Les membres apparaissent après leur 1re connexion.</div>';
}
function collectParticipants() { return [...$("evParticipants").querySelectorAll(".chip-toggle.selected")].map((c) => c.dataset.name); }
$("evParticipants").onclick = (e) => { const c = e.target.closest(".chip-toggle"); if (c) c.classList.toggle("selected"); };

let currentAttachments = [];
function renderEvFiles() {
  const box = $("evFiles");
  box.innerHTML = currentAttachments.length
    ? currentAttachments.map((f, i) => `<div class="crm-row" style="padding:8px 0"><div style="flex:1;min-width:0"><span class="link" data-file="${i}">${escapeHtml(f.name)}</span></div><span class="member-btn danger" data-rmfile="${i}">Retirer</span></div>`).join("")
    : '<div class="rb-empty">Aucun fichier.</div>';
}
$("evFiles").onclick = (e) => {
  const open = e.target.closest("[data-file]"); if (open) { const f = currentAttachments[+open.dataset.file]; if (f) window.olympus.openExternal(f.url); return; }
  const rm = e.target.closest("[data-rmfile]"); if (rm) { currentAttachments.splice(+rm.dataset.rmfile, 1); renderEvFiles(); }
};
$("evUploadBtn").onclick = async () => {
  const folder = $("eventModal").dataset.folder || "misc";
  const btn = $("evUploadBtn"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Envoi…';
  const r = await window.olympus.chronosUpload(folder);
  btn.disabled = false; btn.textContent = "+ Ajouter des fichiers";
  if (r.ok && r.files.length) { currentAttachments.push(...r.files); renderEvFiles(); }
};
$("evMapsLink").onclick = () => { const a = $("evLocation").value.trim(); if (a) window.olympus.openExternal("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a)); };
$("evPerso").onclick = () => $("evPerso").classList.toggle("on");
$("evBusy").onclick = () => $("evBusy").classList.toggle("on");

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

// ══════════ HERMÈS (conversations + chat) ══════════
// Membres de démo (en attendant les vrais comptes) — fusionnés dans l'équipe, les chips, les partages.
const FAKE_MEMBERS = [
  { name: "Lucas Dubois", online: true },
  { name: "Astrid Berges", online: false },
];
const initialsOf = (n) => String(n || "?").split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join("").toUpperCase();
let chatLastId = 0, chatTimer = null;
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtTime(iso) { try { return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }

// Barres d'onde d'un vocal (pseudo-aléatoires mais stables par seed)
const vBars = (seed, n = 26) => [...Array(n)].map((_, i) => `<i style="height:${(6 + Math.abs(Math.sin(seed * 3.7 + i * 1.31)) * 17).toFixed(0)}px;--i:${i}"></i>`).join("");
const phGrad = (i) => ["linear-gradient(135deg,#4a4a52,#232328)", "linear-gradient(135deg,#5c5c66,#2c2c31)", "linear-gradient(160deg,#3b3b42,#191920)", "linear-gradient(120deg,#6a6a74,#35353c)"][i % 4];

// Conversations de démo (le canal Équipe est le vrai chat branché sur Supabase)
let hmConvs = [
  { id: "team", kind: "channel", name: "Équipe Orphic", sub: "Canal général — toute l'équipe", real: true, unread: 0, last: "", time: "" },
  { id: "dm-lucas", kind: "dm", name: "Lucas Dubois", online: true, unread: 2, msgs: [
    { d: "Hier", a: "Lucas Dubois", t: "14:12", kind: "text", body: "J'ai fini le montage du teaser, tu veux le voir ?" },
    { d: "Hier", mine: true, t: "14:20", kind: "text", body: "Grave ! Envoie 🔥" },
    { d: "Hier", a: "Lucas Dubois", t: "14:21", kind: "file", name: "teaser_v2.mp4", size: "148 Mo", icon: "🎬" },
    { d: "Aujourd'hui", a: "Lucas Dubois", t: "09:02", kind: "voice", dur: "0:42", seed: 3 },
    { d: "Aujourd'hui", a: "Lucas Dubois", t: "09:03", kind: "text", body: "Dis-moi ce que t'en penses avant le call de 10h" },
  ] },
  { id: "dm-astrid", kind: "dm", name: "Astrid Berges", online: false, unread: 0, msgs: [
    { d: "Mardi", a: "Astrid Berges", t: "11:35", kind: "image", cap: "Moodboard — Maison Solène", g: 0 },
    { d: "Mardi", mine: true, t: "11:48", kind: "text", body: "Canon. On part là-dessus pour la DA." },
    { d: "Mardi", a: "Astrid Berges", t: "12:02", kind: "voice", dur: "1:17", seed: 8 },
    { d: "Mardi", a: "Astrid Berges", t: "12:03", kind: "text", body: "Parfait, je prépare la shotlist ce soir ✨" },
  ] },
  { id: "g-solene", kind: "group", name: "Prod — Maison Solène", members: ["Sacha", "Lucas Dubois", "Astrid Berges"], unread: 1, msgs: [
    { d: "Mercredi", a: "Astrid Berges", t: "10:04", kind: "text", body: "Le client a validé les 3 axes, on lock la date de shoot ?" },
    { d: "Mercredi", mine: true, t: "10:11", kind: "text", body: "Oui — samedi 18, 9h au studio de Cannes. Je crée l'événement dans Chronos." },
    { d: "Mercredi", a: "Lucas Dubois", t: "10:12", kind: "text", body: "Je réserve le matos lumière 👌" },
    { d: "Aujourd'hui", a: "Lucas Dubois", t: "08:41", kind: "image", cap: "Repérage studio — fond 2.4m", g: 1 },
    { d: "Aujourd'hui", a: "Astrid Berges", t: "08:55", kind: "file", name: "shotlist_solene.pdf", size: "1,2 Mo", icon: "📄" },
  ] },
  { id: "g-emotions", kind: "group", name: "Shoot Émotions Arts", members: ["Sacha", "Lucas Dubois"], unread: 0, msgs: [
    { d: "Lundi", mine: true, t: "17:32", kind: "text", body: "Les rushs sont sur Atlas, dossier Shoots 2026 / Émotions Arts." },
    { d: "Lundi", a: "Lucas Dubois", t: "17:40", kind: "text", body: "Reçu. Je fais la sélection demain matin et je pousse dans Apollon." },
    { d: "Lundi", a: "Lucas Dubois", t: "17:41", kind: "voice", dur: "0:23", seed: 5 },
  ] },
];
let hmCur = null;

function convLast(c) {
  if (c.real) return c.last || "Dis bonjour à l'équipe…";
  const m = c.msgs[c.msgs.length - 1];
  if (!m) return "";
  const p = m.mine ? "Toi : " : (c.kind === "group" ? (m.a || "").split(" ")[0] + " : " : "");
  return m.kind === "text" ? p + m.body : m.kind === "voice" ? p + "🎙 Message vocal" : m.kind === "image" ? p + "📷 Photo" : p + "📎 " + m.name;
}
function convTime(c) { if (c.real) return c.time || ""; const m = c.msgs[c.msgs.length - 1]; return m ? m.t : ""; }
function convAvatar(c) {
  const st = c.kind === "dm" ? `<span class="st ${c.online ? "on" : "off"}"></span>` : "";
  const label = c.kind === "channel" ? "◎" : initialsOf(c.name);
  return `<div class="hm-av">${label}${st}</div>`;
}
function convRow(c) {
  const un = c.unread ? `<span class="hm-unread">${c.unread}</span>` : "";
  return `<div class="hm-conv${hmCur && hmCur.id === c.id ? " active" : ""}" data-conv="${c.id}">${convAvatar(c)}<div class="hm-cinfo"><div class="hm-cname">${escapeHtml(c.name)}</div><div class="hm-clast">${escapeHtml(convLast(c))}</div></div><div class="hm-cmeta"><span class="hm-ctime">${convTime(c)}</span>${un}</div></div>`;
}
function renderConvList() {
  const q = ($("hmSearch").value || "").toLowerCase();
  const match = (c) => !q || c.name.toLowerCase().includes(q);
  $("hmChannels").innerHTML = hmConvs.filter((c) => c.kind === "channel" && match(c)).map(convRow).join("");
  $("hmDms").innerHTML = hmConvs.filter((c) => c.kind === "dm" && match(c)).map(convRow).join("");
  $("hmGroups").innerHTML = hmConvs.filter((c) => c.kind === "group" && match(c)).map(convRow).join("");
}
function msgHtml(m, conv) {
  const mine = !!m.mine;
  const author = !mine && conv.kind !== "dm" ? `<div class="author">${escapeHtml(m.a || "?")}</div>` : "";
  let inner = "";
  if (m.kind === "voice") inner = `<div class="vmsg" data-voice><button class="vplay">▶</button><div class="vbars">${vBars(m.seed || 1)}</div><span class="vdur">${m.dur}</span></div>`;
  else if (m.kind === "image") inner = `<div class="imsg"><div class="ph" style="background:${phGrad(m.g || 0)}">📷</div><div class="cap">${escapeHtml(m.cap || "")}</div></div>`;
  else if (m.kind === "file") inner = `<div class="fmsg"><div class="ficon">${m.icon || "📄"}</div><div><div class="fname">${escapeHtml(m.name)}</div><div class="fsize">${m.size || ""}</div></div><span class="fdl" title="Télécharger">⤓</span></div>`;
  else inner = `<div>${escapeHtml(m.body)}</div>`;
  return `<div class="bubble ${mine ? "me" : "them"}">${author}${inner}<div class="time">${m.t || ""}</div></div>`;
}
function renderFakeMsgs(conv) {
  const box = $("chatMessages");
  let html = "", day = null;
  for (const m of conv.msgs) {
    if (m.d && m.d !== day) { day = m.d; html += `<div class="hm-day">${day}</div>`; }
    html += msgHtml(m, conv);
  }
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}
function openConv(id) {
  const c = hmConvs.find((x) => x.id === id); if (!c) return;
  hmCur = c; c.unread = 0;
  $("hmHeadAv").textContent = c.kind === "channel" ? "◎" : initialsOf(c.name);
  $("hmHeadName").textContent = c.name;
  $("hmHeadSub").textContent = c.kind === "channel" ? c.sub : c.kind === "group" ? c.members.join(" · ") : (c.online ? "en ligne" : "hors ligne");
  if (c.real) { $("chatMessages").innerHTML = ""; chatLastId = 0; chatTick(); }
  else renderFakeMsgs(c);
  renderConvList();
}
function appendMessage(m) {
  if (!hmCur || !hmCur.real) return;
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
  if (!hmCur || !hmCur.real) return;
  const r = await window.olympus.chatList(chatLastId);
  if (r.ok && r.messages && r.messages.length) {
    r.messages.forEach(appendMessage);
    const last = r.messages[r.messages.length - 1];
    chatLastId = last.id;
    const team = hmConvs.find((c) => c.id === "team");
    team.last = last.body; team.time = fmtTime(last.created_at);
    renderConvList();
  }
}
function startChat() {
  renderConvList();
  openConv("team");
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = setInterval(chatTick, 3000);
}
const nowT = () => new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
function pushLocal(m) {
  m.d = "Aujourd'hui"; m.t = nowT(); m.mine = true;
  hmCur.msgs.push(m);
  renderFakeMsgs(hmCur);
  renderConvList();
}
async function sendMsg() {
  const input = $("chatInput"), body = input.value.trim();
  if (!body || !hmCur) return;
  input.value = "";
  if (hmCur.real) {
    const r = await window.olympus.chatSend(body);
    if (r.ok && r.message) { appendMessage(r.message); chatLastId = Math.max(chatLastId, r.message.id); }
    else if (!r.ok) { input.value = body; }
  } else pushLocal({ kind: "text", body });
}
$("chatSend").onclick = sendMsg;
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendMsg(); });
$("hmSearch").addEventListener("input", renderConvList);
document.querySelector(".hm-side").addEventListener("click", (e) => { const row = e.target.closest("[data-conv]"); if (row) openConv(row.dataset.conv); });
// Lecture d'un vocal (démo) : les barres s'animent
$("chatMessages").addEventListener("click", (e) => {
  const v = e.target.closest("[data-voice]");
  if (v) { v.classList.toggle("playing"); v.querySelector(".vplay").textContent = v.classList.contains("playing") ? "❚❚" : "▶"; }
});
// Joindre un fichier / média
$("chatAttach").onclick = () => {
  if (!hmCur) return;
  const inp = document.createElement("input"); inp.type = "file";
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const img = /\.(jpe?g|png|gif|webp|heic)$/i.test(f.name);
    const size = f.size > 1048576 ? (f.size / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(f.size / 1024)) + " Ko";
    if (hmCur.real) { $("chatInput").value = "📎 " + f.name; sendMsg(); }
    else pushLocal(img ? { kind: "image", cap: f.name, g: 2 } : { kind: "file", name: f.name, size, icon: /\.(mp4|mov)$/i.test(f.name) ? "🎬" : /\.(pdf)$/i.test(f.name) ? "📄" : "📁" });
  };
  inp.click();
};
// Message vocal (démo) : clic = enregistre, re-clic = envoie
let recStart = null;
$("chatMic").onclick = () => {
  if (!hmCur) return;
  const btn = $("chatMic");
  if (!recStart) { recStart = Date.now(); btn.classList.add("rec"); $("chatInput").placeholder = "Enregistrement en cours… re-clique pour envoyer"; return; }
  const sec = Math.max(1, Math.round((Date.now() - recStart) / 1000));
  recStart = null; btn.classList.remove("rec"); $("chatInput").placeholder = "Écris un message…";
  const dur = Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  if (hmCur.real) { $("chatInput").value = "🎙 Message vocal (" + dur + ")"; sendMsg(); }
  else pushLocal({ kind: "voice", dur, seed: Math.floor(Math.random() * 40) });
};
// Nouveau groupe
$("hmNewGroup").onclick = () => { const f = $("hmGroupForm"); f.style.display = f.style.display === "none" ? "" : "none"; if (f.style.display === "") $("hmGroupName").focus(); };
$("hmGroupCreate").onclick = () => {
  const name = $("hmGroupName").value.trim(); if (!name) return;
  const id = "g-" + Date.now();
  hmConvs.push({ id, kind: "group", name, members: ["Sacha", "Lucas Dubois", "Astrid Berges"], unread: 0, msgs: [] });
  $("hmGroupName").value = ""; $("hmGroupForm").style.display = "none";
  openConv(id);
};

// ══════════ HERMÈS — roue de date + agenda du jour ══════════
let wheelDate = new Date();
let wheelGran = "day";
let zoneUnits = { left: "month", center: "day", right: "week" }; // unité modifiée par zone (survol + scroll)
let hoverZone = null;
const MON_ABBR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const DOW_FULL = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
// Graduations : arc fixe et symétrique, mais qui défile (tourne) au scroll grâce à `spin`.
// Les traits sont réguliers → au repos l'image est toujours la même, seul le défilé anime.
let spin = 0, spinTarget = 0, spinRAF = null;
const TICK_STEP = 72 / 43;                     // espacement de base (2*half/(N-1))
function renderTicks() {
  const g = document.getElementById("wticks"); if (!g) return;
  const cx = 307, cy = 135, Ri = 178, Ro = 196, half = 36, gap = 9;
  const frac = ((spin % TICK_STEP) + TICK_STEP) % TICK_STEP; // défilé sur un pas
  let s = "";
  for (let ang = -half + frac; ang <= half + 1e-3; ang += TICK_STEP) {
    const a = Math.abs(ang);
    if (a < gap) continue;                      // petit trou pour le chiffre
    const A = (180 + ang) * Math.PI / 180, c = Math.cos(A), sn = Math.sin(A);
    const inFade = Math.min(1, (a - gap) / 13); // s'efface dans le halo près du chiffre
    const outFade = Math.min(1, (half - a) / 12); // s'efface aux extrémités (les traits y apparaissent/disparaissent)
    const op = Math.max(0.05, 0.72 * Math.min(inFade, outFade));
    s += `<line class="wtick" x1="${(cx + Ri * c).toFixed(1)}" y1="${(cy + Ri * sn).toFixed(1)}" x2="${(cx + Ro * c).toFixed(1)}" y2="${(cy + Ro * sn).toFixed(1)}" style="opacity:${op.toFixed(2)}"/>`;
  }
  g.innerHTML = s;
}
function animateSpin() {
  spin += (spinTarget - spin) * 0.18;
  if (Math.abs(spinTarget - spin) < 0.04) { spin = spinTarget; spinRAF = null; renderTicks(); return; }
  renderTicks();
  spinRAF = requestAnimationFrame(animateSpin);
}
function kickSpin(dir) {
  if (M_REDUCED) return;                        // version calme : la roue ne tourne pas
  spinTarget += dir * 10;                       // élan par cran
  const cap = 44;                               // évite l'emballement en scroll rapide
  spinTarget = Math.max(spin - cap, Math.min(spin + cap, spinTarget));
  if (!spinRAF) spinRAF = requestAnimationFrame(animateSpin);
}
function drawWheel() {
  const d = wheelDate, y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  const mx = 120, my = 135;                    // sélection = point le plus à gauche de l'arc
  let s = '<defs><radialGradient id="wglow"><stop offset="0" class="wg0"/><stop offset=".55" class="wg1"/><stop offset="1" class="wg2"/></radialGradient></defs><g id="wticks"></g>';
  const mon = MON_ABBR[m].replace(".", "");
  let hero, left = "", right = "";
  if (wheelGran === "day") { hero = String(day); left = mon; right = "S" + isoWeek(d); zoneUnits = { left: "month", center: "day", right: "week" }; }
  else if (wheelGran === "week") { hero = "S" + isoWeek(d); left = mon; right = String(y); zoneUnits = { left: "month", center: "week", right: "year" }; }
  else if (wheelGran === "month") { hero = mon; right = String(y); zoneUnits = { center: "month", right: "year" }; }
  else { hero = String(y); zoneUnits = { center: "year" }; }
  s += `<circle cx="${mx}" cy="${my}" r="31" fill="url(#wglow)"/>`;
  s += `<text id="wHero" class="whero" x="${mx}" y="${my}">${hero}</text>`;
  if (left) s += `<text id="wLeft" class="wctx" x="${mx - 28}" y="${my}">${left}</text>`;
  if (right) s += `<text id="wRight" class="wctx r" x="${mx + 28}" y="${my}">${right}</text>`;
  $("wheelSvg").innerHTML = s;
  renderTicks();
  applyHover();
}
let agendaEvents = [];
async function renderWheel() {
  const d = wheelDate;
  drawWheel();
  syncGridToWheel();                         // la grille suit le jour de la roue
  $("agendaHead").textContent = DOW_FULL[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()];
  const iso = isoD(d.getFullYear(), d.getMonth(), d.getDate());
  const r = await window.olympus.chronosList(iso, iso);
  agendaEvents = (r.ok ? r.events : []).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  $("agendaDay").innerHTML = agendaEvents.length
    ? agendaEvents.map((e) => {
        const dot = e.is_personal ? "" : `<span class="ev-dot" style="background:${catColor(e.category)}"></span>`;
        const who = e.is_personal && e.assignee ? `<span class="ev-name">${escapeHtml(e.assignee)}</span> · ` : "";
        return `<div class="agenda-ev${e.is_personal ? " perso" : ""}" data-ev="${e.id}"><div>${dot}${who}${escapeHtml(e.title)}</div>${e.time ? `<div class="t">${e.time.slice(0, 5)}</div>` : ""}</div>`;
      }).join("")
    : '<div class="rb-empty">Rien de prévu ce jour-là.</div>';
}
function highlightSelected() {
  document.querySelectorAll("#calScroll .cal-cell").forEach((c) => c.classList.toggle("sel", c.dataset.date === calSelected));
}
function syncGridToWheel() {
  calSelected = isoD(wheelDate.getFullYear(), wheelDate.getMonth(), wheelDate.getDate());
  if (calView !== "month") { renderChronos(); return; }   // semaine/jour : suivent le jour sélectionné
  if (wheelDate.getFullYear() !== calDate.getFullYear() || wheelDate.getMonth() !== calDate.getMonth()) {
    calDate = new Date(wheelDate.getFullYear(), wheelDate.getMonth(), 1);
    renderChronos();                         // change de mois → regénère la grille (surligne calSelected)
  } else {
    highlightSelected();
  }
}
$("agendaDay").onclick = (e) => {
  const item = e.target.closest(".agenda-ev"); if (!item) return;
  const ev = agendaEvents.find((x) => String(x.id) === item.dataset.ev);
  if (ev) openEventForm(ev.date, ev);
};
function stepUnit(unit, dir) {
  if (!unit) return;
  const d = new Date(wheelDate);
  if (unit === "day") d.setDate(d.getDate() + dir);
  else if (unit === "week") d.setDate(d.getDate() + dir * 7);
  else if (unit === "month") d.setMonth(d.getMonth() + dir);
  else if (unit === "year") d.setFullYear(d.getFullYear() + dir);
  wheelDate = d; renderWheel();
}
function applyHover() {
  const map = { left: "wLeft", center: "wHero", right: "wRight" };
  for (const id of ["wLeft", "wHero", "wRight"]) { const el = document.getElementById(id); if (el) el.classList.remove("hot"); }
  const el = hoverZone && document.getElementById(map[hoverZone]); if (el) el.classList.add("hot");
}
function wheelZone(e) {
  const r = e.currentTarget.getBoundingClientRect();
  const vx = 46 + ((e.clientX - r.left) / r.width) * 144;   // repère viewBox (décalé)
  let z = vx < 100 ? "left" : vx > 146 ? "right" : "center";
  if (!zoneUnits[z]) z = "center";                     // repli si pas de libellé dans la zone
  return z;
}
$("wheelSvg").addEventListener("wheel", (e) => { e.preventDefault(); const dir = e.deltaY > 0 ? 1 : -1; kickSpin(dir); stepUnit(zoneUnits[wheelZone(e)], dir); }, { passive: false });
$("wheelSvg").addEventListener("mousemove", (e) => { const z = wheelZone(e); if (z !== hoverZone) { hoverZone = z; applyHover(); } });
$("wheelSvg").addEventListener("mouseleave", () => { if (hoverZone) { hoverZone = null; applyHover(); } });

// ══════════ CHRONOS (calendrier) ══════════
let calDate = new Date();
let calSelected = null;
let editingEvent = null;
let chronosEvents = [];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const pad2 = (n) => String(n).padStart(2, "0");
const isoD = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

let calMonths = [];                                        // 1er de chaque mois affiché (ascendant)
let calLoading = false;
const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
const todayIsoNow = () => { const n = new Date(); return isoD(n.getFullYear(), n.getMonth(), n.getDate()); };
// Couleur de pastille par catégorie d'événement.
const CAT_COLOR = {
  call: "#5b9bd5", rdv: "#45c4b0", reunion: "#a98bd6", shoot: "#e0a862",
  rendu: "#6cc48f", campagne: "#d98cb0", client: "#8a93de", deadline: "#e0885a",
  divers: "#8a8a90", general: "#8a8a90", client_meeting: "#8a93de",
};
const catColor = (c) => CAT_COLOR[c] || CAT_COLOR.general;
const evEnd = (ev) => (ev.end_date && ev.end_date > ev.date ? ev.end_date : ev.date);
// Étale chaque event sur tous les jours de sa plage (multi-jours) → { iso: [events] }.
function groupByDate(events) {
  const byDate = {};
  for (const ev of events) {
    const end = evEnd(ev), [y, m, d] = ev.date.split("-").map(Number);
    for (let cur = new Date(y, m - 1, d), i = 0; i < 90; i++) {
      const iso = isoD(cur.getFullYear(), cur.getMonth(), cur.getDate());
      (byDate[iso] = byDate[iso] || []).push(ev);
      if (iso === end) break;
      cur.setDate(cur.getDate() + 1);
    }
  }
  return byDate;
}
// Puce : point coloré (catégorie), barre remplie si multi-jours, ou rouge + nom si perso.
function chipHtml(ev, dayIso) {
  const t = ev.time ? ev.time.slice(0, 5) + " " : "";
  if (ev.is_personal) {
    const who = ev.assignee ? `<span class="ev-name">${escapeHtml(ev.assignee)}</span> · ` : "";
    return `<div class="ev-chip perso${ev.done ? " done" : ""}" data-ev="${ev.id}">${who}${t}${escapeHtml(ev.title)}</div>`;
  }
  const end = evEnd(ev);
  if (end !== ev.date && dayIso) {                             // multi-jours : barre remplie
    const isStart = dayIso === ev.date, isEnd = dayIso === end;
    const [Y, M, D] = dayIso.split("-").map(Number);
    const col = (new Date(Y, M - 1, D).getDay() + 6) % 7;      // Lun=0 … Dim=6
    const rl = isStart || col === 0, rr = isEnd || col === 6;   // bords arrondis au début/fin/bord de semaine
    return `<div class="ev-chip span${rl ? " rl" : ""}${rr ? " rr" : ""}${ev.done ? " done" : ""}" data-ev="${ev.id}" style="--c:${catColor(ev.category)}">${escapeHtml(ev.title)}</div>`;
  }
  return `<div class="ev-chip${ev.done ? " done" : ""}" data-ev="${ev.id}"><span class="ev-dot" style="background:${catColor(ev.category)}"></span>${t}${escapeHtml(ev.title)}</div>`;
}
function dayCell(y, m, day, byDate, todayIso, firstCol, isLast) {
  const dIso = isoD(y, m, day);
  const cls = (dIso === todayIso ? " today" : "") + (dIso === calSelected ? " sel" : "") + (day === 1 ? " mstart" : "") + (isLast ? " mend" : "");
  const chips = (byDate[dIso] || []).map((ev) => chipHtml(ev, dIso)).join("");
  const style = firstCol ? ` style="grid-column-start:${firstCol}"` : "";
  const mark = day === 1 ? ` data-mstart="${monthKey(new Date(y, m, 1))}"` : "";
  return `<div class="cal-cell${cls}" data-date="${dIso}"${style}${mark}><div class="cal-daynum">${day}</div>${chips}</div>`;
}
// Labels de mois (à droite) + traits glow, placés DANS le calendrier (offsetTop) → scroll natif, aucune désync.
function positionCalMonths() {
  const days = $("calDays"), labels = $("calLabels"), flow = days && days.parentElement;
  if (!days || !labels || !flow) return;
  flow.querySelectorAll(".cal-div").forEach((d) => d.remove());
  let labHtml = "", divs = "";
  calMonths.forEach((mo, mi) => {
    const cell = days.querySelector(`[data-mstart="${monthKey(mo)}"]`);
    if (!cell) return;
    const top = cell.offsetTop;
    labHtml += `<div class="cal-mlabel" style="top:${top}px">${MONTHS[mo.getMonth()]} ${mo.getFullYear()}</div>`;
    if (mi !== 0) divs += `<div class="cal-div" style="top:${top - 8}px"></div>`;  // centré dans le gap (16px), pas de trait avant le 1er mois
  });
  labels.innerHTML = labHtml;
  flow.insertAdjacentHTML("beforeend", divs);
}
// Grille continue : les jours s'enchaînent d'un mois à l'autre (seul le tout 1er jour est calé sur son jour de semaine).
async function paintCal() {
  const first = calMonths[0], last = calMonths[calMonths.length - 1];
  const lastEnd = new Date(last.getFullYear(), last.getMonth() + 1, 0);
  const r = await window.olympus.chronosList(isoD(first.getFullYear(), first.getMonth(), 1), isoD(lastEnd.getFullYear(), lastEnd.getMonth(), lastEnd.getDate()));
  chronosEvents = r.ok ? r.events : [];
  const byDate = groupByDate(chronosEvents);
  const todayIso = todayIsoNow();
  let cells = "";
  calMonths.forEach((mo, mi) => {
    const y = mo.getFullYear(), m = mo.getMonth(), days = new Date(y, m + 1, 0).getDate();
    for (let day = 1; day <= days; day++) {
      const firstCol = (mi === 0 && day === 1) ? ((new Date(y, m, 1).getDay() + 6) % 7) + 1 : 0;
      cells += dayCell(y, m, day, byDate, todayIso, firstCol, day === days);
    }
  });
  $("calScroll").innerHTML = `<div class="cal-flow"><div class="cal-days" id="calDays">${cells}</div><div class="cal-labels" id="calLabels"></div></div>`;
  positionCalMonths();
}
let calView = "month";                                     // month | week | day
async function renderChronos() {
  $("calDow").style.display = calView === "month" ? "" : "none";
  $("calScroll").dataset.view = calView;
  document.querySelectorAll("#calViews button").forEach((b) => b.classList.toggle("active", b.dataset.view === calView));
  if (calView === "week") return renderWeekView();
  if (calView === "day") return renderDayView();
  return renderMonthView();
}
async function renderMonthView() {
  const cur = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
  calMonths = [-2, -1, 0, 1, 2].map((k) => new Date(cur.getFullYear(), cur.getMonth() + k, 1));
  $("calDow").innerHTML = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("");
  await paintCal();
  const cell = $("calDays").querySelector(`[data-mstart="${monthKey(cur)}"]`);
  if (cell) $("calScroll").scrollTop = Math.max(0, cell.offsetTop - 30);
}
// ── Timeline horaire (vues Semaine & Jour) ──
let HPX = 60;                                                 // hauteur d'une heure (calculée au rendu pour remplir la page)
const timeToMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
function computeHPX() { HPX = Math.max(56, Math.min(82, Math.round(($("calScroll").clientHeight - 180) / 12))); } // ~12h visibles
function earliestHour(events) {
  const timed = events.filter((e) => e.time);
  if (!timed.length) return 9;                                // pas d'event → démarre à 9h
  return Math.max(0, Math.min(...timed.map((e) => Math.floor(timeToMin(e.time) / 60))));
}
function tlGutter() { let h = ""; for (let hr = 0; hr <= 24; hr++) h += `<div class="tl-hour" style="top:${hr * HPX}px">${String(hr % 24).padStart(2, "0")}:00</div>`; return h; }
function tlLines() { let h = ""; for (let hr = 0; hr <= 24; hr++) h += `<div class="tl-line" style="top:${hr * HPX}px"></div>`; return h; }
function tlEvent(ev) {
  const s = timeToMin(ev.time), en = ev.end_time ? timeToMin(ev.end_time) : s + 60;
  const top = s / 60 * HPX, height = Math.max(18, (en - s) / 60 * HPX - 2);
  const color = ev.is_personal ? "var(--err)" : catColor(ev.category);
  const who = ev.is_personal && ev.assignee ? `<span class="ev-name">${escapeHtml(ev.assignee)}</span> · ` : "";
  const time = ev.time.slice(0, 5) + (ev.end_time ? "–" + ev.end_time.slice(0, 5) : "");
  return `<div class="tl-ev${ev.is_personal ? " perso" : ""}" data-ev="${ev.id}" style="top:${top}px;height:${height}px;--c:${color}"><div class="tl-ev-t">${who}${escapeHtml(ev.title)}</div><div class="tl-ev-time">${time}</div></div>`;
}
// ── Bande horizontale infinie de jours (vues Semaine & Jour) ──
let tlBuf = [], tlVis = 7, tlColW = 140, tlLoading = false;
const isoOf = (x) => isoD(x.getFullYear(), x.getMonth(), x.getDate());
function dayHeadCell(x, byDate, todayIso) {
  const iso = isoOf(x), cls = (iso === todayIso ? " today" : "") + (iso === calSelected ? " sel" : "");
  const ad = (byDate[iso] || []).filter((e) => !e.time).map((e) => chipHtml(e, iso)).join("");
  return `<div class="tl-head${cls}" data-date="${iso}"><div class="tl-hd"><span class="wd">${DOW[(x.getDay() + 6) % 7]}</span><span class="wn">${x.getDate()}</span></div><div class="tl-had">${ad}</div></div>`;
}
function dayColCell(x, byDate, todayIso) {
  const iso = isoOf(x), cls = iso === todayIso ? " today" : "";
  const timed = (byDate[iso] || []).filter((e) => e.time).sort((a, b) => timeToMin(a.time) - timeToMin(b.time));
  return `<div class="tl-col${cls}" data-date="${iso}">${tlLines()}${timed.map(tlEvent).join("")}</div>`;
}
let tlPan = 0, calDragPan = 0;
function tlApplyPan() {
  const h = $("tlHeads"), c = $("tlCols");
  if (h) h.style.transform = `translateX(${tlPan}px)`;
  if (c) c.style.transform = `translateX(${tlPan}px)`;
}
function tlPaint() {
  const byDate = groupByDate(chronosEvents);
  const todayIso = todayIsoNow(), bodyH = 24 * HPX;
  const strip = `grid-template-columns:repeat(${tlBuf.length}, ${tlColW}px);transform:translateX(${tlPan}px)`;
  const heads = tlBuf.map((x) => dayHeadCell(x, byDate, todayIso)).join("");
  const cols = tlBuf.map((x) => dayColCell(x, byDate, todayIso)).join("");
  $("calScroll").innerHTML = `<div class="cal-tl2 ${tlVis === 1 ? "day" : "week"}"><div class="tl-corner2"></div><div class="tl-headsclip"><div class="tl-heads" id="tlHeads" style="${strip}">${heads}</div></div><div class="tl-gutter2" style="height:${bodyH}px">${tlGutter()}</div><div class="tl-colsclip"><div class="tl-cols" id="tlCols" style="${strip};height:${bodyH}px">${cols}</div></div></div>`;
}
async function renderTimeline(vis) {
  tlVis = vis;
  const anchor = new Date(wheelDate), start = new Date(anchor);
  if (vis === 7) start.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));    // lundi
  start.setDate(start.getDate() - vis);                                            // 1 fenêtre de marge avant
  const total = vis * 5;
  tlBuf = [...Array(total)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const r = await window.olympus.chronosList(isoOf(tlBuf[0]), isoOf(tlBuf[total - 1]));
  chronosEvents = r.ok ? r.events : [];
  computeHPX();
  tlColW = Math.max(100, Math.round(($("calScroll").clientWidth - 54 - 452) / vis));
  tlPan = -vis * tlColW;                                                            // démarre sur wheelDate (index vis)
  tlPaint();
  $("calScroll").scrollTop = earliestHour(chronosEvents) * HPX;
}
// Pan infini : ajoute des jours en approchant des bords de la bande.
async function tlMaybeWindow() {
  if (tlLoading || calView === "month") return;
  const clip = document.querySelector(".tl-colsclip"), clipW = clip ? clip.clientWidth : 400;
  const stripW = tlBuf.length * tlColW, add = tlVis * 2;
  if (tlPan > -tlColW) {                                     // proche du début → prépend
    tlLoading = true;
    const first = tlBuf[0];
    const days = [...Array(add)].map((_, i) => { const d = new Date(first); d.setDate(first.getDate() - add + i); return d; });
    const r = await window.olympus.chronosList(isoOf(days[0]), isoOf(days[add - 1]));
    chronosEvents = chronosEvents.concat(r.ok ? r.events : []);
    tlBuf = days.concat(tlBuf);
    tlPan -= add * tlColW; calDragPan -= add * tlColW;       // garde la position visuelle
    tlPaint();
    tlLoading = false;
  } else if (tlPan < -(stripW - clipW) + tlColW) {           // proche de la fin → append
    tlLoading = true;
    const last = tlBuf[tlBuf.length - 1];
    const days = [...Array(add)].map((_, i) => { const d = new Date(last); d.setDate(last.getDate() + 1 + i); return d; });
    const r = await window.olympus.chronosList(isoOf(days[0]), isoOf(days[add - 1]));
    chronosEvents = chronosEvents.concat(r.ok ? r.events : []);
    tlBuf = tlBuf.concat(days);
    tlPaint();
    tlLoading = false;
  }
}
async function renderWeekView() { return renderTimeline(7); }
async function renderDayView() { return renderTimeline(1); }
$("calViews").onclick = (e) => {
  const b = e.target.closest("button[data-view]"); if (!b) return;
  calView = b.dataset.view;
  renderChronos();
};
// Scroll infini : ajoute les mois adjacents en approchant des bords (re-render + maintien de position)
$("calScroll").addEventListener("scroll", async () => {
  if (calView !== "month") return;                        // scroll infini : vue Mois uniquement
  const el = $("calScroll");
  if (calLoading) return;
  if (el.scrollTop < 200) {
    calLoading = true;
    const oldTop = el.scrollTop, oldH = el.scrollHeight;
    calMonths.unshift(new Date(calMonths[0].getFullYear(), calMonths[0].getMonth() - 1, 1));
    await paintCal();
    el.scrollTop = oldTop + (el.scrollHeight - oldH);
    calLoading = false;
  } else if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) {
    calLoading = true;
    const oldTop = el.scrollTop;
    const lm = calMonths[calMonths.length - 1];
    calMonths.push(new Date(lm.getFullYear(), lm.getMonth() + 1, 1));
    await paintCal();
    el.scrollTop = oldTop;
    calLoading = false;
  }
});
$("calAdd").onclick = () => { const n = new Date(); openEventForm(calSelected || isoD(n.getFullYear(), n.getMonth(), n.getDate())); };

$("calScroll").onclick = (e) => {
  if (calDragged) { calDragged = false; return; }             // c'était un glissement, pas un clic
  const evEl = e.target.closest(".ev-chip") || e.target.closest(".cal-devent") || e.target.closest(".tl-ev");
  if (evEl && evEl.dataset.ev) { const ev = chronosEvents.find((x) => String(x.id) === evEl.dataset.ev); if (ev) openEventForm(ev.date, ev); return; }
  const cell = e.target.closest("[data-date]");
  if (cell) { const [Y, M, D] = cell.dataset.date.split("-").map(Number); wheelDate = new Date(Y, M - 1, D); renderWheel(); } // sélectionne le jour → roue + agenda
};

// Glisser le fond (vues semaine/jour) → défile les jours (X, translateX) ET les heures (Y, scrollTop), à l'infini.
let calDragX = null, calDragY = 0, calDragTop = 0, calDragged = false;
$("calScroll").addEventListener("mousedown", (e) => {
  if (calView === "month") return;
  if (e.target.closest(".tl-ev, .ev-chip, .tl-had, .tl-hd")) return;   // pas sur un event / une entête
  calDragX = e.clientX; calDragY = e.clientY; calDragPan = tlPan; calDragTop = $("calScroll").scrollTop; calDragged = false;
  e.preventDefault();
});
window.addEventListener("mousemove", (e) => {
  if (calDragX === null) return;
  const dx = e.clientX - calDragX, dy = e.clientY - calDragY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) calDragged = true;
  tlPan = calDragPan + dx;
  tlApplyPan();
  $("calScroll").scrollTop = calDragTop - dy;
  tlMaybeWindow();
});
window.addEventListener("mouseup", () => { calDragX = null; });

function openEventForm(date, ev) {
  editingEvent = ev || null;
  const g = (id, v) => ($(id).value = v || "");
  g("evTitle", ev?.title); $("evDate").value = date;
  g("evEndDate", ev?.end_date);
  $("evTime").value = ev?.time ? ev.time.slice(0, 5) : "";
  $("evEnd").value = ev?.end_time ? ev.end_time.slice(0, 5) : "";
  $("evCat").value = ev?.category || "general";
  g("evAssignee", ev?.assignee);
  $("evPerso").classList.toggle("on", !!ev?.is_personal);
  $("evBusy").classList.toggle("on", ev ? ev.show_busy !== false : true);
  g("evClient", ev?.client);
  $("evType").value = ev?.shoot_type || "";
  g("evDelivery", ev?.delivery_date);
  renderParticipantChips(ev?.participants);
  g("evObjectives", ev?.objectives); g("evMoodboard", ev?.moodboard); g("evLocation", ev?.location); g("evShotlist", ev?.shotlist);
  $("eventModal").dataset.folder = ev?.id ? String(ev.id) : ("new-" + Math.random().toString(36).slice(2, 10));
  currentAttachments = Array.isArray(ev?.attachments) ? ev.attachments.slice() : [];
  renderEvFiles();
  const locs = [...new Set(chronosEvents.map((e) => e.location).filter(Boolean))];
  $("evLocList").innerHTML = locs.map((l) => `<option value="${escapeHtml(l)}">`).join("");
  $("evModalTitle").textContent = ev ? "Modifier l'événement" : "Nouvel événement";
  $("evSave").textContent = ev ? "Enregistrer" : "Ajouter";
  $("evDelete").style.display = ev ? "" : "none";
  $("evDone").style.display = ev ? "" : "none";
  if (ev) $("evDone").textContent = ev.done ? "Marquer à faire" : "Marquer fait";
  $("evMsg").textContent = "";
  $("eventModal").classList.add("show");
  $("evTitle").focus();
}
function closeEventModal() { $("eventModal").classList.remove("show"); }
$("evCancel").onclick = closeEventModal;
$("eventModal").onclick = (e) => { if (e.target === $("eventModal")) closeEventModal(); };
$("evSave").onclick = async () => {
  const val = (id) => $(id).value.trim();
  const data = {
    title: val("evTitle"), date: $("evDate").value, end_date: $("evEndDate").value || null,
    time: $("evTime").value || null, end_time: $("evEnd").value || null,
    category: $("evCat").value, assignee: val("evAssignee") || null,
    is_personal: $("evPerso").classList.contains("on"),
    show_busy: $("evBusy").classList.contains("on"),
    client: val("evClient") || null, shoot_type: $("evType").value || null,
    delivery_date: $("evDelivery").value || null,
    participants: collectParticipants(), attachments: currentAttachments,
    objectives: val("evObjectives") || null, moodboard: val("evMoodboard") || null,
    location: val("evLocation") || null, shotlist: val("evShotlist") || null,
  };
  if (!data.title || !data.date) { $("evMsg").className = "msg err"; $("evMsg").textContent = "Titre et date requis."; return; }
  const btn = $("evSave"), label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>…';
  const r = editingEvent ? await window.olympus.chronosUpdate(editingEvent.id, data) : await window.olympus.chronosCreate(data);
  btn.disabled = false; btn.textContent = label;
  if (r.ok) { closeEventModal(); renderChronos(); renderWheel(); refreshRightbar(); }
  else { $("evMsg").className = "msg err"; $("evMsg").textContent = r.error || "Échec."; }
};
$("evDelete").onclick = async () => {
  if (!editingEvent) return;
  const r = await window.olympus.chronosDelete(editingEvent.id);
  if (r.ok) { closeEventModal(); renderChronos(); renderWheel(); refreshRightbar(); }
};
$("evDone").onclick = async () => {
  if (!editingEvent) return;
  const r = await window.olympus.chronosUpdate(editingEvent.id, { done: !editingEvent.done });
  if (r.ok) { closeEventModal(); renderChronos(); renderWheel(); refreshRightbar(); }
};
document.querySelector('.nav-item[data-page="chronos"]').addEventListener("click", () => { renderChronos(); renderWheel(); });

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
  for (const f of FAKE_MEMBERS) if (!users.some((u) => u.name === f.name)) users.push({ name: f.name, last_seen: f.online ? new Date().toISOString() : new Date(nowMs - 36e5).toISOString() });
  const isOn = (u) => nowMs - new Date(u.last_seen).getTime() < 120000;
  users.sort((a, b) => (isOn(b) - isOn(a)) || (a.name || "").localeCompare(b.name || ""));
  $("rbOnline").innerHTML = users.length
    ? users.map((u) => { const on = isOn(u); const n = u.name || "?"; return `<div class="rb-user"><div class="avatar-sm">${escapeHtml(n.charAt(0).toUpperCase())}</div><span style="flex:1${on ? "" : ";color:var(--muted)"}">${escapeHtml(n)}</span><span class="status-dot ${on ? "on" : "off"}"></span></div>`; }).join("")
    : '<div class="rb-empty">—</div>';
  if (rbView === 1) rbRenderChat();
  else if (rbView === 2) rbRenderMail();
}
function startPresence() {
  window.olympus.presenceBeat();
  refreshRightbar();
  if (rbTimer) clearInterval(rbTimer);
  rbTimer = setInterval(() => { window.olympus.presenceBeat(); refreshRightbar(); }, 30000);
}
// ── Carrousel de la colonne droite : Agenda · Chat · Mail ──
let rbView = 0;
function rbSetView(i) {
  rbView = i;
  $("rbSlider").style.transform = `translateX(-${i * 100}%)`;
  $("rbTabs").querySelectorAll("span").forEach((s) => s.classList.toggle("active", +s.dataset.rv === i));
  if (i === 1) rbRenderChat();
  else if (i === 2) rbRenderMail();
}
$("rbTabs").onclick = (e) => { const t = e.target.closest("[data-rv]"); if (t) rbSetView(+t.dataset.rv); };
async function rbRenderChat() {
  const r = await window.olympus.chatList(0);
  const msgs = (r.ok ? r.messages : []).slice(-14);
  const f = $("rbChatFeed");
  f.innerHTML = msgs.length
    ? msgs.map((m) => `<div class="rb-cmsg${m.user_id === currentUserId ? " me" : ""}"><div class="a">${escapeHtml(m.author_name || "?")} · ${fmtTime(m.created_at)}</div><div class="b">${escapeHtml(m.body)}</div></div>`).join("")
    : '<div class="rb-empty">Aucun message — lance la conversation.</div>';
  f.scrollTop = f.scrollHeight;
}
$("rbChatInput").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const v = $("rbChatInput").value.trim(); if (!v) return;
  $("rbChatInput").value = "";
  await window.olympus.chatSend(v);
  rbRenderChat();
});
function rbRenderMail() {
  const unread = irMails.filter((m) => m.dir === "in" && m.unread && !m.trash).slice(0, 5);
  $("rbMailUnread").innerHTML = unread.length
    ? unread.map((m) => `<div class="rb-mrow" data-rbmail="${m.id}"><span class="dotg"></span><div style="flex:1;min-width:0;"><b>${escapeHtml(m.toName)}</b><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(m.subject)}</div></div></div>`).join("")
    : '<div class="rb-empty">✨ Boîte à zéro.</div>';
  $("rbMailLive").innerHTML = irEventFeed().slice(0, 4).map(({ m, e, ts }) => `<div class="rb-mrow" data-rbmail="${m.id}"><span style="filter:grayscale(1);font-size:11px;">${IR_EV_ICON[e.k]}</span><div style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><b>${escapeHtml(m.toName)}</b> ${IR_EV_VERB[e.k].split(" ")[0]} « ${escapeHtml(m.subject.slice(0, 22))}… »</div><span style="font-size:9.5px;color:var(--dim);flex-shrink:0;">${irAgo(ts)}</span></div>`).join("") || '<div class="rb-empty">Aucune activité.</div>';
}
$("rightbar").addEventListener("click", (e) => {
  const r = e.target.closest("[data-rbmail]"); if (!r) return;
  const m = irMails.find((x) => x.id === r.dataset.rbmail); if (!m) return;
  irFolder = m.dir === "in" ? "inbox" : "sent";
  goTo("iris");
  irMode(); renderIrFolders(); renderIrList(); renderIrDetail(m.id);
});

// ══════════ IRIS (mailing + tracking) ══════════
const IR_LBL = { sent: "Envoyé", open: "Ouvert", read: "Lu en entier", dl: "PJ téléchargée", click: "Lien cliqué" };
// Mails de démo — chaque action (ouverture, lecture, téléchargement, clic) est tracée avec son heure.
let irMails = [
  { id: "m1", cc: ["julie.marchand@maisonsolene.fr"], to: "claire@maisonsolene.fr", toName: "Claire Fontaine", client: "Maison Solène", by: "Sacha", when: "17 juil · 18:42", subject: "Devis campagne rentrée 2026", preview: "Comme convenu au téléphone, voici notre proposition pour la campagne…",
    body: "Bonjour Claire,\n\nComme convenu au téléphone, voici notre proposition pour la campagne de rentrée : 2 journées de shooting, 25 visuels retouchés et 3 formats vidéo pour les réseaux.\n\nLe devis détaillé est en pièce jointe. Je reste dispo pour en parler cette semaine.\n\nSacha — Orphic Agency",
    atts: [{ name: "devis_rentree_2026.pdf", size: "840 Ko", dl: 3 }, { name: "moodboard.pdf", size: "6,2 Mo", dl: 1 }],
    events: [{ k: "sent", w: "17 juil · 18:42" }, { k: "open", w: "17 juil · 19:05" }, { k: "read", w: "17 juil · 19:06", x: "2 min 10 de lecture" }, { k: "dl", w: "17 juil · 19:08", x: "devis_rentree_2026.pdf" }, { k: "open", w: "18 juil · 08:31" }, { k: "dl", w: "18 juil · 08:33", x: "devis_rentree_2026.pdf" }, { k: "dl", w: "18 juil · 08:34", x: "moodboard.pdf" }, { k: "click", w: "18 juil · 08:36", x: "orphic-agency.com/portfolio" }, { k: "dl", w: "18 juil · 09:02", x: "devis_rentree_2026.pdf" }, { k: "open", w: "18 juil · 09:02" }] },
  { id: "m2", to: "marc@villariviera.mc", toName: "Marc Aubert", client: "Villa Riviera", by: "Sacha", when: "17 juil · 11:20", subject: "Livraison — pack réseaux sociaux", preview: "Le pack complet est disponible : 18 visuels + 4 stories animées…",
    body: "Bonjour Marc,\n\nLe pack complet est disponible : 18 visuels + 4 stories animées, aux formats Instagram et LinkedIn.\n\nLien de téléchargement dans le mail. Bonne diffusion !\n\nSacha",
    atts: [{ name: "pack_reseaux_juillet.zip", size: "212 Mo", dl: 1 }],
    events: [{ k: "sent", w: "17 juil · 11:20" }, { k: "open", w: "17 juil · 11:52" }, { k: "dl", w: "17 juil · 11:54", x: "pack_reseaux_juillet.zip" }] },
  { id: "m3", to: "ines@solaris.fr", toName: "Inès Català", client: "Solaris", by: "Astrid Berges", when: "16 juil · 15:03", subject: "Sélection photos — validation", preview: "Voici la sélection resserrée de 40 images du shoot d'Èze…",
    body: "Bonjour Inès,\n\nVoici la sélection resserrée de 40 images du shoot d'Èze. On attend ta validation pour lancer la retouche fine.\n\nAstrid — Orphic Agency",
    atts: [{ name: "selection_solaris_v1.pdf", size: "18,4 Mo", dl: 0 }],
    events: [{ k: "sent", w: "16 juil · 15:03" }, { k: "open", w: "16 juil · 16:10" }, { k: "open", w: "17 juil · 09:15" }] },
  { id: "m4", to: "julie@emotions-arts.com", toName: "Julie Rey", client: "Émotions Arts", by: "Sacha", when: "15 juil · 20:15", subject: "Récap du shoot d'aujourd'hui", preview: "Merci pour l'accueil ! Le tournage s'est super bien passé…",
    body: "Bonjour Julie,\n\nMerci pour l'accueil ! Le tournage s'est super bien passé. Premier rendu prévu le 22 : teaser 30 s + 12 photos.\n\nÀ très vite,\nSacha",
    atts: [],
    events: [{ k: "sent", w: "15 juil · 20:15" }, { k: "open", w: "15 juil · 21:40" }, { k: "read", w: "15 juil · 21:41", x: "1 min 05 de lecture" }, { k: "open", w: "16 juil · 07:58" }] },
  { id: "m5", to: "contact@btp-azur.fr", toName: "Bureau BTP Azur", client: "BTP Azur", by: "Lucas Dubois", when: "15 juil · 09:30", subject: "Proposition — interview corporate", preview: "Suite à notre échange, voici le déroulé proposé pour l'interview…",
    body: "Bonjour,\n\nSuite à notre échange, voici le déroulé proposé pour l'interview corporate du 22 juillet : 2 h de tournage dans vos locaux, format final 90 s.\n\nLucas — Orphic Agency",
    atts: [{ name: "deroule_interview.pdf", size: "420 Ko", dl: 0 }],
    events: [{ k: "sent", w: "15 juil · 09:30" }] },
  { id: "m6", to: "nadia@atelier-n.fr", toName: "Nadia Belkacem", client: "Atelier N", by: "Sacha", when: "12 juil · 17:48", subject: "Relance — lookbook automne", preview: "Je me permets de relancer sur le devis lookbook envoyé la semaine…",
    body: "Bonjour Nadia,\n\nJe me permets de relancer sur le devis lookbook envoyé la semaine dernière. On peut caler un call cette semaine si tu veux en discuter.\n\nSacha",
    atts: [{ name: "devis_lookbook.pdf", size: "610 Ko", dl: 2 }],
    events: [{ k: "sent", w: "12 juil · 17:48" }, { k: "open", w: "13 juil · 08:20" }, { k: "dl", w: "13 juil · 08:22", x: "devis_lookbook.pdf" }, { k: "open", w: "16 juil · 14:05" }, { k: "dl", w: "16 juil · 14:06", x: "devis_lookbook.pdf" }, { k: "click", w: "16 juil · 14:09", x: "orphic-agency.com/lookbooks" }] },
];
// Tri façon Gmail : direction, drapeaux (favori, en attente, important…) et catégories des mails de démo.
const irMeta = (id, patch) => Object.assign(irMails.find((m) => m.id === id), patch);
irMeta("m1", { labels: ["Clients", "Devis"], star: true, important: true });
irMeta("m2", { labels: ["Clients"] });
irMeta("m3", { labels: ["Clients"], snooze: true });
irMeta("m5", { labels: ["Devis"], star: true });
irMeta("m6", { labels: ["Devis"], important: true });
irMails.push(
  { id: "r1", cc: ["julie.marchand@maisonsolene.fr"], dir: "in", unread: true, toName: "Claire Fontaine", to: "claire@maisonsolene.fr", client: "Maison Solène", by: "", when: "18 juil · 08:12", subject: "Re: Devis campagne rentrée 2026", preview: "Très belle proposition ! Deux questions sur les formats vidéo avant de signer…", body: "Bonjour Sacha,\n\nTrès belle proposition ! Deux questions sur les formats vidéo avant de signer :\n— peut-on ajouter un format 9:16 de 15 s ?\n— le droit d'usage couvre-t-il l'affichage en boutique ?\n\nBien à vous,\nClaire", atts: [], events: [], labels: ["Clients", "Devis"], important: true },
  { id: "r2", dir: "in", toName: "Marc Aubert", to: "marc@villariviera.mc", client: "Villa Riviera", by: "", when: "17 juil · 14:30", subject: "Re: Livraison — pack réseaux sociaux", preview: "Reçu, superbe travail. Le pack part en diffusion lundi…", body: "Bonjour,\n\nReçu, superbe travail. Le pack part en diffusion lundi.\n\nMarc", atts: [], events: [], labels: ["Clients"], star: true },
  { id: "r3", dir: "in", unread: true, toName: "Compta — Orphic", to: "compta@orphic-agency.com", client: "", by: "", when: "16 juil · 10:02", subject: "Factures juin à valider", preview: "Les 3 factures de juin sont prêtes pour validation…", body: "Les 3 factures de juin sont prêtes pour validation dans Atlas → Admin → Factures.", atts: [{ name: "recap_juin.pdf", size: "96 Ko", dl: 0 }], events: [], labels: ["Factures"], snooze: true },
  { id: "d1", draft: true, toName: "Nadia Belkacem", to: "nadia@atelier-n.fr", client: "Atelier N", by: "Sacha", when: "18 juil · 07:55", subject: "Proposition — shoot automne (brouillon)", preview: "Suite à ta réponse, voici ce qu'on peut caler en septembre…", body: "Bonjour Nadia,\n\nSuite à ta réponse, voici ce qu'on peut caler en septembre…\n\n[à terminer]", atts: [], events: [], labels: ["Devis"] },
  // Groupes imbriqués (ex. SBM › Marlow, 8 Limited)
  { id: "m7", cc: ["chef@marlow.mc"], to: "events@marlow.mc", toName: "Direction Marlow", client: "SBM — Marlow", by: "Sacha", when: "14 juil · 10:05", subject: "Shooting culinaire — nouvelle carte", preview: "Voici notre approche pour la nouvelle carte : lumière naturelle, 12 plats…", body: "Bonjour,\n\nVoici notre approche pour la nouvelle carte : lumière naturelle, 12 plats, 2 ambiances (comptoir + terrasse).\n\nProposition détaillée en PJ.\n\nSacha — Orphic Agency", atts: [{ name: "proposition_marlow.pdf", size: "1,1 Mo", dl: 1 }], events: [{ k: "sent", w: "14 juil · 10:05" }, { k: "open", w: "14 juil · 11:20" }, { k: "dl", w: "14 juil · 11:24", x: "proposition_marlow.pdf" }], labels: ["Clients/SBM/Marlow"] },
  { id: "r4", cc: ["chef@marlow.mc"], dir: "in", unread: true, toName: "Direction Marlow", to: "events@marlow.mc", client: "SBM — Marlow", by: "", when: "15 juil · 09:40", subject: "Re: Shooting culinaire — nouvelle carte", preview: "Merci, la proposition plaît beaucoup au chef. On vise la semaine 32…", body: "Bonjour Sacha,\n\nMerci, la proposition plaît beaucoup au chef. On vise la semaine 32 pour le shooting, avant le changement de carte.\n\nBien à vous", atts: [], events: [], labels: ["Clients/SBM/Marlow"], important: true },
  { id: "m8", to: "hello@8limited.com", toName: "8 Limited", client: "8 Limited", by: "Astrid Berges", when: "11 juil · 16:22", subject: "Récap call — identité visuelle", preview: "Comme discuté, on part sur 3 pistes créatives à présenter le 24…", body: "Bonjour,\n\nComme discuté, on part sur 3 pistes créatives à présenter le 24. Moodboards en cours côté DA.\n\nAstrid — Orphic Agency", atts: [], events: [{ k: "sent", w: "11 juil · 16:22" }, { k: "open", w: "11 juil · 18:03" }, { k: "read", w: "11 juil · 18:05", x: "1 min 30 de lecture" }], labels: ["Clients/8 Limited"] }
);
const IR_FOLDERS = [
  { id: "home", ic: "🏠", n: "Accueil", f: () => false },
  { id: "inbox", ic: "📥", n: "Boîte de réception", f: (m) => m.dir === "in" && !m.trash },
  { id: "unread", ic: "📩", n: "Non lus", f: (m) => m.dir === "in" && m.unread && !m.trash },
  { id: "star", ic: "⭐", n: "Favoris", f: (m) => m.star && !m.trash },
  { id: "snooze", ic: "⏳", n: "En attente", f: (m) => m.snooze && !m.trash },
  { id: "important", ic: "❗", n: "Importants", f: (m) => m.important && !m.trash },
  { id: "sent", ic: "📤", n: "Envoyés", f: (m) => m.dir !== "in" && !m.draft && !m.sched && !m.trash },
  { id: "draft", ic: "✏️", n: "Brouillons", f: (m) => m.draft && !m.trash },
  { id: "sched", ic: "🕐", n: "Programmés", f: (m) => m.sched && !m.trash },
  { id: "trash", ic: "🗑️", n: "Supprimés", f: (m) => m.trash },
];
// Les catégories sont des CHEMINS (« Clients/SBM/Marlow ») = libellés imbriqués Gmail → groupes de mails.
let irFolder = "home", irLabelsList = ["Clients", "Clients/SBM", "Clients/SBM/Marlow", "Clients/8 Limited", "Devis", "Factures", "Prestataires"], irLabelsReal = false;
let irOpen = new Set(["Clients", "Clients/SBM"]);           // groupes dépliés
const irLabelDot = (path) => { const P = ["#5b9bd5", "#45c4b0", "#a98bd6", "#e0a862", "#6cc48f", "#d98cb0", "#8a93de", "#e0885a"]; const root = path.split("/")[0]; let h = 0; for (const c of root) h = (h * 31 + c.charCodeAt(0)) >>> 0; return P[h % P.length]; };
const irLabelMatch = (m, p) => (m.labels || []).some((l) => l === p || l.startsWith(p + "/"));
const irInFolder = (m) => irFolder.startsWith("label:") ? irLabelMatch(m, irFolder.slice(6)) && !m.trash : (IR_FOLDERS.find((f) => f.id === irFolder) || IR_FOLDERS.find((f) => f.id === "sent")).f(m);
function irLabelTree() {
  const root = { children: {} };
  for (const p of irLabelsList) {
    let node = root, path = "";
    for (const seg of p.split("/")) {
      path = path ? path + "/" + seg : seg;
      node.children = node.children || {};
      node.children[seg] = node.children[seg] || { path, children: {} };
      node = node.children[seg];
    }
  }
  return root;
}
// Création de groupe « en place » : champ inséré dans l'arbre, au niveau du parent (＋ au survol d'une ligne).
let irNewParent = null;                                     // null = fermé · "" = racine · "Clients/SBM" = sous ce groupe
function irNewRow(parent, depth) {
  const ph = parent ? `Groupe dans ${parent.split("/").pop()}…` : "Nouvelle catégorie…";
  return `<div class="ir-newrow" style="padding-left:${10 + depth * 15}px"><span class="tw"></span><span class="ldot" style="background:${parent ? irLabelDot(parent) : "var(--line2)"}"></span><input id="irInlineNew" placeholder="${escapeHtml(ph)}" autocomplete="off" spellcheck="false"><span class="ir-newok" data-newok title="Créer">↵</span></div><div class="ir-newhint" style="padding-left:${10 + depth * 15 + 30}px">Entrée pour créer · aussi dans Gmail · Échap pour annuler</div>`;
}
function irLabelRows(node, depth = 0) {
  const dragM = irDragId ? irMails.find((x) => x.id === irDragId) : null;
  return Object.values(node.children || {}).sort((a, b) => a.path.localeCompare(b.path)).map((ch) => {
    const kids = Object.keys(ch.children || {}).length > 0;
    const open = irOpen.has(ch.path);
    const n = irMails.filter((m) => irLabelMatch(m, ch.path) && !m.trash).length;
    const tw = kids ? `<span class="tw" data-tw="${escapeHtml(ch.path)}">${open ? "▾" : "▸"}</span>` : `<span class="tw"></span>`;
    const door = dragM && (dragM.labels || []).includes(ch.path) ? `<span class="ir-exit" data-exit="${escapeHtml(ch.path)}" title="Sortir le mail de ce groupe">🚪</span>` : "";
    return `<div class="ir-folder${irFolder === "label:" + ch.path ? " active" : ""}" style="padding-left:${10 + depth * 15}px" data-fold="label:${escapeHtml(ch.path)}">${tw}<span class="ldot" style="background:${irLabelDot(ch.path)}"></span><span class="lname">${escapeHtml(ch.path.split("/").pop())}</span><span class="cnt">${n || ""}</span>${door}<span class="addg" data-addin="${escapeHtml(ch.path)}" title="Créer un groupe dans ${escapeHtml(ch.path.split("/").pop())}">＋</span></div>`
      + (irNewParent === ch.path ? irNewRow(ch.path, depth + 1) : "")
      + (kids && open ? irLabelRows(ch, depth + 1) : "");
  }).join("");
}
function renderIrFolders() {
  $("irFolders").innerHTML = IR_FOLDERS.map((f) => {
    const n = irMails.filter(f.f).length;
    return `<div class="ir-folder${irFolder === f.id ? " active" : ""}" data-fold="${f.id}"><span class="fic">${f.ic}</span>${f.n}<span class="cnt">${n || ""}</span></div>`;
  }).join("");
  $("irLabels").innerHTML = (irNewParent === "" ? irNewRow("", 0) : "") + irLabelRows(irLabelTree());
  $("irSyncNote").textContent = irLabelsReal
    ? "Catégories & groupes synchronisés avec Gmail (libellés imbriqués) — créés ici, ils apparaissent dans Gmail, et inversement."
    : "Démo — connecte Gmail (profil) pour synchroniser catégories & groupes dans les deux sens.";
  irFillCatGhosts();
  const inp = $("irInlineNew");
  if (inp) {
    inp.focus();
    inp.onkeydown = (e) => {
      if (e.key === "Escape") { irNewParent = null; renderIrFolders(); }
      else if (e.key === "Enter") irCreateGroup(inp.value);
    };
  }
}
async function irCreateGroup(raw) {
  const name = String(raw || "").trim().replace(/\//g, "-");
  if (!name) { irNewParent = null; renderIrFolders(); return; }
  const path = irNewParent ? irNewParent + "/" + name : name;
  const inp = $("irInlineNew"); if (inp) inp.disabled = true;
  const r = await window.olympus.irisCreateLabel(path);
  if (r.ok) { atToast("✅ « " + path.replace(/\//g, " › ") + " » créé — aussi dans Gmail."); await irLoadLabels(); }
  else { if (!irLabelsList.includes(path)) irLabelsList.push(path); atToast("Groupe ajouté (démo — Gmail non connecté)."); }
  let acc = ""; for (const seg of path.split("/").slice(0, -1)) { acc = acc ? acc + "/" + seg : seg; irOpen.add(acc); } // déplie les parents
  irNewParent = null;
  renderIrFolders();
}
// Comble la colonne des catégories jusqu'en bas avec des lignes fantômes (le fondu mange la dernière).
function irFillCatGhosts() {
  const box = $("irLabelGhosts"), sc = document.querySelector("#page-iris .ir-sidescroll");
  if (!box) return;
  box.innerHTML = "";
  if (!sc || !sc.clientHeight) return;                     // page masquée → rien à mesurer
  const limit = sc.getBoundingClientRect().bottom + 24;
  const widths = [64, 46, 70, 52, 60, 42, 66, 55];         // largeurs variées, comme de vrais noms
  for (let i = 0; i < 20 && box.getBoundingClientRect().bottom <= limit; i++) {
    const op = Math.max(0.16, 0.5 - i * 0.045).toFixed(2); // s'évanouit progressivement vers le bas
    box.insertAdjacentHTML("beforeend", `<div class="ir-ghostrow" style="opacity:${op}"><span class="gdot"></span><i style="width:${widths[i % widths.length]}%"></i></div>`);
  }
}
async function irLoadLabels() {
  if (!irAccObj().real) return;                            // la synchro Gmail ne concerne que la boîte connectée
  const r = await window.olympus.irisLabels();
  if (r.ok) { irLabelsReal = true; irLabelsList = [...new Set([...r.labels, ...irLabelsList])]; }
  renderIrFolders();
}
// ── Alertes en direct : les derniers événements de suivi, façon notifications ──
const IR_EV_ICON = { open: "📬", read: "📖", dl: "📎", click: "🔗" };
const IR_EV_VERB = { open: "a ouvert", read: "a lu", dl: "a téléchargé une PJ de", click: "a cliqué un lien de" };
const irAgo = (ts) => { const d = Date.now() - ts; if (d < 90e3) return "à l'instant"; if (d < 3600e3) return "il y a " + Math.round(d / 60e3) + " min"; if (d < 86400e3) return "il y a " + Math.round(d / 3600e3) + " h"; return "il y a " + Math.round(d / 86400e3) + " j"; };
function irEventFeed() {
  const evs = [];
  for (const m of irMails) if (m.dir !== "in" && !m.draft && !m.trash) for (const e of m.events) if (e.k !== "sent") evs.push({ m, e, ts: irWhenTs(e.w) });
  return evs.sort((a, b) => b.ts - a.ts).slice(0, 5);
}
// Simulation démo : de temps en temps, un destinataire « ouvre » un mail → alerte + flux mis à jour.
let irSimTimer = null;
function irStartSim() {
  if (irSimTimer) return;
  irSimTimer = setInterval(() => {
    if (!document.querySelector("#page-iris.show")) return;
    const outs = irMails.filter((m) => m.dir !== "in" && !m.draft && !m.trash && m.events.length);
    if (!outs.length) return;
    const m = outs[Math.floor(Math.random() * outs.length)];
    let k = ["open", "open", "read", "dl"][Math.floor(Math.random() * 4)];
    if (k === "dl" && !m.atts.length) k = "open";
    const now = new Date();
    const w = now.getDate() + " " + MON_ABBR[now.getMonth()] + " · " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    m.events.push({ k, w, x: k === "dl" ? m.atts[0].name : k === "read" ? "1 min de lecture" : undefined });
    if (k === "dl" && m.atts[0]) m.atts[0].dl = (m.atts[0].dl || 0) + 1;
    atToast(`${IR_EV_ICON[k]} ${m.toName} ${k === "open" ? "vient d'ouvrir" : k === "read" ? "vient de lire" : "vient de télécharger une PJ de"} « ${m.subject.slice(0, 38)} »`);
    if (irFolder === "home" && $("irHome").style.display !== "none") renderIrHome();
    else { renderIrStats(); renderIrList(); if (irSel === m.id) renderIrDetail(m.id); }
  }, 45000);
}
// ── Accueil Iris : l'état du profil mail en un coup d'œil ──
function irMode() {
  const home = irFolder === "home";
  $("irStats").style.display = home ? "none" : "";
  document.querySelector("#page-iris .ir-toolbar").style.display = home ? "none" : "";
  document.querySelector("#page-iris .ir-split").style.display = home ? "none" : "";
  $("irHome").style.display = home ? "" : "none";
  if (home) renderIrHome();
}
function irRing(pct, label) {
  const r = 48, c = (2 * Math.PI * r).toFixed(1), off = (c * (1 - pct / 100)).toFixed(1);
  return `<div class="ir-ring"><svg width="116" height="116" viewBox="0 0 116 116"><circle cx="58" cy="58" r="${r}" class="bg"/><circle cx="58" cy="58" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 58 58)"/><text x="58" y="55" class="v">${pct}%</text><text x="58" y="74" class="t">${label}</text></svg></div>`;
}
function renderIrHome() {
  const outs = irMails.filter((m) => m.dir !== "in" && !m.draft && !m.sched && !m.trash);
  const ins = irMails.filter((m) => m.dir === "in" && !m.trash);
  const replied = (m) => irThreadOf(m).some((x) => x.dir === "in" && irWhenTs(x.when) > irWhenTs(m.when));
  const openRate = outs.length ? Math.round(outs.filter((m) => irCount(m, "open") > 0).length / outs.length * 100) : 0;
  const replyRate = outs.length ? Math.round(outs.filter(replied).length / outs.length * 100) : 0;
  const dls = outs.reduce((s, m) => s + irCount(m, "dl"), 0);
  const snoozed = irMails.filter((m) => m.snooze && !m.trash).length;
  // Activité de la semaine (lun 13 → dim 19)
  const dayNum = (w) => { const t = irWhenTs(w); return t ? new Date(t).getDate() : 0; };
  const days = [13, 14, 15, 16, 17, 18, 19].map((d, i) => ({ l: DOW[i], d, out: outs.filter((m) => dayNum(m.when) === d).length, inn: ins.filter((m) => dayNum(m.when) === d).length }));
  const mx = Math.max(1, ...days.map((x) => Math.max(x.out, x.inn)));
  const week = days.map((x) => `<div class="ir-day"><div class="bars"><i class="out" style="height:${Math.max(3, x.out / mx * 100)}%" title="${x.out} envoyé(s)"></i><i class="inn" style="height:${Math.max(3, x.inn / mx * 100)}%" title="${x.inn} reçu(s)"></i></div><span>${x.l}</span></div>`).join("");
  // Groupes les plus actifs
  const roots = [...new Set(irLabelsList.map((p) => p.split("/")[0]))];
  const gcounts = roots.map((g) => ({ g, n: irMails.filter((m) => irLabelMatch(m, g) && !m.trash).length })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 5);
  const gmx = Math.max(1, ...gcounts.map((x) => x.n));
  let groups = gcounts.map((x) => `<div class="ir-gb"><span class="ldot" style="background:${irLabelDot(x.g)}"></span><span class="name">${escapeHtml(x.g)}</span><div class="track"><i style="width:${x.n / gmx * 100}%;background:${irLabelDot(x.g)}"></i></div><span class="n">${x.n}</span></div>`).join("");
  // À relancer : envoyés sans réponse
  const now = Date.now();
  const relAll = outs.filter((m) => !replied(m)).map((m) => ({ m, days: Math.max(0, Math.round((now - irWhenTs(m.when)) / 864e5)), o: irCount(m, "open") })).sort((a, b) => b.days - a.days);
  const rel = relAll.slice(0, 8);
  let relances = rel.length ? rel.map(({ m, days: dd, o }) => `<div class="ir-rel" data-goto="${m.id}"><div class="ir-av" style="width:30px;height:30px;font-size:10.5px;">${initialsOf(m.toName)}</div><div class="ir-tmain"><div class="ir-twho">${escapeHtml(m.toName)}</div><div class="ir-tsnip">${escapeHtml(m.subject)}</div></div><span class="ir-b${o ? " on" : ""}">${o ? "ouvert ×" + o + " · sans réponse" : "jamais ouvert"} · ${dd} j</span></div>`).join("") : '<div class="rb-empty" style="padding:14px 2px;">Rien à relancer — tout le monde a répondu 🎉</div>';
  const me = ($("accName").textContent || "").split(" ")[0] || "toi";
  const unreadN = ins.filter((m) => m.unread).length;       // nouveaux mails non lus
  $("irHome").innerHTML = `
    <div class="ir-hgreet">Bonjour ${escapeHtml(me)} — voilà où en sont tes mails.</div>
    <div class="ir-hero2">
      ${irRing(openRate, "d'ouverture")}
      ${irRing(replyRate, "de réponse")}
      <div class="ir-newmails">
        <div class="ir-newcount" data-fold-go="unread" title="Ouvrir les non lus">
          <div class="n">${unreadN}</div>
          <div class="l">nouveau${unreadN > 1 ? "x" : ""} mail${unreadN > 1 ? "s" : ""} non lu${unreadN > 1 ? "s" : ""}</div>
        </div>
        <div class="ir-newlist">
          ${ins.filter((m) => m.unread).sort((a, b) => irWhenTs(b.when) - irWhenTs(a.when)).slice(0, 3).map((m) => `<div class="ir-new" data-goto="${m.id}"><span class="dotg"></span><div class="t"><b>${escapeHtml(m.toName)}</b>${escapeHtml(m.subject)}</div><span class="w">${m.when}</span></div>`).join("") || '<div class="ir-newzero">✨ Boîte à zéro — aucun nouveau mail.</div>'}
          ${unreadN > 3 ? `<div class="ir-newmore" data-fold-go="unread">＋ ${unreadN - 3} autre${unreadN - 3 > 1 ? "s" : ""} non lu${unreadN - 3 > 1 ? "s" : ""}…</div>` : ""}
        </div>
      </div>
      <div class="ir-hkpis">
        <div class="ir-stat"><div class="n">${outs.length}</div><div class="l">envoyés cette semaine</div></div>
        <div class="ir-stat"><div class="n">${ins.length}</div><div class="l">réponses reçues</div></div>
        <div class="ir-stat"><div class="n">${relAll.length}</div><div class="l">sans réponse</div></div>
        <div class="ir-stat"><div class="n">${dls}</div><div class="l">PJ téléchargées</div></div>
        <div class="ir-stat"><div class="n">${snoozed}</div><div class="l">en attente</div></div>
      </div>
    </div>
    <div class="ir-hgrid">
      <div>
        <div class="ir-sect">Activité de la semaine</div>
        <div class="ir-week">${week}</div>
        <div class="ir-wleg"><span><i class="out"></i>envoyés</span><span><i class="inn"></i>reçus</span></div>
      </div>
      <div class="ir-alerts">
        <div class="ir-sect" style="margin-bottom:6px;">En direct<span class="ir-livedot"></span></div>
        ${irEventFeed().map(({ m, e, ts }, i) => `<div class="ir-alert${i === 0 ? " live" : ""}" data-goto="${m.id}"><span class="ic">${IR_EV_ICON[e.k]}</span><div class="t"><b>${escapeHtml(m.toName)}</b> ${IR_EV_VERB[e.k]} « ${escapeHtml(m.subject.slice(0, 34))} »</div><span class="w">${irAgo(ts)}</span></div>`).join("") || '<div class="rb-empty" style="padding:10px 0;">Aucune activité pour l\'instant.</div>'}
      </div>
      <div>
        <div class="ir-sect">Groupes les plus actifs</div><div data-gwrap>${groups}</div>
      </div>
      <div>
        <div class="ir-sect">À relancer</div>
        <div data-rwrap>${relances}</div>
      </div>
    </div>`;
  irFillGhosts();
  // MATÉRIALISER — les compteurs de l'Accueil se comptent à la première ouverture
  if (!renderIrHome._counted) { renderIrHome._counted = true; mCountUp($("irHome"), ".ir-stat .n"); }
}
// Comble les deux colonnes jusqu'au bas de la fenêtre avec des lignes fantômes (mesuré, pas estimé).
function irFillGhosts() {
  const home = $("irHome");
  const limit = home.getBoundingClientRect().bottom + 30;   // on dépasse le bord : le fondu du bas mange la dernière ligne
  const gw = home.querySelector("[data-gwrap]"), rw = home.querySelector("[data-rwrap]");
  const GG = '<div class="ir-gb ghost"><span class="ldot"></span><span class="name">—</span><div class="track"></div><span class="n"></span></div>';
  const GR = '<div class="ir-rel ghost"><div class="ir-av gav"></div><div class="ir-tmain"><div class="gline w1"></div><div class="gline w2"></div></div></div>';
  for (let i = 0; i < 30 && gw.getBoundingClientRect().bottom <= limit; i++) gw.insertAdjacentHTML("beforeend", GG);
  for (let i = 0; i < 30 && rw.getBoundingClientRect().bottom <= limit; i++) rw.insertAdjacentHTML("beforeend", GR);
}
window.addEventListener("resize", () => {
  if (!document.querySelector("#page-iris.show")) return;
  renderIrFolders();
  if (irFolder === "home" && $("irHome").style.display !== "none") renderIrHome();
  else renderIrList();
});
$("irHome").addEventListener("click", (e) => {
  const fg = e.target.closest("[data-fold-go]");
  if (fg) { irFolder = fg.dataset.foldGo; irMode(); renderIrFolders(); renderIrList(); return; }
  const g = e.target.closest("[data-goto]"); if (!g) return;
  const gm = irMails.find((x) => x.id === g.dataset.goto);
  irFolder = gm && gm.dir === "in" ? "inbox" : "sent";
  irMode(); renderIrFolders(); renderIrList(); renderIrDetail(g.dataset.goto);
});
// Classement automatique : une adresse ↔ un groupe. Le mail arrive pré-rangé, on peut finir à la main.
let irRules = [];
try { irRules = JSON.parse(localStorage.getItem("iris-rules:sacha") || localStorage.getItem("iris-rules")) || []; } catch { irRules = []; }
if (!localStorage.getItem("iris-rules:sacha") && !localStorage.getItem("iris-rules")) irRules = [{ addr: "events@marlow.mc", label: "Clients/SBM/Marlow" }];
const irRulesSave = () => localStorage.setItem("iris-rules:" + irAcc, JSON.stringify(irRules));
const irRuleFor = (addr) => irRules.find((r) => r.addr.toLowerCase() === String(addr || "").toLowerCase());
function irApplyRules() {
  for (const m of irMails) {
    const r = irRuleFor(m.to);
    if (r) { m.labels = m.labels || []; if (!m.labels.includes(r.label)) m.labels.push(r.label); }
  }
}
// Retire un mail d'un groupe ; si une règle auto l'y re-classerait, on retire la règle aussi (sinon il reviendrait).
function irRemoveLabel(m, p) {
  m.labels = (m.labels || []).filter((l) => l !== p);
  const r = irRuleFor(m.to);
  if (r && r.label === p) { irRules = irRules.filter((x) => x !== r); irRulesSave(); return true; }
  return false;
}
// Fil de discussion : mails groupés par interlocuteur + sujet normalisé (sans les « Re: / Tr: »).
irMails.push({ id: "r0", cc: ["julie.marchand@maisonsolene.fr"], dir: "in", toName: "Claire Fontaine", to: "claire@maisonsolene.fr", client: "Maison Solène", by: "", when: "16 juil · 11:05", subject: "Devis campagne rentrée 2026", preview: "Suite à notre appel, pouvez-vous me chiffrer la campagne de rentrée ?", body: "Bonjour Sacha,\n\nSuite à notre appel, pouvez-vous me chiffrer la campagne de rentrée ? Idéalement shooting + vidéos réseaux, avec une livraison mi-août.\n\nMerci !\nClaire", atts: [], events: [], labels: ["Clients", "Devis"] });
const irNormSubj = (s) => String(s || "").replace(/^((re|tr|fwd?)\s*:\s*)+/i, "").trim().toLowerCase();
const irThreadKey = (m) => String(m.to || "").toLowerCase() + "|" + irNormSubj(m.subject);
const IR_MONTHS = { janv: 0, févr: 1, mars: 2, avr: 3, mai: 4, juin: 5, juil: 6, août: 7, sept: 8, oct: 9, nov: 10, déc: 11 };
function irWhenTs(w) {                                      // "17 juil · 18:42" → timestamp (tri chronologique)
  const m = /^(\d{1,2})\s+(\S+?)\.?\s*·\s*(\d{2}):(\d{2})/.exec(String(w || ""));
  if (!m) return 0;
  return new Date(2026, IR_MONTHS[m[2].replace(".", "")] ?? 0, +m[1], +m[3], +m[4]).getTime();
}
const irThreadOf = (m) => irMails.filter((x) => irThreadKey(x) === irThreadKey(m) && (!x.trash || x.id === m.id)).sort((a, b) => irWhenTs(a.when) - irWhenTs(b.when));
let irThreadOpen = new Set();
let irThreadStackOpen = false;                              // la pile de messages précédents est-elle dépliée ?
// ══ Boîtes mail multiples : chaque boîte garde ses mails, ses catégories et ses règles — aucun mélange. ══
const IR_ACCOUNTS = [
  { id: "sacha", email: "sacha@orphic-agency.com", label: "Boîte personnelle", real: true },
  { id: "agence", email: "hello@orphic-agency.com", label: "Boîte agence · partagée", real: false },
];
let irAcc = "sacha";
const irStore = {
  agence: {
    labelsReal: false,
    labels: ["Prospects", "Presse", "Clients"],
    rules: (() => { try { return JSON.parse(localStorage.getItem("iris-rules:agence")) || []; } catch { return []; } })(),
    mails: [
      { id: "a1", dir: "in", unread: true, toName: "Léa Morin", to: "lea.morin@gmail.com", client: "", by: "", when: "18 juil · 09:20", subject: "Demande de devis — mariage septembre", preview: "Bonjour, nous cherchons un photographe pour notre mariage le 12 septembre à Èze…", body: "Bonjour,\n\nNous cherchons un photographe pour notre mariage le 12 septembre à Èze (90 invités, cérémonie en extérieur).\n\nPouvez-vous nous envoyer vos formules ?\n\nLéa Morin", atts: [], events: [], labels: ["Prospects"] },
      { id: "a2", dir: "in", unread: true, toName: "Nice-Matin", to: "redaction@nicematin.fr", client: "", by: "", when: "17 juil · 16:40", subject: "Interview — portrait d'agence", preview: "Nous préparons un dossier sur les agences créatives de la Côte d'Azur…", body: "Bonjour,\n\nNous préparons un dossier sur les agences créatives de la Côte d'Azur et aimerions vous interviewer.\n\nSeriez-vous disponibles la semaine prochaine ?\n\nLa rédaction", atts: [], events: [], labels: ["Presse"] },
      { id: "a3", toName: "Léa Morin", to: "lea.morin@gmail.com", client: "", by: "Astrid Berges", when: "18 juil · 10:02", subject: "Re: Demande de devis — mariage septembre", preview: "Merci pour votre message ! Voici notre brochure mariage et nos trois formules…", body: "Bonjour Léa,\n\nMerci pour votre message ! Voici notre brochure mariage et nos trois formules. Le 12 septembre est encore libre.\n\nAstrid — Orphic Agency", atts: [{ name: "brochure_mariage.pdf", size: "4,2 Mo", dl: 1 }], events: [{ k: "sent", w: "18 juil · 10:02" }, { k: "open", w: "18 juil · 11:12" }, { k: "dl", w: "18 juil · 11:15", x: "brochure_mariage.pdf" }], labels: ["Prospects"] },
    ],
  },
};
const irAccObj = () => IR_ACCOUNTS.find((a) => a.id === irAcc);
const irAccInitials = (email) => initialsOf(email.split("@")[0].replace(/[._-]/g, " "));
function irSwitchAccount(id) {
  if (id === irAcc || (!irStore[id] && !IR_ACCOUNTS.some((a) => a.id === id))) return;
  irStore[irAcc] = { mails: irMails, labels: irLabelsList, rules: irRules, labelsReal: irLabelsReal };
  irAcc = id;
  const s = irStore[id];
  irMails = s.mails; irLabelsList = s.labels; irRules = s.rules; irLabelsReal = s.labelsReal;
  irSel = null; irThreadOpen = new Set(); irFolder = "home"; irNewParent = null; irFilter = "all";
  document.querySelector("#page-iris .ir-split").classList.remove("reader"); document.querySelector("#page-iris .ir-split").classList.add("full");
  $("irDetail").innerHTML = '<div class="rb-empty" style="padding:60px 20px;text-align:center;">Sélectionne un mail pour voir son suivi.</div>';
  renderIrAcct(); refreshIris();
  atToast("Boîte active : " + irAccObj().email);
}
function renderIrAcct() {
  const a = irAccObj();
  $("irAcctAv").textContent = irAccInitials(a.email);
  $("irAcctEmail").textContent = a.email;
  $("irAcctLabel").textContent = a.label;
  $("irAcctMenu").innerHTML = IR_ACCOUNTS.map((x) => {
    const mails = x.id === irAcc ? irMails : (irStore[x.id] || {}).mails || [];
    const un = mails.filter((m) => m.dir === "in" && m.unread && !m.trash).length;
    return `<div class="ir-arow${x.id === irAcc ? " active" : ""}" data-acct="${x.id}"><div class="ir-aav sm">${irAccInitials(x.email)}</div><div class="ir-ainfo"><div class="nm">${x.email}</div><div class="sub">${x.label}</div></div>${x.id === irAcc ? '<span class="chk">✓</span>' : un ? `<span class="hm-unread">${un}</span>` : ""}</div>`;
  }).join("") + `<div class="ir-arow add" data-acct-add><div class="ir-aav sm dash">＋</div><div class="ir-ainfo"><div class="nm">Connecter une boîte…</div><div class="sub">Gmail · mot de passe d'application</div></div></div>`;
}
$("irAcctCur").onclick = () => { const m = $("irAcctMenu"); m.style.display = m.style.display === "none" ? "" : "none"; if (m.style.display === "") renderIrAcct(); };
$("irAcctMenu").onclick = (e) => {
  if (e.target.closest("[data-acct-add]")) { $("irAcctMenu").style.display = "none"; $("profileCard").click(); atToast("Connecte la nouvelle boîte dans Comptes & connexions."); return; }
  const r = e.target.closest("[data-acct]"); if (!r) return;
  $("irAcctMenu").style.display = "none";
  irSwitchAccount(r.dataset.acct);
};
document.addEventListener("click", (e) => { if (!e.target.closest("#irAcct")) $("irAcctMenu").style.display = "none"; });
let irFilter = "all", irSel = null, irAtts = [];
const irCount = (m, k) => m.events.filter((e) => e.k === k).length;
function renderIrStats() {
  const out = irMails.filter((m) => m.dir !== "in" && !m.draft && !m.sched && !m.trash);
  const sent = out.length;
  const opened = out.filter((m) => irCount(m, "open") > 0).length;
  const rate = sent ? Math.round(opened / sent * 100) : 0;
  const dls = out.reduce((s, m) => s + irCount(m, "dl"), 0);
  const reads = out.reduce((s, m) => s + irCount(m, "read"), 0);
  $("irStats").innerHTML = [[sent, "envoyés"], [rate + "%", "taux d'ouverture"], [reads, "lectures complètes"], [dls, "PJ téléchargées"]]
    .map(([n, l]) => `<div class="ir-stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
}
function irBadges(m) {
  if (m.trash) return `<span class="ir-b">Supprimé</span>`;
  if (m.sched) return `<span class="ir-b on">🕐 ${m.sched}</span>`;
  if (m.dir === "in" || m.draft) return `<span class="ir-b">${m.draft ? "Brouillon" : "Reçu"}</span>`;
  const o = irCount(m, "open"), r = irCount(m, "read"), d = irCount(m, "dl"), c = irCount(m, "click");
  return `<span class="ir-b${o ? " on" : ""}">${o ? "Ouvert ×" + o : "Non ouvert"}</span>` +
    (r ? `<span class="ir-b on">Lu</span>` : "") + (d ? `<span class="ir-b on">PJ ×${d}</span>` : "") + (c ? `<span class="ir-b on">Clic ×${c}</span>` : "");
}
function renderIrList() {
  const q = ($("irSearch").value || "").toLowerCase();
  const list = irMails.filter((m) => {
    if (!irInFolder(m)) return false;
    if (q && ![m.toName, m.to, m.client, m.subject].join(" ").toLowerCase().includes(q)) return false;
    if (irFilter === "opened") return irCount(m, "open") > 0;
    if (irFilter === "unopened") return irCount(m, "open") === 0;
    if (irFilter === "attach") return irCount(m, "dl") > 0;
    return true;
  });
  $("irList").innerHTML = list.length ? list.map((m) => {
    const dots = (m.labels || []).map((l) => `<span class="ldot" style="background:${irLabelDot(l)}" title="${escapeHtml(l.replace(/\//g, " › "))}"></span>`).join("");
    return `
    <div class="ir-row${irSel === m.id ? " active" : ""}${m.unread ? " unread" : ""}" data-mail="${m.id}" draggable="true">
      <div class="ir-av">${initialsOf(m.toName)}</div>
      <div class="ir-main">
        <div class="ir-name">${escapeHtml(m.toName)}${irThreadOf(m).length > 1 ? `<span class="cl">(${irThreadOf(m).length})</span>` : ""}<span class="cl">${escapeHtml(m.client || "")}</span></div>
        <div class="ir-sub">${dots}${escapeHtml(m.subject)}</div>
        <div class="ir-prev">${escapeHtml(m.preview || "")}</div>
      </div>
      <div class="ir-meta"><span class="ir-when">${m.when}</span><div class="ir-badges">${irBadges(m)}</div></div>
      <span class="ir-exp" data-expand="${m.id}" title="Ouvrir en grand">⤢</span>
    </div>`;
  }).join("") : '<div class="rb-empty" style="padding:30px 10px;">Aucun mail ne correspond.</div>';
  irFillListGhosts();
}
// Comble la liste de mails jusqu'en bas avec des lignes fantômes (dépassent le bord, le fondu les mange).
function irFillListGhosts() {
  const el = $("irList");
  if (!el || !el.clientHeight) return;                     // page masquée → rien à mesurer
  const limit = el.getBoundingClientRect().bottom + 30;
  const G = '<div class="ir-row ghost"><div class="ir-av gav"></div><div class="ir-main"><div class="gline w1"></div><div class="gline" style="width:58%;"></div></div></div>';
  for (let i = 0; i < 30 && el.lastElementChild && el.lastElementChild.getBoundingClientRect().bottom <= limit; i++) el.insertAdjacentHTML("beforeend", G);
}
function renderIrDetail(id) {
  const m = irMails.find((x) => x.id === id); if (!m) return;
  if (irSel !== id) { irThreadOpen = new Set([id]); irThreadStackOpen = false; }   // le message cliqué est déplié, les précédents repliés
  irSel = id;
  if (m.unread) { m.unread = false; renderIrFolders(); }    // l'ouvrir le marque comme lu
  const tracked = m.dir !== "in" && !m.draft && !m.sched;
  const kpi = [[irCount(m, "open"), "ouvertures"], [irCount(m, "read"), "lectures"], [irCount(m, "dl"), "PJ téléchargées"], [irCount(m, "click"), "clics"]]
    .map(([n, l]) => `<div class="ir-kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
  const tl = m.events.slice().reverse().map((e) => `<div class="ir-tli${e.k !== "sent" ? " hot" : ""}"><div class="k">${IR_LBL[e.k]}${e.x ? ` — <span style="color:var(--muted)">${escapeHtml(e.x)}</span>` : ""}</div><div class="w">${e.w}</div></div>`).join("");
  const meta = m.dir === "in"
    ? `De ${escapeHtml(m.toName)} &lt;${escapeHtml(m.to)}&gt;${m.client ? " · " + escapeHtml(m.client) : ""} · reçu le ${m.when}`
    : `À ${escapeHtml(m.toName)} &lt;${escapeHtml(m.to)}&gt;${m.client ? " · " + escapeHtml(m.client) : ""}${m.by ? " · envoyé par " + escapeHtml(m.by) : ""} · ${m.when}`;
  const rule = irRuleFor(m.to);
  const allPaths = irLabelsList.slice().sort();
  const chips = (m.labels || []).map((l) => `<span class="ir-lchip"><span class="ldot" style="background:${irLabelDot(l)}"></span>${escapeHtml(l.replace(/\//g, " › "))}<span class="x" data-rmlbl="${escapeHtml(l)}" title="Retirer de ce groupe">✕</span></span>`).join("");
  const addOpts = allPaths.filter((p) => !(m.labels || []).includes(p)).map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p.replace(/\//g, " › "))}</option>`).join("");
  const autoLine = rule
    ? `<span class="ir-autoon">⚡ Les mails de ${escapeHtml(m.to)} se rangent dans <b>${escapeHtml(rule.label.replace(/\//g, " › "))}</b></span><span class="link" data-rmrule style="font-size:11px;">retirer</span>`
    : `<select class="mn-evsel" id="irAutoSel"><option value="">⚡ Toujours classer ${escapeHtml(m.to)} dans…</option>${allPaths.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p.replace(/\//g, " › "))}</option>`).join("")}</select>`;
  const thread = irThreadOf(m);
  const hidden = thread.filter((t) => !(irThreadOpen.has(t.id) || thread.length === 1));
  let stackDone = false;
  const tItem = (t) => {
    const who = t.dir === "in" ? t.toName : (t.by || "Moi");
    const open = irThreadOpen.has(t.id) || thread.length === 1;
    if (!open && !irThreadStackOpen && hidden.length > 1) {   // pile repliée : une seule ligne pour tous les messages masqués
      if (stackDone) return "";
      stackDone = true;
      return `<div class="ir-tstack" data-tstack>▸ ${hidden.length} messages masqués<span class="w">du ${hidden[0].when.split(" · ")[0]} au ${hidden[hidden.length - 1].when.split(" · ")[0]}</span></div>`;
    }
    if (!open) {
      const snip = (t.body || "").replace(/\s+/g, " ").slice(0, 90);
      return `<div class="ir-titem col slim" data-texp="${t.id}"><span class="cwho">${escapeHtml(who)}</span><span class="csnip">${escapeHtml(snip)}…</span><span class="ir-twhen">${t.when}</span></div>`;
    }
    const tAtts = (t.atts || []).map((a) => `<div class="ir-att" style="margin-left:39px;"><span>📎</span><span>${escapeHtml(a.name)}</span><span style="color:var(--dim);font-size:11px;">${a.size}</span>${t.dir !== "in" && !t.draft ? `<span class="cnt${a.dl ? " hot" : ""}">${a.dl ? "téléchargée ×" + a.dl : "jamais téléchargée"}</span>` : ""}</div>`).join("");
    return `<div class="ir-titem exp${t.id === id ? " sel" : ""}"><div class="ir-thead"${t.id === id ? "" : ` data-texp="${t.id}"`}><div class="ir-tav">${initialsOf(who)}</div><div class="ir-tmain"><div class="ir-twho">${escapeHtml(who)}${t.dir === "in" ? "" : ` <span style="color:var(--dim);font-weight:400;">→ ${escapeHtml(t.toName)}</span>`}</div><div class="ir-tsnip">${t.dir === "in" ? "reçu" : t.draft ? "brouillon" : "envoyé"}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;"><span class="ir-twhen">${t.when}</span><div class="ir-badges">${irBadges(t)}</div></div></div><div class="ir-tbody">${escapeHtml(t.body || "")}</div>${tAtts}</div>`;
  };
  const foldable = thread.length > 1 && (irThreadStackOpen || [...irThreadOpen].some((x) => x !== id));
  const threadHtml = (foldable ? `<div class="ir-tfold" data-tfold title="Revenir à la vue compacte">⌃ Tout replier</div>` : "") + thread.map(tItem).join("");
  $("irDetail").innerHTML = `
    <div class="ir-dtop">
      <div class="ir-dsubj">${escapeHtml(m.subject)}${thread.length > 1 ? ` <span style="font-size:13px;color:var(--dim);font-weight:400;">· ${thread.length} messages</span>` : ""}</div>
      <div class="ir-replygrp">${document.querySelector("#page-iris .ir-split").classList.contains("reader") ? `<button class="ir-replysm" id="irReaderBack" title="Réduire — revenir à la liste">⤡</button>` : ""}${m.draft ? "" : `<button class="ir-replysm" id="irReplySm" title="Répondre">↩</button>${(m.cc || []).length ? `<button class="ir-replysm all" id="irReplyAllSm" title="Répondre à tous (${m.cc.length + 1} destinataires)">↩ tous</button>` : ""}`}${m.trash ? "" : `<button class="ir-replysm trash" id="irTrashBtn" title="Supprimer le mail">🗑️</button>`}</div>
    </div>
    <div class="ir-dmeta">${meta}${(m.cc || []).length ? ` · <span style="color:var(--dim);">cc ${m.cc.map(escapeHtml).join(", ")}</span>` : ""}</div>
    <div class="ir-hgroups"><div class="ir-glist">${chips}<select class="mn-evsel" id="irAddLbl"><option value="">＋ Ajouter à un groupe…</option>${addOpts}</select></div><div class="ir-auto">${autoLine}</div></div>
    ${m.trash ? `<div class="ir-auto"><span class="ir-autoon" style="color:var(--err);">🗑️ Ce mail est dans Supprimés</span><span class="link" data-restore style="font-size:11px;">Restaurer</span><span class="link" data-purge style="font-size:11px;color:var(--err);">Supprimer définitivement</span></div>` : ""}
    ${m.sched && !m.trash ? `<div class="ir-auto"><span class="ir-autoon">🕐 Envoi programmé — <b>${m.sched}</b></span><span class="link" data-unsched style="font-size:11px;">Annuler la programmation</span></div>` : ""}
    ${tracked ? `<div class="ir-kpis">${kpi}</div>` : ""}
    <div class="ir-thread">${threadHtml}</div>
    ${tracked ? `<div class="ir-sect">Activité${thread.length > 1 ? " — message sélectionné" : ""}</div><div class="ir-tl">${tl}</div>` : ""}`;
  document.querySelector("#page-iris .ir-split").classList.remove("full");   // rouvre le panneau si fermé
  const rback = $("irReaderBack");
  if (rback) rback.onclick = () => {
    document.querySelector("#page-iris .ir-split").classList.remove("reader");
    renderIrList(); renderIrDetail(m.id);
  };
  const tb = $("irTrashBtn");
  if (tb) tb.onclick = () => {
    m.trash = true;
    atToast("🗑️ Déplacé dans Supprimés.");
    renderIrStats(); renderIrFolders(); renderIrList(); renderIrDetail(m.id);
  };
  const rs = $("irReplySm");
  if (rs) rs.onclick = () => irOpenReply(m, false);
  const rsa = $("irReplyAllSm");
  if (rsa) rsa.onclick = () => irOpenReply(m, true);
  const addSel = $("irAddLbl");
  if (addSel) addSel.onchange = () => {
    if (!addSel.value) return;
    m.labels = m.labels || []; m.labels.push(addSel.value);
    renderIrFolders(); renderIrDetail(m.id);
  };
  const autoSel = $("irAutoSel");
  if (autoSel) autoSel.onchange = () => {
    if (!autoSel.value) return;
    irRules = irRules.filter((r) => r.addr.toLowerCase() !== m.to.toLowerCase());
    irRules.push({ addr: m.to, label: autoSel.value });
    irRulesSave(); irApplyRules();
    atToast("⚡ Les mails de " + m.to + " se rangeront dans « " + autoSel.value.replace(/\//g, " › ") + " »");
    renderIrFolders(); renderIrDetail(m.id);
  };
  renderIrList();
}
$("irDetailClose").onclick = () => {
  irSel = null;
  document.querySelector("#page-iris .ir-split").classList.remove("reader"); document.querySelector("#page-iris .ir-split").classList.add("full");
  $("irDetail").innerHTML = '<div class="rb-empty" style="padding:60px 20px;text-align:center;">Sélectionne un mail pour voir son suivi.</div>';
  renderIrList();
};
$("irDetail").addEventListener("click", (e) => {
  const m = irMails.find((x) => x.id === irSel); if (!m) return;
  if (e.target.closest("[data-tfold]")) { irThreadOpen = new Set([irSel]); irThreadStackOpen = false; renderIrDetail(irSel); return; }
  if (e.target.closest("[data-tstack]")) { irThreadStackOpen = true; renderIrDetail(irSel); return; }
  const te = e.target.closest("[data-texp]");
  if (te) { const tid = te.dataset.texp; irThreadOpen.has(tid) ? irThreadOpen.delete(tid) : irThreadOpen.add(tid); renderIrDetail(irSel); return; }
  if (e.target.closest("[data-restore]")) { m.trash = false; atToast("Mail restauré."); renderIrStats(); renderIrFolders(); renderIrList(); renderIrDetail(m.id); return; }
  if (e.target.closest("[data-unsched]")) { m.sched = null; m.draft = true; atToast("Programmation annulée — déplacé en brouillons."); renderIrStats(); renderIrFolders(); renderIrList(); renderIrDetail(m.id); return; }
  if (e.target.closest("[data-purge]")) {
    irMails = irMails.filter((x) => x.id !== m.id); irSel = null;
    document.querySelector("#page-iris .ir-split").classList.remove("reader"); document.querySelector("#page-iris .ir-split").classList.add("full");
    $("irDetail").innerHTML = '<div class="rb-empty" style="padding:60px 20px;text-align:center;">Sélectionne un mail pour voir son suivi.</div>';
    atToast("Supprimé définitivement.");
    renderIrStats(); renderIrFolders(); renderIrList(); return;
  }
  const rm = e.target.closest("[data-rmlbl]");
  if (rm) { if (irRemoveLabel(m, rm.dataset.rmlbl)) atToast("Règle auto retirée aussi."); renderIrFolders(); renderIrDetail(m.id); return; }
  if (e.target.closest("[data-rmrule]")) {
    irRules = irRules.filter((r) => r.addr.toLowerCase() !== m.to.toLowerCase());
    irRulesSave(); atToast("Classement auto retiré pour " + m.to + ".");
    renderIrDetail(m.id);
  }
});
let irDemoMode = false;                                    // accès à la vue sans boîte connectée (revue des designs)
async function refreshIris() {
  const st = await window.olympus.irisStatus();
  const open = st.connected || irDemoMode;
  $("irGate").style.display = open ? "none" : "";
  document.querySelector("#page-iris .ir-wrap").style.display = open ? "" : "none";
  if (!open) return;                                       // boîte non connectée → portail, pas de vue Iris
  irApplyRules();                                          // pré-classement automatique par adresse
  renderIrAcct();
  renderIrStats(); renderIrFolders(); renderIrList(); irMode();
  irStartSim();                                            // alertes de suivi en direct (démo)
  if (irSel) renderIrDetail(irSel);
  if (st.connected) irLoadLabels();                        // synchro des catégories Gmail (IMAP)
}
$("irFolders").onclick = $("irLabels").onclick = (e) => {
  const ok = e.target.closest("[data-newok]");
  if (ok) { const inp = $("irInlineNew"); if (inp) irCreateGroup(inp.value); return; }
  if (e.target.closest(".ir-newrow")) return;               // clic dans le champ de création
  const add = e.target.closest("[data-addin]");
  if (add) { irNewParent = add.dataset.addin; irOpen.add(irNewParent); renderIrFolders(); return; }
  const tw = e.target.closest("[data-tw]");
  if (tw) { const p = tw.dataset.tw; irOpen.has(p) ? irOpen.delete(p) : irOpen.add(p); renderIrFolders(); return; }
  const f = e.target.closest("[data-fold]"); if (!f) return;
  irFolder = f.dataset.fold;
  irMode(); renderIrFolders(); renderIrList();
};
$("irNewLabel").onclick = () => { irNewParent = irNewParent === "" ? null : ""; renderIrFolders(); };
$("irSearch").addEventListener("input", renderIrList);
$("irFilters").onclick = (e) => {
  const s = e.target.closest("[data-f]"); if (!s) return;
  irFilter = s.dataset.f;
  $("irFilters").querySelectorAll("span").forEach((x) => x.classList.toggle("active", x === s));
  renderIrList();
};
$("irList").onclick = (e) => {
  const ex = e.target.closest("[data-expand]");
  if (ex) { document.querySelector("#page-iris .ir-split").classList.add("reader"); renderIrDetail(ex.dataset.expand); return; }
  const row = e.target.closest("[data-mail]"); if (row) renderIrDetail(row.dataset.mail);
};
// Drag & drop : glisser un mail sur un groupe (ou Favoris / En attente / Importants) pour le classer.
let irDragId = null;
const IR_DROP_SYS = { star: ["star", "Ajouté aux favoris."], snooze: ["snooze", "Mis en attente."], important: ["important", "Marqué important."], trash: ["trash", "🗑️ Déplacé dans Supprimés."] };
$("irList").addEventListener("dragstart", (e) => {
  const row = e.target.closest("[data-mail]"); if (!row) return;
  irDragId = row.dataset.mail;
  row.classList.add("dragging");
  e.dataTransfer.effectAllowed = "copyMove";               // copy = classer dans un groupe · move = porte de sortie
  e.dataTransfer.setData("text/plain", irDragId);
  // Les portes de sortie apparaissent sur les groupes du mail → on déplie leurs parents pour les rendre visibles.
  const m = irMails.find((x) => x.id === irDragId);
  if (m) for (const l of (m.labels || [])) { let acc = ""; for (const seg of l.split("/")) { acc = acc ? acc + "/" + seg : seg; if (acc !== l) irOpen.add(acc); } }
  document.body.classList.add("ir-drag");
  renderIrFolders();
});
$("irList").addEventListener("dragend", () => {
  irDragId = null;
  document.body.classList.remove("ir-drag");
  document.querySelectorAll(".ir-row.dragging").forEach((r) => r.classList.remove("dragging"));
  renderIrFolders();                                       // retire les portes de sortie
});
const irClearOvers = () => { document.querySelectorAll(".ir-folder.dropover").forEach((r) => r.classList.remove("dropover")); document.querySelectorAll(".ir-exit.over").forEach((r) => r.classList.remove("over")); };
function irDragOver(e) {
  if (!irDragId) return;
  const ex = e.target.closest("[data-exit]");
  if (ex) {                                                 // porte de sortie : retirer du groupe
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    irClearOvers();
    ex.classList.add("over");
    return;
  }
  const f = e.target.closest("[data-fold]"); if (!f) return;
  const m = irMails.find((x) => x.id === irDragId); if (!m) return;
  const id = f.dataset.fold;
  const home = m.dir === "in" ? "inbox" : m.draft ? "draft" : m.sched ? "sched" : "sent";
  // Mail supprimé : on peut le remettre dans son dossier d'origine, ou dans un groupe (= restaurer + classer).
  const valid = m.trash ? (id.startsWith("label:") || id === home) : (id.startsWith("label:") || IR_DROP_SYS[id]);
  if (!valid) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  irClearOvers();
  f.classList.add("dropover");
  if (id.startsWith("label:")) {                            // survol d'un groupe fermé → il s'ouvre pour viser un sous-groupe
    const p = id.slice(6);
    if (!irOpen.has(p) && irLabelsList.some((l) => l.startsWith(p + "/"))) { irOpen.add(p); renderIrFolders(); }
  }
}
function irDrop(e) {
  if (!irDragId) return;
  const m = irMails.find((x) => x.id === irDragId); if (!m) return;
  const ex = e.target.closest("[data-exit]");
  if (ex) {
    e.preventDefault();
    const p = ex.dataset.exit;
    const ruleGone = irRemoveLabel(m, p);
    atToast("🚪 Sorti de « " + p.replace(/\//g, " › ") + " »" + (ruleGone ? " — règle auto retirée aussi" : ""));
  } else {
    const f = e.target.closest("[data-fold]"); if (!f) return;
    e.preventDefault();
    const id = f.dataset.fold;
    const home = m.dir === "in" ? "inbox" : m.draft ? "draft" : m.sched ? "sched" : "sent";
    if (id.startsWith("label:")) {
      const p = id.slice(6);
      m.labels = m.labels || [];
      const restored = m.trash; m.trash = false;
      if (!m.labels.includes(p)) m.labels.push(p);
      atToast(restored ? "Restauré et classé dans « " + p.replace(/\//g, " › ") + " »" : "« " + m.subject.slice(0, 42) + " » → " + p.replace(/\//g, " › "));
    } else if (m.trash && id === home) {
      m.trash = false;
      atToast("↩ Remis dans « " + (IR_FOLDERS.find((x) => x.id === home) || {}).n + " »");
    } else if (!m.trash && IR_DROP_SYS[id]) { m[IR_DROP_SYS[id][0]] = true; atToast(IR_DROP_SYS[id][1]); }
  }
  irDragId = null;
  document.body.classList.remove("ir-drag");
  irClearOvers();
  renderIrFolders(); renderIrList();
  if (irSel === m.id) renderIrDetail(m.id);
}
for (const id of ["irLabels", "irFolders"]) {
  $(id).addEventListener("dragover", irDragOver);
  $(id).addEventListener("drop", irDrop);
  $(id).addEventListener("dragleave", (e) => { const f = e.target.closest("[data-fold]"); if (f) f.classList.remove("dropover"); const ex = e.target.closest("[data-exit]"); if (ex) ex.classList.remove("over"); });
}
// Connexions (dans le profil)
async function refreshConnections() {
  const st = await window.olympus.irisStatus();
  const dot = $("connGmailDot"), status = $("connGmailStatus"), btn = $("connGmailBtn"), dc = $("gmDisconnect");
  if (st.connected) { dot.className = "conn-dot on"; status.textContent = "connecté · " + st.email; btn.textContent = "Gérer"; if (dc) dc.style.display = ""; }
  else { dot.className = "conn-dot off"; status.textContent = "non connecté"; btn.textContent = "Connecter"; if (dc) dc.style.display = "none"; }
}
$("connGmailBtn").onclick = async () => {
  const f = $("gmailForm"); const show = f.style.display === "none"; f.style.display = show ? "" : "none";
  if (show) { const st = await window.olympus.irisStatus(); if (st.email) $("gmEmail").value = st.email; }
};
$("gmConnectBtn").onclick = async () => {
  const email = $("gmEmail").value.trim(), pass = $("gmPass").value.trim(), msg = $("gmMsg"), btn = $("gmConnectBtn");
  if (!email || !pass) { msg.className = "msg err"; msg.textContent = "Email et mot de passe requis."; return; }
  btn.disabled = true; msg.className = "msg"; msg.textContent = "Vérification…";
  const r = await window.olympus.irisConnect(email, pass);
  btn.disabled = false;
  if (r.ok) { $("gmPass").value = ""; msg.className = "msg ok"; msg.textContent = "✅ Gmail connecté."; $("gmailForm").style.display = "none"; refreshConnections(); refreshIris(); }
  else { msg.className = "msg err"; msg.textContent = r.error; }
};
$("gmDisconnect").onclick = async () => { await window.olympus.irisDisconnect(); refreshConnections(); refreshIris(); };
$("irisGoProfile").onclick = () => $("profileCard").click();
$("irDemoLink").onclick = () => { irDemoMode = true; refreshIris(); };
// Composition (modal)
function renderIrAtts() {
  $("irAttachList").innerHTML = irAtts.map((a, i) => `<div class="crm-row" style="padding:7px 0"><div style="flex:1;min-width:0"><span style="font-size:13px;">📎 ${escapeHtml(a.name)}</span> <span style="color:var(--dim);font-size:11px;">${a.size}</span></div><span class="member-btn danger" data-rmatt="${i}">Retirer</span></div>`).join("");
}
$("irComposeBtn").onclick = () => {
  irReplyLabels = null; irAtts = []; renderIrAtts();
  ["irTo", "irToName", "irClient", "irCc", "irSubject", "irBody"].forEach((id) => ($(id).value = ""));
  irShowCc(false); irShowDet(false);
  irFillCompCat("");
  irReplyMailId = null; renderIrCompSide();
  $("irSchedPop").style.display = "none";
  $("irCompTitle").textContent = "Nouveau message";
  $("irMsg").textContent = "";
  $("irModal").classList.remove("min");
  $("irModal").classList.add("show");
  $("irTo").focus();
};
// Répondre : composition pré-remplie (destinataire, sujet Re:, message cité, groupes hérités)
let irReplyLabels = null;
function irOpenReply(m, all) {
  irAtts = []; renderIrAtts();
  $("irTo").value = m.to; $("irToName").value = m.toName || ""; $("irClient").value = m.client || "";
  $("irCc").value = all ? (m.cc || []).join(", ") : "";
  $("irSubject").value = /^re\s*:/i.test(m.subject) ? m.subject : "Re: " + m.subject;
  const who = m.dir === "in" ? m.toName : (m.by || "moi");
  $("irBody").value = "\n\n— Le " + m.when + ", " + who + " a écrit :\n" + (m.body || "").split("\n").map((l) => "> " + l).join("\n");
  irReplyLabels = (m.labels || []).slice();
  irShowCc(!!(all && (m.cc || []).length));
  irShowDet(false);
  irFillCompCat((m.labels || [])[0] || "");
  irReplyMailId = m.id; irCompOpen = new Set([m.id]); renderIrCompSide();
  $("irSchedPop").style.display = "none";
  $("irCompTitle").textContent = (all ? "Répondre à tous — " : "Répondre — ") + (m.toName || m.to);
  $("irMsg").textContent = "";
  $("irModal").classList.remove("min");
  $("irModal").classList.add("show");
  $("irBody").focus(); $("irBody").setSelectionRange(0, 0);
}
$("irCancel").onclick = () => $("irModal").classList.remove("show");
// Composer façon Gmail : réduire / agrandir / abandonner + révélateurs Cc & Détails
function irShowCc(v) { $("irCcRow").style.display = v ? "" : "none"; $("irTogCc").classList.toggle("on", v); }
function irShowDet(v) { $("irDetRow").style.display = v ? "" : "none"; $("irTogDet").classList.toggle("on", v); }
$("irTogCc").onclick = () => { const v = $("irCcRow").style.display === "none"; irShowCc(v); if (v) $("irCc").focus(); };
$("irTogDet").onclick = () => { const v = $("irDetRow").style.display === "none"; irShowDet(v); if (v) $("irToName").focus(); };
$("irCompMin").onclick = () => { $("irModal").classList.toggle("min"); $("irModal").classList.remove("max"); renderIrCompSide(); };
$("irCompMax").onclick = () => { $("irModal").classList.toggle("max"); $("irModal").classList.remove("min"); renderIrCompSide(); };
// Colonne « Fil de discussion » du composer plein stage : lire la conversation en écrivant, re-citer un autre message.
let irReplyMailId = null, irCompOpen = new Set();
function renderIrCompSide() {
  const el = $("irCompSide");
  const m = irMails.find((x) => x.id === irReplyMailId);
  if (!m || !$("irModal").classList.contains("max")) { el.style.display = "none"; return; }
  el.style.display = "";
  const thread = irThreadOf(m);
  el.innerHTML = `<div class="ir-sect" style="margin:0 0 8px;">Fil de discussion · ${thread.length} message${thread.length > 1 ? "s" : ""}</div>` + thread.map((t) => {
    const who = t.dir === "in" ? t.toName : (t.by || "Moi");
    const open = irCompOpen.has(t.id);
    return `<div class="cs-item${t.id === irReplyMailId ? " sel" : ""}">
      <div class="cs-head" data-cst="${t.id}"><b>${escapeHtml(who)}</b><span class="w">${t.when}</span><span class="cs-re" data-csr="${t.id}" title="Répondre à ce message (recale la citation)">↩</span></div>
      ${open ? `<div class="cs-body">${escapeHtml(t.body || "")}</div>` : `<div class="cs-snip">${escapeHtml((t.body || "").replace(/\s+/g, " ").slice(0, 72))}…</div>`}
    </div>`;
  }).join("");
}
function irRequote(t) {
  const who = t.dir === "in" ? t.toName : (t.by || "moi");
  const typed = $("irBody").value.split("\n\n— Le ")[0].replace(/\s+$/, "");
  $("irBody").value = typed + "\n\n— Le " + t.when + ", " + who + " a écrit :\n" + (t.body || "").split("\n").map((l) => "> " + l).join("\n");
  irReplyMailId = t.id;
  irCompOpen = new Set([t.id]);
  renderIrCompSide();
  atToast("↩ Réponse recalée sur le message du " + t.when);
}
$("irCompSide").addEventListener("click", (e) => {
  const r = e.target.closest("[data-csr]");
  if (r) { const t = irMails.find((x) => x.id === r.dataset.csr); if (t) irRequote(t); return; }
  const h = e.target.closest("[data-cst]");
  if (h) { const id = h.dataset.cst; irCompOpen.has(id) ? irCompOpen.delete(id) : irCompOpen.add(id); renderIrCompSide(); }
});
$("irDiscard").onclick = () => {
  irReplyLabels = null; irAtts = []; renderIrAtts();
  ["irTo", "irToName", "irClient", "irCc", "irSubject", "irBody"].forEach((id) => ($(id).value = ""));
  $("irModal").classList.remove("show");
  atToast("🗑️ Brouillon abandonné.");
};
// Groupe du message (header) : classe ce mail ET crée la règle auto → les suivants iront au même endroit.
function irFillCompCat(sel) {
  $("irCompCat").innerHTML = '<option value="">＋ Groupe…</option>' + irLabelsList.slice().sort().map((p) => `<option value="${escapeHtml(p)}"${p === sel ? " selected" : ""}>${escapeHtml(p.replace(/\//g, " › "))}</option>`).join("");
}
function irApplyCompCat(nm, addr) {
  const cat = $("irCompCat").value;
  if (!cat) return;
  nm.labels = nm.labels || [];
  if (!nm.labels.includes(cat)) nm.labels.push(cat);
  irRules = irRules.filter((r) => r.addr.toLowerCase() !== addr.toLowerCase());
  irRules.push({ addr, label: cat });
  irRulesSave();
}
// Programmation de l'envoi
const fmtSched = (dt) => dt.getDate() + " " + MON_ABBR[dt.getMonth()] + " · " + String(dt.getHours()).padStart(2, "0") + ":" + String(dt.getMinutes()).padStart(2, "0");
$("irSched").onclick = () => {
  const p = $("irSchedPop");
  if (p.style.display === "none") {
    const t1 = new Date(); t1.setDate(t1.getDate() + 1); t1.setHours(8, 0, 0, 0);
    const t2 = new Date(); t2.setDate(t2.getDate() + 1); t2.setHours(14, 0, 0, 0);
    const t3 = new Date(); t3.setDate(t3.getDate() + (((8 - t3.getDay()) % 7) || 7)); t3.setHours(9, 0, 0, 0);
    const opts = [["Demain matin", t1], ["Demain après-midi", t2], ["Lundi matin", t3]];
    p.querySelectorAll(".sp-opt").forEach((el, i) => { el.textContent = opts[i][0] + " — " + fmtSched(opts[i][1]); el.dataset.when = fmtSched(opts[i][1]); });
    p.style.display = "";
  } else p.style.display = "none";
};
function irScheduleMail(when) {
  const d = { to: $("irTo").value.trim(), toName: $("irToName").value.trim(), subject: $("irSubject").value.trim(), body: $("irBody").value.trim() };
  const msg = $("irMsg");
  $("irSchedPop").style.display = "none";
  if (!d.to || !d.subject || !d.body) { msg.className = "msg err"; msg.textContent = "Destinataire, sujet et message requis."; return; }
  const nm = { id: "m" + Date.now(), to: d.to, toName: d.toName || d.to, client: $("irClient").value.trim(), cc: $("irCc").value.split(",").map((x) => x.trim()).filter(Boolean), by: "Sacha", when, sched: when, subject: d.subject, preview: d.body.replace(/^\s+/, "").slice(0, 90), body: d.body, atts: irAtts, events: [], labels: irReplyLabels ? irReplyLabels.slice() : [] };
  irApplyCompCat(nm, d.to);
  irMails.unshift(nm);
  irReplyLabels = null;
  irApplyRules();
  $("irModal").classList.remove("show");
  atToast("🕐 Envoi programmé — " + when);
  renderIrStats(); renderIrFolders(); renderIrList();
}
$("irSchedPop").onclick = (e) => { const o = e.target.closest("[data-sp]"); if (o && o.dataset.when) irScheduleMail(o.dataset.when); };
$("irSchedOk").onclick = () => { const v = $("irSchedAt").value; if (!v) return; irScheduleMail(fmtSched(new Date(v))); };
$("irAttachBtn").onclick = () => {
  const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true;
  inp.onchange = () => { for (const f of inp.files) irAtts.push({ name: f.name, size: f.size > 1048576 ? (f.size / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(f.size / 1024)) + " Ko", dl: 0 }); renderIrAtts(); };
  inp.click();
};
$("irAttachList").onclick = (e) => { const rm = e.target.closest("[data-rmatt]"); if (rm) { irAtts.splice(+rm.dataset.rmatt, 1); renderIrAtts(); } };
$("irSend").onclick = async () => {
  const d = { to: $("irTo").value.trim(), toName: $("irToName").value.trim(), subject: $("irSubject").value.trim(), body: $("irBody").value.trim() };
  const msg = $("irMsg"), btn = $("irSend");
  if (!d.to || !d.subject || !d.body) { msg.className = "msg err"; msg.textContent = "Destinataire, sujet et message requis."; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Envoi…';
  const st = await window.olympus.irisStatus();
  let sentReal = false;
  if (st.connected) { const r = await window.olympus.irisSend(d); sentReal = r.ok; if (!r.ok) { btn.disabled = false; btn.textContent = "Envoyer"; msg.className = "msg err"; msg.textContent = r.error; return; } }
  const now = new Date();
  const when = now.getDate() + " " + MON_ABBR[now.getMonth()] + " · " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const nm = { id: "m" + Date.now(), to: d.to, toName: d.toName || d.to, client: $("irClient").value.trim(), cc: $("irCc").value.split(",").map((x) => x.trim()).filter(Boolean), by: "Sacha", when, subject: d.subject, preview: d.body.replace(/^\s+/, "").slice(0, 90), body: d.body, atts: irAtts, events: [{ k: "sent", w: when }], labels: irReplyLabels ? irReplyLabels.slice() : [] };
  irApplyCompCat(nm, d.to);                                // groupe choisi dans le header + règle auto pour la suite
  irMails.unshift(nm);
  irReplyLabels = null;
  irApplyRules();                                          // le nouveau mail se pré-range selon les règles
  btn.disabled = false; btn.textContent = "Envoyer";
  msg.className = "msg ok"; msg.textContent = sentReal ? "✅ Envoyé — suivi actif." : "✅ Ajouté (démo — Gmail non connecté).";
  setTimeout(() => $("irModal").classList.remove("show"), 700);
  renderIrStats(); renderIrFolders(); renderIrList();
};
document.querySelector('.nav-item[data-page="iris"]').addEventListener("click", refreshIris);

// ══════════ ARGOS (data clients — démo) ══════════
const sparkSvg = (arr, w = 130, h = 34) => {
  const mx = Math.max(...arr), mn = Math.min(...arr);
  const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - 3 - (v - mn) / (mx - mn || 1) * (h - 8)).toFixed(1)}`).join(" ");
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}"/></svg>`;
};
const AG_CLIENTS = [
  { id: "solene", name: "Maison Solène",
    kpis: [["128k", "portée 30 j", "+18%", [62, 71, 68, 80, 76, 88, 95, 91, 104, 112, 108, 128]], ["2 460 €", "dépense pubs", "+9%", [18, 20, 19, 22, 21, 24, 23, 25, 24, 26, 25, 27]], ["4,2", "ROAS moyen", "+0,4", [3.1, 3.3, 3.2, 3.6, 3.5, 3.8, 3.7, 4.0, 3.9, 4.1, 4.0, 4.2]], ["18 420", "visites site", "+12%", [9, 10, 11, 10, 12, 13, 12, 14, 15, 16, 17, 18]]],
    social: [
      { p: "Instagram", ic: "📷", h: "@maisonsolene", f: "24,8k", d: "+3,1%", er: "4,6% d'engagement · 12 posts" },
      { p: "TikTok", ic: "🎵", h: "@maisonsolene", f: "11,2k", d: "+8,7%", er: "6,1% d'engagement · 8 vidéos" },
      { p: "Facebook", ic: "👥", h: "Maison Solène", f: "9,4k", d: "+0,8%", er: "1,9% d'engagement · 6 posts" },
    ],
    ads: [
      { n: "Conversions — collection été", plat: "Meta Ads", on: true, spend: "860 € / 1 200 €", roas: "ROAS 4,8 · CPC 0,38 €" },
      { n: "Notoriété — vidéo teaser", plat: "Meta Ads", on: true, spend: "420 € / 600 €", roas: "CPM 2,10 € · 380k impr." },
      { n: "Search — marque", plat: "Google Ads", on: false, spend: "180 € / 300 €", roas: "CTR 8,2% · terminée" },
    ],
    web: { s: [9, 10, 11, 10, 12, 13, 12, 14, 15, 16, 17, 18], conv: "2,4% de conversion · panier moyen 86 €", top: [["/collection-ete", "6 210"], ["/nouveautes", "3 480"], ["/lookbook-2026", "2 130"]] },
    seo: [{ kw: "robe lin provence", pos: 3, d: "▲2" }, { kw: "maison solène avis", pos: 1, d: "＝" }, { kw: "mode éthique été", pos: 8, d: "▲5" }, { kw: "robe cérémonie lin", pos: 14, d: "▼1" }],
    notes: [
      { t: "Campagne été : créa vidéo > carrousels (+2,1 pts de CTR). Refaire 3 hooks vidéo pour août.", m: "Campagne · 16 juil · Astrid Berges" },
      { t: "SEO : la page lookbook cannibalise /collection-ete sur « robe lin ». Fusionner les intentions.", m: "SEO · 12 juil · Lucas Dubois" },
    ] },
  { id: "riviera", name: "Villa Riviera",
    kpis: [["86k", "portée 30 j", "+6%", [55, 58, 54, 60, 63, 61, 66, 64, 70, 74, 78, 86]], ["1 140 €", "dépense pubs", "−4%", [14, 13, 14, 12, 13, 12, 12, 11, 12, 11, 12, 11]], ["3,1", "ROAS moyen", "+0,2", [2.6, 2.7, 2.8, 2.7, 2.9, 3.0, 2.9, 3.0, 3.1, 3.0, 3.1, 3.1]], ["9 310", "visites site", "+21%", [4, 5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9.3]]],
    social: [
      { p: "Instagram", ic: "📷", h: "@villariviera.mc", f: "38,1k", d: "+1,9%", er: "3,2% d'engagement · 9 posts" },
      { p: "LinkedIn", ic: "💼", h: "Villa Riviera", f: "4,6k", d: "+2,4%", er: "2,7% d'engagement · 4 posts" },
    ],
    ads: [
      { n: "Réservations — saison", plat: "Meta Ads", on: true, spend: "640 € / 900 €", roas: "ROAS 3,4 · CPC 0,52 €" },
      { n: "Display — luxe Riviera", plat: "Google Ads", on: true, spend: "500 € / 700 €", roas: "CPM 3,40 € · 210k impr." },
    ],
    web: { s: [4, 5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9.3], conv: "1,8% de conversion · réservation moyenne 410 €", top: [["/suites", "3 020"], ["/offres-ete", "1 890"], ["/spa", "1 260"]] },
    seo: [{ kw: "villa luxe monaco", pos: 5, d: "▲1" }, { kw: "hôtel spa riviera", pos: 9, d: "▲3" }, { kw: "suite vue mer monaco", pos: 2, d: "＝" }],
    notes: [
      { t: "Les stories « coulisses » font ×2 de complétion vs posts produits. En caler 3/semaine.", m: "Campagne · 14 juil · Sacha" },
      { t: "SEO : gagner la position 1 sur « suite vue mer monaco » = ~40 clics/j. Optimiser le title + FAQ.", m: "SEO · 9 juil · Lucas Dubois" },
    ] },
  { id: "solaris", name: "Solaris",
    kpis: [["54k", "portée 30 j", "+32%", [20, 24, 22, 28, 30, 34, 33, 38, 42, 46, 50, 54]], ["780 €", "dépense pubs", "+15%", [5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11]], ["5,6", "ROAS moyen", "+1,1", [3.8, 4.0, 4.2, 4.1, 4.5, 4.7, 4.9, 5.0, 5.2, 5.4, 5.5, 5.6]], ["6 480", "visites site", "+40%", [2, 2.4, 2.8, 3, 3.4, 3.8, 4.1, 4.6, 5, 5.5, 6, 6.5]]],
    social: [
      { p: "Instagram", ic: "📷", h: "@solaris.eyewear", f: "8,9k", d: "+11,2%", er: "7,8% d'engagement · 14 posts" },
      { p: "TikTok", ic: "🎵", h: "@solaris.eyewear", f: "21,4k", d: "+24,6%", er: "9,3% d'engagement · 11 vidéos" },
    ],
    ads: [
      { n: "Lancement — solaires 2026", plat: "Meta Ads", on: true, spend: "540 € / 800 €", roas: "ROAS 6,1 · CPC 0,29 €" },
      { n: "Retargeting — paniers", plat: "Meta Ads", on: true, spend: "240 € / 300 €", roas: "ROAS 8,4 · CPA 6,20 €" },
    ],
    web: { s: [2, 2.4, 2.8, 3, 3.4, 3.8, 4.1, 4.6, 5, 5.5, 6, 6.5], conv: "3,1% de conversion · panier moyen 129 €", top: [["/solaires-2026", "2 840"], ["/best-sellers", "1 410"], ["/e-shop", "980"]] },
    seo: [{ kw: "lunettes soleil créateur", pos: 6, d: "▲4" }, { kw: "solaris eyewear", pos: 1, d: "＝" }, { kw: "lunettes bois france", pos: 11, d: "▲2" }],
    notes: [
      { t: "Le shoot d'Èze surperforme partout : 3 posts dans le top 5 all-time. Prévoir un shoot « lifestyle plage » en août.", m: "Campagne · 17 juil · Astrid Berges" },
    ] },
];
let agCur = "solene";
function renderArgos() {
  $("agClients").innerHTML = AG_CLIENTS.map((c) => `<span data-cl="${c.id}" class="${agCur === c.id ? "active" : ""}">${escapeHtml(c.name)}</span>`).join("");
  const c = AG_CLIENTS.find((x) => x.id === agCur); if (!c) return;
  const hero = c.kpis.map(([n, l, d, s]) => {
    const up = !d.startsWith("−") && !d.startsWith("▼");
    return `<div class="ag-kpi"><div class="n">${n}</div><div class="l">${l} <span class="${up ? "ag-up" : "ag-down"}">${up ? "▲" : "▼"} ${d.replace("−", "")}</span></div>${sparkSvg(s)}</div>`;
  }).join("");
  const social = c.social.map((s) => `<div class="ag-row"><div class="ic">${s.ic}</div><div><div class="nm">${s.p} <span style="color:var(--dim);font-weight:400;font-size:11.5px;">${escapeHtml(s.h)}</span></div><div class="sub">${s.er}</div></div><div class="val"><div class="b">${s.f}</div><div class="s ag-up">▲ ${s.d}</div></div></div>`).join("");
  const ads = c.ads.map((a) => `<div class="ag-row"><span class="ag-state${a.on ? "" : " off"}">${a.on ? "active" : "finie"}</span><div><div class="nm">${escapeHtml(a.n)}</div><div class="sub">${a.plat} · ${a.roas}</div></div><div class="val"><div class="b">${a.spend}</div><div class="s">dépensé / budget</div></div></div>`).join("");
  const top = c.web.top.map(([p, v]) => `<div class="ag-row" style="padding:8px 0;"><div style="font-size:12.5px;color:var(--muted);">${p}</div><div class="val"><div class="b" style="font-size:12.5px;">${v}</div></div></div>`).join("");
  const seo = c.seo.map((s) => `<div class="ag-row"><span class="ag-pos${s.pos <= 3 ? " top" : ""}">${s.pos}</span><div><div class="nm" style="font-weight:500;">${escapeHtml(s.kw)}</div></div><div class="val"><div class="s ${s.d.startsWith("▼") ? "ag-down" : "ag-up"}">${s.d}</div></div></div>`).join("");
  const notes = c.notes.map((n) => `<div class="ag-note"><div class="t">${escapeHtml(n.t)}</div><div class="m">${n.m}</div></div>`).join("");
  $("agBody").innerHTML = `
    <div class="ag-hero">${hero}</div>
    <div class="ag-grid">
      <div><div class="ag-sect">Réseaux sociaux</div>${social}<div class="ag-sect">Publicité</div>${ads}</div>
      <div><div class="ag-sect">Site web</div><div style="display:flex;align-items:center;gap:18px;padding:10px 0 4px;">${sparkSvg(c.web.s, 190, 44)}<div style="font-size:11.5px;color:var(--dim);">${c.web.conv}</div></div>${top}<div class="ag-sect">Positions SEO</div>${seo}<div class="ag-sect">Notes campagnes & SEO</div>${notes}</div>
    </div>`;
}
$("agClients").onclick = (e) => { const s = e.target.closest("[data-cl]"); if (s) { agCur = s.dataset.cl; renderArgos(); } };
document.querySelector('.nav-item[data-page="argos"]').addEventListener("click", renderArgos);

// ══════════ ATLAS (drive — démo) ══════════
const atIcon = (n) => /\.(jpe?g|png|gif|webp|heic|tiff?)$/i.test(n) ? "🖼️" : /\.(mp4|mov|avi)$/i.test(n) ? "🎬" : /\.(pdf)$/i.test(n) ? "📄" : /\.(docx?|pages)$/i.test(n) ? "📝" : /\.(xlsx?|numbers|csv)$/i.test(n) ? "📊" : /\.(zip|rar)$/i.test(n) ? "📦" : /\.(psd|ai|indd|afphoto)$/i.test(n) ? "🎨" : /\.(key|pptx?)$/i.test(n) ? "📽️" : "📁";
const F = (name, size, when) => ({ t: "f", name, size, when });
const D = (name, when, children) => ({ t: "d", name, when, children });
const AT_ROOT = D("Atlas", "", [
  D("Clients", "12 juil 2026", [
    D("Maison Solène", "17 juil 2026", [F("brief_rentree_2026.pdf", "840 Ko", "17 juil"), F("devis_signe.pdf", "610 Ko", "10 juil"), F("moodboard_v3.pdf", "6,2 Mo", "8 juil"), D("Logos & charte", "2 mai", [F("logo_solene.ai", "4,1 Mo", "2 mai"), F("charte_solene.pdf", "12 Mo", "2 mai")])]),
    D("Villa Riviera", "17 juil 2026", [F("pack_reseaux_juillet.zip", "212 Mo", "17 juil"), F("planning_publications.xlsx", "84 Ko", "15 juil")]),
    D("Solaris", "16 juil 2026", [F("selection_eze_v1.pdf", "18,4 Mo", "16 juil"), F("contrat_2026.pdf", "390 Ko", "1 juin")]),
  ]),
  D("Shoots 2026", "15 juil 2026", [
    D("Émotions Arts — 15 juil", "15 juil 2026", [F("rushs_jour1.zip", "48,2 Go", "15 juil"), F("selection_lucas.xmp", "1,1 Mo", "16 juil"), F("teaser_v2.mp4", "148 Mo", "17 juil")]),
    D("Solaris — Èze", "3 juil 2026", [F("raw_eze.zip", "36,8 Go", "3 juil"), F("retouches_finales.zip", "2,4 Go", "9 juil")]),
    D("Mariage — Villa Ephrussi", "25 juil 2026", []),
  ]),
  D("Admin", "1 juil 2026", [
    D("Factures", "1 juil 2026", [F("facture_2026-041.pdf", "120 Ko", "1 juil"), F("facture_2026-040.pdf", "118 Ko", "24 juin"), F("facture_2026-039.pdf", "122 Ko", "18 juin")]),
    D("Contrats", "12 juin 2026", [F("contrat_solaris.pdf", "390 Ko", "1 juin"), F("contrat_riviera.pdf", "410 Ko", "12 mai")]),
  ]),
  D("Templates", "20 mai 2026", [F("devis_template.docx", "96 Ko", "20 mai"), F("planning_shoot.xlsx", "72 Ko", "20 mai"), F("call_sheet.pages", "204 Ko", "20 mai")]),
  F("charte_orphic.pdf", "9,8 Mo", "14 avr"),
  F("presentation_agence.key", "84 Mo", "2 juin"),
]);
let atPath = [];                                            // pile de dossiers depuis la racine
const atCwd = () => atPath.reduce((d, i) => d.children[i], AT_ROOT);
let atToastT = null;
function atToast(msg) {
  const t = $("atToast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(atToastT); atToastT = setTimeout(() => t.classList.remove("show"), 2400);
}
function renderAtlas() {
  const cwd = atCwd();
  let crumbs = `<span class="${atPath.length ? "" : "cur"}" data-cr="-1">Atlas</span>`;
  let d = AT_ROOT;
  atPath.forEach((idx, i) => { d = d.children[idx]; crumbs += `<i>›</i><span class="${i === atPath.length - 1 ? "cur" : ""}" data-cr="${i}">${escapeHtml(d.name)}</span>`; });
  $("atCrumbs").innerHTML = crumbs;
  const q = ($("atSearch").value || "").toLowerCase();
  const items = cwd.children
    .map((c, i) => ({ ...c, i }))
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .sort((a, b) => (a.t === b.t ? a.name.localeCompare(b.name) : a.t === "d" ? -1 : 1));
  $("atList").innerHTML = items.length ? items.map((c) => c.t === "d"
    ? `<div class="at-row" data-dir="${c.i}"><div class="ic">📁</div><div><div class="nm">${escapeHtml(c.name)}</div><div class="sub">${c.children.length} élément${c.children.length > 1 ? "s" : ""}</div></div><div class="meta">${c.when || ""}</div></div>`
    : `<div class="at-row" data-file="${c.i}"><div class="ic">${atIcon(c.name)}</div><div><div class="nm">${escapeHtml(c.name)}</div><div class="sub">${c.size || ""}</div></div><div class="meta">${c.when || ""}</div><span class="act" data-dl="${c.i}" title="Télécharger">⤓</span></div>`
  ).join("") : '<div class="rb-empty" style="padding:40px 10px;">Dossier vide — glisse ou uploade des fichiers.</div>';
  const used = 62;                                          // % de stockage (démo)
  $("atUsageBar").style.width = used + "%";
  $("atUsageTxt").textContent = "124 Go utilisés sur 200 Go";
}
$("atList").onclick = (e) => {
  const dl = e.target.closest("[data-dl]");
  if (dl) { atToast("⤓ Téléchargement de « " + atCwd().children[+dl.dataset.dl].name + " »… (démo)"); return; }
  const dir = e.target.closest("[data-dir]");
  if (dir) { atPath.push(+dir.dataset.dir); $("atSearch").value = ""; renderAtlas(); return; }
  const f = e.target.closest("[data-file]");
  if (f) atToast("Aperçu de « " + atCwd().children[+f.dataset.file].name + " » (démo)");
};
$("atCrumbs").onclick = (e) => { const c = e.target.closest("[data-cr]"); if (!c) return; const i = +c.dataset.cr; atPath = i < 0 ? [] : atPath.slice(0, i + 1); renderAtlas(); };
$("atSearch").addEventListener("input", renderAtlas);
$("atUpload").onclick = () => {
  const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true;
  inp.onchange = () => {
    const now = new Date(), when = now.getDate() + " " + MON_ABBR[now.getMonth()].replace(".", "");
    for (const f of inp.files) atCwd().children.push(F(f.name, f.size > 1048576 ? (f.size / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(f.size / 1024)) + " Ko", when));
    renderAtlas(); atToast("⤒ " + inp.files.length + " fichier(s) uploadé(s) (démo)");
  };
  inp.click();
};
$("atNewFolder").onclick = () => { const f = $("atFolderForm"); f.style.display = f.style.display === "none" ? "" : "none"; if (f.style.display === "") $("atFolderName").focus(); };
$("atFolderCreate").onclick = () => {
  const name = $("atFolderName").value.trim(); if (!name) return;
  const now = new Date();
  atCwd().children.push(D(name, now.getDate() + " " + MON_ABBR[now.getMonth()].replace(".", ""), []));
  $("atFolderName").value = ""; $("atFolderForm").style.display = "none";
  renderAtlas();
};
document.querySelector('.nav-item[data-page="atlas"]').addEventListener("click", renderAtlas);

// ══════════ APOLLON (galerie des shoots — démo) ══════════
const AP_TINT = { warm: ["#6b5642", "#241d16"], gold: ["#7a6a4a", "#28231b"], sage: ["#5c665a", "#1f231f"], slate: ["#4e5a68", "#1b2026"], mauve: ["#665667", "#211c24"], steel: ["#5a5e66", "#1f2124"] };
function apBg(tint, seed) {
  const [a, b] = AP_TINT[tint] || AP_TINT.steel;
  const ang = 100 + (seed * 47) % 140, px = 15 + (seed * 31) % 70, py = 10 + (seed * 53) % 45;
  return `background:radial-gradient(circle at ${px}% ${py}%, rgba(255,255,255,.12), transparent 55%),linear-gradient(${ang}deg,${a},${b});`;
}
// Chaque shoot porte ses métadonnées (client, date, lieu, équipe, type, livrables) — la base Olympus stockera tout ça.
const AP_SHOOTS = [
  { id: "emotions", title: "Émotions Arts — tournage & portraits", client: "Émotions Arts", date: "15 juillet 2026", type: "both", lieu: "Studio, Nice", team: "Sacha · Lucas Dubois", photos: 124, videos: 6, deliv: "Teaser 30 s · 12 portraits retouchés", tint: "warm" },
  { id: "solaris-eze", title: "Solaris — campagne Èze", client: "Solaris", date: "3 juillet 2026", type: "photo", lieu: "Èze village", team: "Astrid Berges · Sacha", photos: 210, videos: 0, deliv: "25 visuels e-shop · 6 verticaux réseaux", tint: "gold" },
  { id: "riviera-suites", title: "Villa Riviera — architecture & suites", client: "Villa Riviera", date: "28 juin 2026", type: "both", lieu: "Monaco", team: "Sacha · Lucas Dubois", photos: 96, videos: 4, deliv: "Visite 60 s · 18 photos presse", tint: "slate" },
  { id: "solene-lookbook", title: "Maison Solène — lookbook printemps", client: "Maison Solène", date: "12 mai 2026", type: "photo", lieu: "Villa, Cannes", team: "Astrid Berges · Sacha", photos: 168, videos: 0, deliv: "Lookbook 48 pages · pack réseaux", tint: "sage" },
  { id: "btp-corporate", title: "BTP Azur — film corporate", client: "BTP Azur", date: "10 juin 2026", type: "video", lieu: "Sophia Antipolis", team: "Lucas Dubois", photos: 40, videos: 3, deliv: "Film 90 s · 2 cutdowns", tint: "steel" },
  { id: "ateliern", title: "Atelier N — lookbook automne", client: "Atelier N", date: "22 avril 2026", type: "photo", lieu: "Paris 3ᵉ", team: "Sacha", photos: 142, videos: 0, deliv: "Lookbook · 30 visuels presse", tint: "mauve" },
];
function apItems(s) {
  const n = Math.min(18, s.photos ? 14 : 6) + (s.videos ? Math.min(4, s.videos) : 0);
  const items = [];
  for (let i = 0; i < n; i++) {
    const seed = s.id.length * 7 + i * 13;
    const isVid = s.videos > 0 && i % 6 === 4 && items.filter((x) => x.v).length < s.videos;
    items.push({ v: isVid, h: 1 + (seed % 4), seed, dur: isVid ? `0:${String(12 + (seed % 45)).padStart(2, "0")}` : null });
  }
  return items;
}
const AP_TYPE = { photo: "Photo", video: "Vidéo", both: "Photo + Vidéo" };
let apFilter = "all", apAlbum = null, apLightIdx = 0;
function renderApollon() {
  const q = ($("apSearch").value || "").toLowerCase();
  if (apAlbum) {
    const s = AP_SHOOTS.find((x) => x.id === apAlbum); if (!s) { apAlbum = null; return renderApollon(); }
    const items = apItems(s);
    $("apBody").innerHTML = `
      <div class="ap-back" data-back>‹ Tous les shoots</div>
      <div class="ap-ahead">
        <div><div class="ap-atitle">${escapeHtml(s.title)}</div>
        <div class="ap-ameta">${escapeHtml(s.client)} · ${s.date} · ${escapeHtml(s.lieu)} · ${AP_TYPE[s.type]} · ${escapeHtml(s.team)}<br>Livrables : ${escapeHtml(s.deliv)}</div></div>
        <div class="ap-astats"><div class="ap-astat"><div class="n">${s.photos}</div><div class="l">photos</div></div><div class="ap-astat"><div class="n">${s.videos}</div><div class="l">vidéos</div></div></div>
      </div>
      <div class="ap-masonry">${items.map((it, i) => `<div class="ap-item h${it.h}" data-it="${i}"><div class="bg" style="${apBg(s.tint, it.seed)}"></div>${it.v ? `<div class="vplay2">▶</div><span class="dur">${it.dur}</span>` : ""}</div>`).join("")}</div>`;
    return;
  }
  const list = AP_SHOOTS.filter((s) => (apFilter === "all" || s.type === apFilter) && (!q || [s.title, s.client, s.lieu].join(" ").toLowerCase().includes(q)));
  $("apBody").innerHTML = list.length
    ? `<div class="ap-grid">${list.map((s, i) => `
        <div class="ap-card" data-album="${s.id}">
          <div class="bg" style="${apBg(s.tint, i * 17 + 5)}"></div>
          <span class="badge">${AP_TYPE[s.type]}</span>
          <div class="scrim"></div>
          <div class="info"><div class="t">${escapeHtml(s.title)}</div><div class="m">${escapeHtml(s.client)} · ${s.date} · ${s.photos} photos${s.videos ? " · " + s.videos + " vidéos" : ""}</div></div>
        </div>`).join("")}</div>`
    : '<div class="rb-empty" style="padding:40px 10px;">Aucun shoot ne correspond.</div>';
}
function apOpenLight(i) {
  const s = AP_SHOOTS.find((x) => x.id === apAlbum); if (!s) return;
  const items = apItems(s);
  apLightIdx = (i + items.length) % items.length;
  const it = items[apLightIdx];
  $("apLight").innerHTML = `
    <div class="ap-lbox"><div style="position:absolute;inset:0;${apBg(s.tint, it.seed)}"></div>${it.v ? `<div class="vplay2" style="position:absolute;inset:0;display:grid;place-items:center;font-size:44px;color:rgba(255,255,255,.92);">▶</div>` : ""}
      <div class="ap-lcap">${escapeHtml(s.title)}<div class="s">${it.v ? "Vidéo · " + it.dur : "Photo"} · ${apLightIdx + 1} / ${items.length} · ${escapeHtml(s.lieu)}</div></div></div>
    <button class="ap-lnav" style="left:26px;" data-lprev>‹</button>
    <button class="ap-lnav" style="right:26px;" data-lnext>›</button>
    <button class="ap-lclose" data-lclose>✕</button>`;
  $("apLight").classList.add("show");
}
$("apBody").onclick = (e) => {
  if (e.target.closest("[data-back]")) { apAlbum = null; renderApollon(); return; }
  const al = e.target.closest("[data-album]");
  if (al) { apAlbum = al.dataset.album; renderApollon(); return; }
  const it = e.target.closest("[data-it]");
  if (it) apOpenLight(+it.dataset.it);
};
$("apLight").onclick = (e) => {
  if (e.target.closest("[data-lprev]")) return apOpenLight(apLightIdx - 1);
  if (e.target.closest("[data-lnext]")) return apOpenLight(apLightIdx + 1);
  if (e.target.closest("[data-lclose]") || e.target === $("apLight")) $("apLight").classList.remove("show");
};
$("apFilters").onclick = (e) => {
  const s = e.target.closest("[data-t]"); if (!s) return;
  apFilter = s.dataset.t;
  $("apFilters").querySelectorAll("span").forEach((x) => x.classList.toggle("active", x === s));
  apAlbum = null; renderApollon();
};
$("apSearch").addEventListener("input", () => { apAlbum = null; renderApollon(); });
$("apImport").onclick = () => atToast("＋ Import à venir — les médias et leurs métadonnées vivront dans la base Olympus.");
document.querySelector('.nav-item[data-page="apollon"]').addEventListener("click", renderApollon);

// ══════════ MNÉMOSYNE (notes — démo persistée en local) ══════════
const MN_KEY = "mnemosyne-notes";
function mnSeed() {
  const now = Date.now(), d = (days) => new Date(now - days * 864e5).toISOString();
  return [
    { id: "n1", title: "CR — réunion équipe du 14", body: "Points clés :\n\n— Maison Solène : shoot validé samedi 18, studio Cannes. Astrid cale la shotlist.\n— Villa Riviera : pack réseaux livré, attente retour Marc.\n— Solaris : la campagne Èze surperforme, prévoir un shoot lifestyle plage en août.\n— Recrutement : on relance l'annonce assistant·e prod en septembre.", when: d(4), pinned: true, people: ["Lucas Dubois", "Astrid Berges"], event: null },
    { id: "n2", title: "Checklist matériel — shoot Solène", body: "Boîtiers :\n— A7 IV ×2 + FX6\n— 24-70 GM II, 85 1.4, 35 1.4\n\nLumière :\n— 2× Aputure 600d + softbox 120\n— Réflecteurs, drapeaux\n\nDivers :\n— Fond 2,4 m (blanc + sable)\n— Batteries ×8, CFexpress ×6\n— Steamer pour les vêtements !", when: d(1), pinned: true, people: ["Lucas Dubois"], event: { title: "Shoot produit — Maison Solène", date: "2026-07-18" } },
    { id: "n3", title: "Idées contenu — Solaris août", body: "1. Série « golden hour » sur la plage de la Mala\n2. Macro sur les charnières bois — process artisanal\n3. Duo avec créateur local (cross-post)\n4. UGC : reprendre les 3 meilleurs posts clients\n5. Teaser collection automne fin août", when: d(2), pinned: false, people: ["Astrid Berges"], event: null },
    { id: "n4", title: "Process livraison client", body: "1. Sélection dans Apollon (48 h après le shoot)\n2. Retouche fine (5 j ouvrés)\n3. Upload Atlas → dossier client\n4. Mail Iris avec lien + suivi d'ouverture\n5. Événement « Rendu » dans Chronos\n6. Facture à J+3 après livraison", when: d(9), pinned: false, people: ["Lucas Dubois", "Astrid Berges"], event: null },
    { id: "n5", title: "Idées perso", body: "— Nouveau boîtier : attendre l'annonce de septembre\n— Formation colorimétrie DaVinci (Lucas intéressé aussi)\n— Regarder les studios plus grands à Sophia", when: d(6), pinned: false, people: [], event: null },
  ];
}
let mnNotes = [], mnSel = null, mnEvts = [];
function mnLoad() { try { mnNotes = JSON.parse(localStorage.getItem(MN_KEY)) || null; } catch { mnNotes = null; } if (!mnNotes) { mnNotes = mnSeed(); mnSave(); } }
function mnSave() { localStorage.setItem(MN_KEY, JSON.stringify(mnNotes)); }
const mnWhen = (iso) => { const dd = new Date(iso), n = new Date(); const same = dd.toDateString() === n.toDateString(); return same ? "Aujourd'hui · " + dd.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : dd.getDate() + " " + MONTHS[dd.getMonth()] + " " + dd.getFullYear(); };
function mnMembers() { const me = ($("accName").textContent || "Sacha").trim(); return [...new Set([me, ...FAKE_MEMBERS.map((f) => f.name)])]; }
function mnRow(n) {
  const avs = n.people.length ? `<span class="mn-avs">${n.people.map((p) => `<i>${initialsOf(p)}</i>`).join("")}</span>` : `<span>🔒 privée</span>`;
  const ev = n.event ? `<span>📅 ${escapeHtml(n.event.title)}</span>` : "";
  return `<div class="mn-row${mnSel === n.id ? " active" : ""}" data-note="${n.id}">
    <div class="t">${escapeHtml(n.title || "Sans titre")}</div>
    <div class="p">${escapeHtml((n.body || "").replace(/\n+/g, " ").slice(0, 64) || "Note vide")}</div>
    <div class="m"><span class="mn-pin${n.pinned ? " on" : ""}" data-pin="${n.id}" title="Épingler">${n.pinned ? "★" : "☆"}</span>${avs}${ev}</div>
  </div>`;
}
function renderMnList() {
  const q = ($("mnSearch").value || "").toLowerCase();
  const match = (n) => !q || (n.title + " " + n.body).toLowerCase().includes(q);
  const sorted = mnNotes.slice().sort((a, b) => new Date(b.when) - new Date(a.when));
  const pinned = sorted.filter((n) => n.pinned && match(n)), rest = sorted.filter((n) => !n.pinned && match(n));
  $("mnList").innerHTML = (pinned.length ? `<div class="mn-sec">Épinglées</div>` + pinned.map(mnRow).join("") : "") +
    (rest.length ? `<div class="mn-sec">Notes</div>` + rest.map(mnRow).join("") : "") +
    (!pinned.length && !rest.length ? '<div class="rb-empty" style="padding:24px 4px;">Aucune note.</div>' : "");
}
function renderMnPeople(n) {
  $("mnPeople").innerHTML = mnMembers().map((p) => `<span class="mn-person${n.people.includes(p) ? " on" : ""}" data-p="${escapeHtml(p)}"><span class="av">${initialsOf(p)}</span>${escapeHtml(p)}</span>`).join("");
}
async function mnLoadEvents() {
  const from = new Date(Date.now() - 30 * 864e5), to = new Date(Date.now() + 120 * 864e5);
  const r = await window.olympus.chronosList(isoD(from.getFullYear(), from.getMonth(), from.getDate()), isoD(to.getFullYear(), to.getMonth(), to.getDate()));
  mnEvts = (r.ok ? r.events : []).filter((e) => !e.title.startsWith("Rendu — "));
  const n = mnNotes.find((x) => x.id === mnSel);
  $("mnEvent").innerHTML = '<option value="">— aucun —</option>' + mnEvts.map((e) => `<option value="${e.id}"${n && n.event && n.event.title === e.title ? " selected" : ""}>${new Date(e.date + "T00:00").toLocaleDateString("fr-FR")} — ${escapeHtml(e.title)}</option>`).join("");
}
function openNote(id) {
  const n = mnNotes.find((x) => x.id === id); if (!n) return;
  mnSel = id;
  $("mnTitle").value = n.title; $("mnBody").value = n.body;
  $("mnWhen").textContent = mnWhen(n.when);
  renderMnPeople(n); renderMnList(); mnLoadEvents();
}
function renderMnemosyne() { mnLoad(); if (!mnSel && mnNotes.length) mnSel = mnNotes.slice().sort((a, b) => new Date(b.when) - new Date(a.when))[0].id; renderMnList(); if (mnSel) openNote(mnSel); }
let mnT = null;
function mnEdited() {
  const n = mnNotes.find((x) => x.id === mnSel); if (!n) return;
  n.title = $("mnTitle").value; n.body = $("mnBody").value; n.when = new Date().toISOString();
  $("mnWhen").textContent = mnWhen(n.when);
  mnSave();
  clearTimeout(mnT); mnT = setTimeout(renderMnList, 350);
}
$("mnTitle").addEventListener("input", mnEdited);
$("mnBody").addEventListener("input", mnEdited);
$("mnSearch").addEventListener("input", renderMnList);
$("mnNew").onclick = () => {
  const n = { id: "n" + Date.now(), title: "", body: "", when: new Date().toISOString(), pinned: false, people: [], event: null };
  mnNotes.push(n); mnSave(); openNote(n.id); $("mnTitle").focus();
};
$("mnDelete").onclick = () => {
  if (!mnSel) return;
  mnNotes = mnNotes.filter((x) => x.id !== mnSel); mnSave();
  mnSel = null; renderMnemosyne(); atToast("Note supprimée.");
};
$("mnList").onclick = (e) => {
  const pin = e.target.closest("[data-pin]");
  if (pin) { const n = mnNotes.find((x) => x.id === pin.dataset.pin); if (n) { n.pinned = !n.pinned; mnSave(); renderMnList(); } return; }
  const row = e.target.closest("[data-note]"); if (row) openNote(row.dataset.note);
};
$("mnPeople").onclick = (e) => {
  const p = e.target.closest("[data-p]"); if (!p) return;
  const n = mnNotes.find((x) => x.id === mnSel); if (!n) return;
  const name = p.dataset.p;
  n.people = n.people.includes(name) ? n.people.filter((x) => x !== name) : [...n.people, name];
  mnSave(); renderMnPeople(n); renderMnList();
};
$("mnEvent").onchange = () => {
  const n = mnNotes.find((x) => x.id === mnSel); if (!n) return;
  const ev = mnEvts.find((e) => String(e.id) === $("mnEvent").value);
  n.event = ev ? { title: ev.title, date: ev.date } : null;
  mnSave(); renderMnList();
};
document.querySelector('.nav-item[data-page="mnemosyne"]').addEventListener("click", renderMnemosyne);

// ══════════ CONTRÔLE PAR CLAUDE CODE ══════════
async function refreshClaude() {
  const s = await window.olympus.claudeStatus();
  $("claudeInstallBtn").textContent = s.installed ? "Réinstaller le contrôle Claude Code" : "Activer le contrôle par Claude Code";
}
$("claudeInstallBtn").onclick = async () => {
  const btn = $("claudeInstallBtn"), msg = $("claudeMsg");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Installation…'; msg.className = "msg"; msg.textContent = "";
  const r = await window.olympus.claudeInstall();
  btn.disabled = false;
  if (r.ok) { msg.className = "msg ok"; msg.innerHTML = "✅ Activé. Redémarre Claude Code, puis demande-lui par ex. « montre l'équipe Olympus » ou « poste un message dans Hermès »."; }
  else { msg.className = "msg err"; msg.textContent = r.error; }
  refreshClaude();
};

// ══════════ MEDUSA (contrôle de tout Olympus par Claude — vue + diagnostic) ══════════
async function renderMedusa() {
  const d = await window.olympus.medusaDiag();
  const hero = $("mdHero");
  if (d.functional) {
    hero.innerHTML = `<span class="pg-dot ok"></span><div><div class="t">Medusa est fonctionnelle</div><div class="s">Claude peut piloter Olympus et Pegasus. Si les outils <kbd>medusa_*</kbd> n'apparaissent pas encore dans une conversation, redémarre Claude.</div></div>`;
  } else {
    const why = d.checks.find((c) => c.core && !c.ok);
    hero.innerHTML = `<span class="pg-dot err"></span><div><div class="t">Medusa n'est pas fonctionnelle</div><div class="s">${escapeHtml(why ? why.label + " : " + why.detail + (why.fix ? " — " + why.fix : "") : "cause inconnue")}</div></div>`;
  }
  $("mdChecks").innerHTML = d.checks.map((c) => `
    <div class="env-row">
      <div class="st ${c.ok ? "ok" : "miss"}">${c.ok ? "✓" : "!"}</div>
      <div><div class="nm">${escapeHtml(c.label)}${c.core ? "" : ' <span style="color:var(--dim);font-weight:400;font-size:11px;">(optionnel)</span>'}</div>
      <div class="meta">${escapeHtml(c.detail)}${!c.ok && c.fix ? " — " + escapeHtml(c.fix) : ""}</div></div>
    </div>`).join("");
}
document.querySelector('.nav-item[data-page="medusa"]').addEventListener("click", renderMedusa);
$("mdReinstall").onclick = async () => {
  const btn = $("mdReinstall"), msg = $("mdMsg");
  btn.disabled = true; msg.className = "msg"; msg.textContent = "Installation…";
  const r = await window.olympus.medusaInstall();
  btn.disabled = false;
  msg.className = r.ok ? "msg ok" : "msg err";
  msg.textContent = r.ok ? "✅ Medusa (ré)installée. Redémarre Claude pour voir les outils medusa_*." : (r.error || "Échec.");
  renderMedusa();
};
$("mdRecheck").onclick = () => { $("mdMsg").textContent = ""; renderMedusa(); };

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
  const initial = (user.first_name || user.email || "?").charAt(0).toUpperCase();
  $("accName").textContent = name;
  $("accRole").textContent = user.role === "super_admin" ? "super admin" : "membre";
  $("accAvatar").textContent = initial;
  $("profName").textContent = name;
  $("profEmail").textContent = user.email || "";
  $("profRole").textContent = user.role === "super_admin" ? "Super admin — accès complet + gestion des membres." : "Membre — accès aux apps de l'équipe.";
  $("profAvatar").textContent = initial;
  applyRole();
  wheelDate = new Date(); calSelected = isoD(wheelDate.getFullYear(), wheelDate.getMonth(), wheelDate.getDate()); // jour sélectionné = aujourd'hui
  refreshLocks(); refreshEnv(); refreshTitan(); startChat(); renderChronos(); renderWheel(); startPresence(); refreshIris(); refreshClaude(); refreshConnections();
  renderArgos(); renderAtlas(); renderApollon(); renderMnemosyne();   // pré-rendu des apps de l'espace de travail
  if (currentRole === "super_admin") refreshMembers();
  goTo("hermes");
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
