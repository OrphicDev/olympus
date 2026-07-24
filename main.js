"use strict";
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, safeStorage } = require("electron");
const { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync, readdirSync, rmSync, statSync } = require("node:fs");
const { join, basename } = require("node:path");
const anthropic = require("./lib/anthropic");                 // client Claude natif (SDK officiel, indépendant de Zevs)
const { homedir, tmpdir } = require("node:os");
const { createServer } = require("node:http");
const { execFile } = require("node:child_process");
const { randomUUID, privateDecrypt, constants: cryptoConstants, createSign } = require("node:crypto");
const nodemailer = require("nodemailer");

const CFG = JSON.parse(readFileSync(join(__dirname, "app-config.json"), "utf8"));
const PEG = CFG.pegasus;
const KEY_DIR = join(homedir(), ".pegasus");
const KEY_FILE = join(KEY_DIR, "team-key");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    show: false,                 // on n'affiche qu'une fois maximisé → pas de flash de petite fenêtre
    title: "Olympus",
    backgroundColor: "#0a0c12",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "renderer", "index.html"));
  // Ouverture en grand : la fenêtre remplit l'écran dès le lancement.
  win.once("ready-to-show", () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  setAppMenu();
}

// Menu applicatif standard — indispensable pour que Cmd+C/V/X (copier-coller)
// fonctionnent dans les champs de saisie sous macOS.
function setAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    {
      label: "Édition",
      submenu: [
        { role: "undo", label: "Annuler" },
        { role: "redo", label: "Rétablir" },
        { type: "separator" },
        { role: "cut", label: "Couper" },
        { role: "copy", label: "Copier" },
        { role: "paste", label: "Coller" },
        { role: "pasteAndMatchStyle", label: "Coller sans mise en forme" },
        { role: "delete", label: "Supprimer" },
        { role: "selectAll", label: "Tout sélectionner" },
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { role: "reload", label: "Recharger" },
        { role: "toggleDevTools", label: "Outils de développement" },
        { type: "separator" },
        { role: "resetZoom", label: "Taille réelle" },
        { role: "zoomIn", label: "Agrandir" },
        { role: "zoomOut", label: "Réduire" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Plein écran" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Exécute une commande via un shell de login (pour récupérer le PATH de l'utilisateur).
function sh(cmd) {
  return new Promise((resolve) => {
    execFile("/bin/zsh", ["-lc", cmd], { timeout: 8000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim());
    });
  });
}

// ── Détection de l'environnement (Node, Claude Code, WordPress local)
// Mémoïsé pour la durée du process (l'env ne change pas entre deux checks) et les 3 shells de
// login sont lancés EN PARALLÈLE — avant : 3 × ~8s en série à chaque entrée dans le hub.
let _envCheck = null;
ipcMain.handle("env:check", async () => {
  if (_envCheck) return _envCheck;
  const [node, claude, wpNow] = await Promise.all([
    sh("node -v"),
    sh("command -v claude || (test -d ~/.claude && echo ok)"),
    sh("command -v wp-now"),
  ]);
  _envCheck = {
    node: { ok: !!node, detail: node || "non détecté" },
    claude: { ok: !!claude, detail: claude ? "installé" : "non détecté" },
    wp: { ok: !!wpNow, detail: wpNow ? "wp-now installé" : "non installé (optionnel)" },
  };
  return _envCheck;
});

// ── Statut Pegasus (clé installée ?)
ipcMain.handle("pegasus:status", () => ({ installed: existsSync(KEY_FILE) }));

// ── Install Pegasus RÉELLE : code → récupère la clé → écrit ~/.pegasus/team-key
ipcMain.handle("pegasus:install", async (_e, code) => {
  code = String(code || "").trim().toUpperCase();
  if (!code) return { ok: false, error: "Entre ton code d'accès." };

  let res;
  try {
    res = await fetch(`${PEG.supabase_url.replace(/\/$/, "")}/rest/v1/rpc/get_team_key`, {
      method: "POST",
      headers: {
        apikey: PEG.supabase_anon_key,
        Authorization: `Bearer ${PEG.supabase_anon_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_code: code }),
    });
  } catch (e) {
    return { ok: false, error: "Pas de connexion internet ? (" + e.message + ")" };
  }

  const text = await res.text();
  if (!res.ok) {
    let msg = "Code invalide ou révoqué.";
    try { const j = JSON.parse(text); if (j.message) msg = j.message; } catch {}
    return { ok: false, error: msg };
  }

  let teamKey = text.trim();
  try { const p = JSON.parse(teamKey); if (typeof p === "string") teamKey = p; } catch {}
  teamKey = teamKey.trim();

  try {
    const decoded = JSON.parse(Buffer.from(teamKey, "base64").toString("utf8"));
    if (!decoded.supabase_url || !decoded.private_key) throw new Error("incomplet");
  } catch {
    return { ok: false, error: "Clé reçue invalide. Préviens Sacha." };
  }

  try {
    if (!existsSync(KEY_DIR)) mkdirSync(KEY_DIR, { recursive: true });
    chmodSync(KEY_DIR, 0o700);
    writeFileSync(KEY_FILE, teamKey, { mode: 0o600 });
    chmodSync(KEY_FILE, 0o600);
  } catch (e) {
    return { ok: false, error: "Écriture impossible : " + e.message };
  }
  pegEnsureWorkspace(); // crée ~/Pegasus/ à l'installation
  return { ok: true };
});

// ══════════ PEGASUS — espace de travail sur disque (~/Pegasus, un dossier par site) ══════════
const PEG_WORKSPACE = join(homedir(), "Pegasus");
function pegEnsureWorkspace() {
  try {
    mkdirSync(PEG_WORKSPACE, { recursive: true });
    // Un petit repère pour l'utilisateur, écrit une seule fois
    const readme = join(PEG_WORKSPACE, "LISEZ-MOI.txt");
    if (!existsSync(readme)) writeFileSync(readme, "Espace de travail Pegasus — Orphic Agency.\nChaque site/projet a son propre dossier ici.\n");
    return PEG_WORKSPACE;
  } catch { return null; }
}
function pegSlug(s) {
  return String(s || "site").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
}
function pegProjectDir(slug) {
  pegEnsureWorkspace();
  const dir = join(PEG_WORKSPACE, pegSlug(slug));
  mkdirSync(dir, { recursive: true });
  return dir;
}
ipcMain.handle("pegasus:workspace", () => {
  if (!existsSync(KEY_FILE)) return { ok: false, error: "Pegasus non installé." };
  return { ok: true, path: pegEnsureWorkspace() };
});
ipcMain.handle("pegasus:revealFolder", (_e, slug) => {
  const dir = join(PEG_WORKSPACE, pegSlug(slug));
  if (!existsSync(dir)) return { ok: false, error: "Dossier introuvable." };
  shell.showItemInFolder(dir);
  return { ok: true, path: dir };
});
ipcMain.handle("pegasus:folderExists", (_e, slug) => {
  const dir = join(PEG_WORKSPACE, pegSlug(slug));
  return { exists: existsSync(dir), path: dir };
});

// Créer les fichiers d'un nouveau projet : WordPress local OU site sur-mesure
ipcMain.handle("pegasus:scaffold", async (_e, project = {}) => {
  try {
    const slug = pegSlug(project.nom || project.slug);
    const dir = pegProjectDir(slug);
    writeFileSync(join(dir, "project.json"), JSON.stringify({ ...project, slug, created: project.created || Date.now() }, null, 2));

    if (project.type === "wordpress") {
      const zipPath = join(dir, "_wordpress.zip");
      const res = await fetch("https://wordpress.org/latest.zip");
      if (!res.ok) throw new Error(`Téléchargement WordPress ${res.status}`);
      writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
      await new Promise((resolve, reject) =>
        execFile("/usr/bin/ditto", ["-x", "-k", zipPath, dir], (err, _o, stderr) => err ? reject(new Error(String(stderr || err.message))) : resolve()));
      try { rmSync(zipPath); } catch {}
      writeFileSync(join(dir, "README.md"),
        `# ${project.nom || slug}\n\nWordPress local téléchargé dans **./wordpress/**.\n\nPour le lancer en local :\n\n\`\`\`\nnpx @wp-now/wp-now start --path ./wordpress\n\`\`\`\n`);
      return { ok: true, path: dir, slug, kind: "wordpress" };
    }

    // Site sur-mesure : scaffolding classique
    writeFileSync(join(dir, "index.html"),
      `<!doctype html>\n<html lang="fr">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${project.nom || "Nouveau site"}</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <main>\n    <h1>${project.nom || "Nouveau site"}</h1>\n  </main>\n  <script src="main.js"></script>\n</body>\n</html>\n`);
    writeFileSync(join(dir, "styles.css"),
      `:root { color-scheme: dark; }\n* { margin: 0; box-sizing: border-box; }\nbody { min-height: 100vh; display: grid; place-items: center; background: #0a0a0c; color: #f2f2f4; font-family: system-ui, sans-serif; }\nh1 { font-weight: 600; letter-spacing: -.02em; }\n`);
    writeFileSync(join(dir, "main.js"), `// ${project.nom || "Site"} — Orphic\n`);
    writeFileSync(join(dir, "README.md"),
      `# ${project.nom || slug}\n\nSite sur-mesure. Ouvre \`index.html\`, ou branche ton bundler (Vite, Next…).\nStack Orphic conseillée selon le niveau : GSAP + Lenis (N1), + shaders (N2), Blender→R3F (N3-N4).\n`);
    return { ok: true, path: dir, slug, kind: "custom" };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Créer une copie locale d'un site connecté (snapshot via Pegasus, sans FTP)
// Snapshot d'un site (structure + contenus + accueil rendu) — sans FTP
async function pegSnapshot(key) {
  const sites = await pegSites();
  const s = sites[key];
  if (!s) throw new Error("Site inconnu.");
  let health = null, inspect = null, content = null, home = null;
  try { health = await pegCall(key, "GET", "/health", 12000); } catch {}
  try { inspect = await pegCall(key, "GET", "/inspect"); } catch {}
  try { content = await pegCall(key, "GET", "/content"); } catch {}
  try { const res = await fetch(s.base_url, { headers: { "User-Agent": "Olympus-Pegasus/1.0" } }); if (res.ok) home = await res.text(); } catch {}
  return { site: s, structure: { label: s.label, url: s.base_url, username: s.username, health, inspect }, content, home };
}
function pegWriteSnapshot(dir, snap) {
  writeFileSync(join(dir, "site.json"), JSON.stringify({ ...snap.structure, copied: Date.now() }, null, 2));
  if (snap.content) writeFileSync(join(dir, "content.json"), JSON.stringify(snap.content, null, 2));
  if (snap.home) writeFileSync(join(dir, "home.html"), snap.home);
  writeFileSync(join(dir, "README.md"),
    `# ${snap.structure.label} — copie locale\n\nSnapshot pris via Pegasus (**sans FTP**) :\n- \`site.json\` — structure (thème, extensions, permaliens…)\n- \`content.json\` — contenus (pages, articles)\n- \`home.html\` — page d'accueil rendue\n\n⚠️ Ce n'est pas un miroir complet du serveur. Pour un clone total, il faudrait un export hébergeur.\n`);
}

// Télécharger/rafraîchir la copie locale. mode: "overwrite" (place disque) | "version" (garde l'historique)
ipcMain.handle("pegasus:copySite", async (_e, key, mode) => {
  try {
    const snap = await pegSnapshot(key);
    const slug = pegSlug(snap.site.host || key);
    const base = pegProjectDir(slug);
    let dir = base, version = null;
    if (mode === "version") {
      version = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      dir = join(base, "versions", version);
      mkdirSync(dir, { recursive: true });
    }
    pegWriteSnapshot(dir, snap);
    return { ok: true, path: dir, slug, version };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Sauvegardes sur Supabase (filet de sécurité / retour arrière) — table site_backups
const pegTblMissing = (e) => e.status === 404 || /42P01|PGRST205|Could not find the table/i.test(String(e.body || e.message));
async function pegBackupInsert(key, kind, note) {
  const snap = await pegSnapshot(key);
  const row = {
    site_key: key,
    label: snap.structure.label,
    kind: ["manual", "pre-push", "post-push"].includes(kind) ? kind : "manual",
    structure: snap.structure,
    content: snap.content || null,
    home_html: snap.home || null,
    note: note || null,
  };
  const r = await pegSupa("/site_backups", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" } });
  return r && r[0];
}
// Créer un point de restauration (snapshot du site en ligne → Supabase)
ipcMain.handle("pegasus:backup", async (_e, key, kind, note) => {
  try { return { ok: true, backup: await pegBackupInsert(key, kind, note) }; }
  catch (e) { return { ok: false, error: e.message, missing_table: pegTblMissing(e) }; }
});
// Lister les sauvegardes d'un site (métadonnées, sans les gros blobs)
ipcMain.handle("pegasus:backups", async (_e, key) => {
  try {
    const p = new URLSearchParams();
    p.set("select", "id,site_key,label,kind,note,created_at");
    p.set("site_key", `eq.${key}`);
    p.set("order", "created_at.desc");
    p.set("limit", "50");
    return { ok: true, backups: await pegSupa(`/site_backups?${p.toString()}`) };
  } catch (e) { return { ok: false, error: e.message, missing_table: pegTblMissing(e) }; }
});
// Restaurer une sauvegarde → l'écrit en local (prête à re-déployer), sans toucher au site en ligne
ipcMain.handle("pegasus:restore", async (_e, key, backupId) => {
  try {
    const rows = await pegSupa(`/site_backups?id=eq.${Number(backupId)}&select=*`);
    if (!rows || !rows.length) throw new Error("Sauvegarde introuvable.");
    const b = rows[0];
    const slug = pegSlug((b.structure && b.structure.url ? new URL(b.structure.url).hostname.replace(/^www\./, "") : key));
    const stamp = new Date(b.created_at).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = join(pegProjectDir(slug), "restaurations", `${b.kind}-${stamp}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "site.json"), JSON.stringify({ ...(b.structure || {}), restored_from: b.id, backup_date: b.created_at }, null, 2));
    if (b.content) writeFileSync(join(dir, "content.json"), JSON.stringify(b.content, null, 2));
    if (b.home_html) writeFileSync(join(dir, "home.html"), b.home_html);
    writeFileSync(join(dir, "README.md"), `# Restauration — ${b.label || key}\n\nSauvegarde ${b.kind} du ${new Date(b.created_at).toLocaleString("fr-FR")}, restaurée en local.\nPrête à être re-déployée (déploiement à brancher).\n`);
    return { ok: true, path: dir };
  } catch (e) { return { ok: false, error: e.message, missing_table: pegTblMissing(e) }; }
});
// SQL d'installation de la table + lien SQL Editor (cas table absente)
ipcMain.handle("pegasus:backupsSetup", async () => {
  const d = pegTeam();
  let editor = null;
  try { editor = `https://supabase.com/dashboard/project/${new URL(d.supabase_url).hostname.split(".")[0]}/sql/new`; } catch {}
  let sql = null;
  try { sql = readFileSync(join(homedir(), "Projet de développement", "Orphic-Dev", "pegasus", "supabase", "site-backups.sql"), "utf8"); } catch {}
  return { ok: true, editor, sql };
});

// ── Rapports quotidiens : lus depuis Supabase (le plugin de chaque client les y pousse à 18 h Paris)
ipcMain.handle("pegasus:reportsList", async (_e, key) => {
  try {
    const s = (await pegSites())[key];
    if (!s) throw new Error("Site inconnu.");
    const url = s.base_url.replace(/\/$/, "") + "/";
    const p = new URLSearchParams();
    p.set("select", "id,site_url,day,seo,perf,secu,audience,created_at");
    p.set("site_url", `eq.${url}`);
    p.set("order", "day.desc,created_at.desc");
    p.set("limit", "120");
    return { ok: true, reports: await pegSupa(`/reports?${p.toString()}`) };
  } catch (e) { return { ok: false, error: e.message, missing_table: pegTblMissing(e) }; }
});
// SQL d'installation de la table reports + lien SQL Editor (cas table absente)
ipcMain.handle("pegasus:reportsSetup", async () => {
  const d = pegTeam();
  let editor = null;
  try { editor = `https://supabase.com/dashboard/project/${new URL(d.supabase_url).hostname.split(".")[0]}/sql/new`; } catch {}
  let sql = null;
  try { sql = readFileSync(join(homedir(), "Projet de développement", "Orphic-Dev", "pegasus", "supabase", "reports.sql"), "utf8"); } catch {}
  return { ok: true, editor, sql };
});
// Générer le rapport du jour tout de suite (bouton « générer maintenant » / test)
ipcMain.handle("pegasus:reportRunNow", async (_e, key) => {
  try { return { ok: true, data: await pegCall(key, "POST", "/reports/run", 60000) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ── Déploiement : pousser le thème local vers le site en ligne (avec sauvegardes avant/après)
// Trouve le thème custom déployable dans le dossier local du site.
function pegFindTheme(dir) {
  const themesDir = join(dir, "wordpress", "wp-content", "themes");
  if (existsSync(themesDir)) {
    const dirs = readdirSync(themesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("twenty") && !e.name.startsWith("."))
      .map((e) => e.name);
    if (dirs.length === 1) return { name: dirs[0], path: join(themesDir, dirs[0]) };
    if (dirs.length > 1) return { multiple: dirs };
  }
  return null;
}
ipcMain.handle("pegasus:pushInfo", async (_e, key) => {
  try {
    const sites = await pegSites(); const s = sites[key];
    if (!s) throw new Error("Site inconnu.");
    const dir = join(PEG_WORKSPACE, pegSlug(s.host || key));
    if (!existsSync(dir)) return { ok: false, error: "Pas de dossier local pour ce site. Télécharge d'abord une copie ou crée un WordPress local." };
    const theme = pegFindTheme(dir);
    if (!theme) return { ok: false, error: "Aucun thème custom trouvé dans le WordPress local (wordpress/wp-content/themes/). Le déploiement pousse un thème — Pegasus ne fait pas de synchro FTP." };
    if (theme.multiple) return { ok: false, error: `Plusieurs thèmes custom en local (${theme.multiple.join(", ")}). Garde-en un seul.` };
    return { ok: true, theme: theme.name, url: s.base_url, label: s.label };
  } catch (e) { return { ok: false, error: e.message }; }
});
// ── Travailler sur le site : prépare le local (copie si besoin) → lance en local + ouvre Claude Code
function pegTerminal(cmd) {
  // Ouvre une nouvelle fenêtre Terminal.app qui exécute `cmd` (via le shell de login → PATH complet)
  return new Promise((res) => execFile("/usr/bin/osascript", ["-e", `tell application "Terminal" to do script ${JSON.stringify(cmd)}`], () => res()));
}
ipcMain.handle("pegasus:workOn", async (_e, key, prompt) => {
  try {
    const sites = await pegSites(); const s = sites[key];
    if (!s) throw new Error("Site inconnu.");
    const slug = pegSlug(s.host || key);
    const dir = join(PEG_WORKSPACE, slug);
    // 1. Copie locale si le dossier n'existe pas encore
    let copied = false;
    if (!existsSync(dir)) {
      const snap = await pegSnapshot(key);
      mkdirSync(dir, { recursive: true });
      pegWriteSnapshot(dir, snap);
      copied = true;
    }
    // 2. Lancer le site en local + ouvrir le navigateur
    const hasWP = existsSync(join(dir, "wordpress"));
    const indexFile = existsSync(join(dir, "index.html")) ? "index.html" : existsSync(join(dir, "home.html")) ? "home.html" : null;
    let mode;
    if (hasWP) {
      // wp-now sert le WordPress local et ouvre le navigateur lui-même
      await pegTerminal(`cd '${dir}' && npx @wp-now/wp-now start --path wordpress`);
      mode = "wordpress";
    } else if (indexFile) {
      await shell.openExternal("file://" + join(dir, indexFile));
      mode = "static";
    } else {
      mode = "vide";
    }
    // 3. Ouvrir une session Claude Code dans le dossier du projet (avec un prompt de contexte si fourni)
    const p = String(prompt || "").slice(0, 4000);
    await pegTerminal(p ? `cd '${dir}' && claude ${JSON.stringify(p)}` : `cd '${dir}' && claude`);
    return { ok: true, dir, mode, copied };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:push", async (_e, key) => {
  try {
    const sites = await pegSites(); const s = sites[key];
    if (!s) throw new Error("Site inconnu.");
    const dir = join(PEG_WORKSPACE, pegSlug(s.host || key));
    const theme = pegFindTheme(dir);
    if (!theme || theme.multiple) throw new Error("Thème local introuvable ou ambigu.");
    // 1. Sauvegarde AVANT (rollback) — bloquante : pas de déploiement sans filet
    let pre;
    try { pre = await pegBackupInsert(key, "pre-push", `Avant déploiement du thème « ${theme.name} »`); }
    catch (e) { throw new Error("Sauvegarde de sécurité impossible — déploiement annulé : " + (pegTblMissing(e) ? "table de sauvegardes non installée." : e.message)); }
    // 2. Zip du thème puis installation + activation via Pegasus (installeur natif WP)
    const zipPath = join(dir, `_deploy-${theme.name}.zip`);
    try { rmSync(zipPath); } catch {}
    await new Promise((res, rej) => execFile("/usr/bin/ditto", ["-c", "-k", "--keepParent", theme.path, zipPath], (err, _o, se) => err ? rej(new Error(String(se || err.message))) : res()));
    const zipB64 = readFileSync(zipPath).toString("base64");
    try { rmSync(zipPath); } catch {}
    await pegCall(key, "POST", "/theme/install", 90000, { zip_b64: zipB64 });
    await pegCall(key, "POST", "/theme/activate", 30000, { stylesheet: theme.name });
    // 3. Sauvegarde APRÈS (au cas où) — non bloquante
    let post = null;
    try { post = await pegBackupInsert(key, "post-push", `Après déploiement du thème « ${theme.name} »`); } catch {}
    return { ok: true, theme: theme.name, preId: pre && pre.id, postId: post && post.id };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Exécute une commande et rejette en cas d'erreur (pour les étapes d'install Zevs).
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(String(stdout));
    });
  });
}

const ZEVS = CFG.zevs || {};
function zevsAppPath() {
  const inApps = join("/Applications", ZEVS.app_name || "Zevs.app");
  const inHome = join(homedir(), "Applications", ZEVS.app_name || "Zevs.app");
  if (existsSync(inApps)) return inApps;
  if (existsSync(inHome)) return inHome;
  return null;
}

// ── Statut Zevs (app présente ?)
ipcMain.handle("zevs:status", () => ({ installed: !!zevsAppPath() }));

// ── Ouvrir Zevs
ipcMain.handle("zevs:open", () => {
  const p = zevsAppPath();
  if (p) shell.openPath(p);
  return { ok: !!p };
});

// ── Install Zevs : télécharge le dmg → monte → copie l'app → retire la quarantaine
ipcMain.handle("zevs:install", async () => {
  const url = ZEVS.download_url;
  if (!url) return { ok: false, error: "URL de téléchargement absente." };
  const dmg = join(tmpdir(), "Zevs-install.dmg");
  const mnt = join(tmpdir(), "zevs-mnt-" + Date.now());
  const send = (phase, pct) => { if (win) win.webContents.send("zevs:progress", { phase, pct }); };

  // 1) Téléchargement avec progression
  try {
    send("download", 0);
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: "Téléchargement impossible (HTTP " + res.status + "). La release Zevs est-elle publiée ?" };
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body.getReader();
    const chunks = []; let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      if (total) send("download", Math.round((received / total) * 100));
    }
    writeFileSync(dmg, Buffer.concat(chunks));
  } catch (e) {
    return { ok: false, error: "Téléchargement échoué : " + e.message };
  }

  // 2) Montage → copie → détachement
  try {
    send("install", 0);
    mkdirSync(mnt, { recursive: true });
    await run("hdiutil", ["attach", dmg, "-nobrowse", "-noverify", "-mountpoint", mnt]);
    const src = join(mnt, ZEVS.app_name || "Zevs.app");
    if (!existsSync(src)) throw new Error("app introuvable dans le dmg");

    // /Applications si accessible en écriture, sinon ~/Applications
    let dest = "/Applications";
    try { const t = join(dest, ".olympus-w"); writeFileSync(t, ""); await run("rm", ["-f", t]); }
    catch { dest = join(homedir(), "Applications"); mkdirSync(dest, { recursive: true }); }

    const destApp = join(dest, ZEVS.app_name || "Zevs.app");
    await run("rm", ["-rf", destApp]).catch(() => {});
    await run("ditto", [src, destApp]);
    await run("xattr", ["-dr", "com.apple.quarantine", destApp]).catch(() => {});
    send("install", 100);
  } catch (e) {
    return { ok: false, error: "Installation échouée : " + e.message };
  } finally {
    await run("hdiutil", ["detach", mnt, "-force"]).catch(() => {});
    await run("rm", ["-f", dmg]).catch(() => {});
  }
  return { ok: true };
});

// ══════════ TITAN (espace développeur — super admin) ══════════
const TITAN = CFG.titan || {};

// Écriture atomique (tmp + rename) : un crash pendant l'écriture ne peut pas tronquer le
// fichier (sinon loadX retombe silencieusement sur {} et perd tous les réglages/la session).
function writeJsonAtomic(path, obj, opts = {}) {
  const tmp = path + ".tmp";
  try { writeFileSync(tmp, JSON.stringify(obj, opts.pretty === false ? undefined : null, opts.pretty === false ? undefined : 2), opts.mode ? { mode: opts.mode } : undefined); renameSync(tmp, path); return true; }
  catch (e) { console.error("[write] échec", path, ":", e.message); try { rmSync(tmp, { force: true }); } catch {} return false; }
}
// Réglages persistants d'Olympus (emplacement du workspace, etc.)
function settingsPath() { return join(app.getPath("userData"), "olympus-settings.json"); }
function loadSettings() { try { return JSON.parse(readFileSync(settingsPath(), "utf8")); } catch { return {}; } }
function saveSettings(s) { writeJsonAtomic(settingsPath(), s); }

function titanDest() { return loadSettings().titanDest || homedir(); }
function titanWorkspace() { return join(titanDest(), TITAN.workspace || "Orphic-Dev"); }
function titanInstalled() {
  const ws = titanWorkspace();
  if (!existsSync(ws)) return false;
  return (TITAN.repos || []).some((r) => existsSync(join(ws, r.split("/").pop())));
}

ipcMain.handle("titan:status", () => ({
  installed: titanInstalled(),
  workspace: titanWorkspace(),
  dest: titanDest(),
}));

// Choisir le dossier parent où sera créé le workspace « Orphic-Dev »
ipcMain.handle("titan:pickFolder", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Où installer l'espace dev Orphic ?",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Choisir ce dossier",
  });
  if (r.canceled || !r.filePaths[0]) return { dest: titanDest(), workspace: titanWorkspace(), changed: false };
  const s = loadSettings(); s.titanDest = r.filePaths[0]; saveSettings(s);
  return { dest: titanDest(), workspace: titanWorkspace(), changed: true };
});

ipcMain.handle("titan:open", async () => {
  const ws = titanWorkspace();
  if (!existsSync(ws)) return { ok: false };
  // Essaie d'ouvrir le workspace dans l'app Claude, sinon dans le Finder.
  try { await shRun(`open -a "Claude" '${ws}'`); }
  catch { shell.openPath(ws); }
  return { ok: true };
});

// Exécute via un shell de login (PATH complet : gh, npm, node, brew) et rejette sur erreur.
function shRun(cmd) {
  return new Promise((resolve, reject) => {
    execFile("/bin/zsh", ["-lc", cmd], { timeout: 600000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().slice(0, 300)));
      else resolve(String(stdout));
    });
  });
}
const has = async (bin) => !!(await sh("command -v " + bin));

// Repère les dossiers avec un package.json (racine + 1 niveau), hors node_modules.
function findPackageDirs(root) {
  const dirs = [];
  if (existsSync(join(root, "package.json"))) dirs.push(root);
  try {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) {
        const sub = join(root, e.name);
        if (existsSync(join(sub, "package.json"))) dirs.push(sub);
      }
    }
  } catch {}
  return dirs;
}

// TITAN — setup dev complet en un clic : outils → clone → dépendances → carte CLAUDE.md
ipcMain.handle("titan:install", async () => {
  const repos = TITAN.repos || [];
  const ws = titanWorkspace();
  const send = (msg, pct) => { if (win) win.webContents.send("titan:progress", { msg, pct }); };

  // ── 1) Outils requis (git, gh, node) — installe via Homebrew si possible
  send("Vérification des outils (git, gh, Node)…", 3);
  if (!(await has("git"))) return { ok: false, error: "git manquant. Installe les outils Xcode : xcode-select --install" };
  const brew = await has("brew");
  async function ensure(bin, pkg) {
    if (await has(bin)) return true;
    if (brew) { send("Installation de " + bin + " via Homebrew…", 6); try { await shRun("brew install " + pkg); } catch {} return await has(bin); }
    return false;
  }
  if (!(await ensure("gh", "gh"))) return { ok: false, error: "GitHub CLI (gh) requis. Installe Homebrew puis : brew install gh" };
  const nodeOk = await ensure("node", "node");

  // Accès Git : configure git pour pousser via l'authentification gh
  send("Configuration de l'accès Git (push)…", 9);
  try { await shRun("gh auth setup-git"); } catch {}
  // CLI Supabase (best-effort — pour déployer migrations / fonctions)
  if (!(await has("supabase")) && brew) { send("Installation de la CLI Supabase…", 10); try { await shRun("brew install supabase/tap/supabase"); } catch {} }

  // ── 2) Clone des dépôts
  try { mkdirSync(ws, { recursive: true }); } catch (e) { return { ok: false, error: "Workspace impossible : " + e.message }; }
  for (let i = 0; i < repos.length; i++) {
    const name = repos[i].split("/").pop();
    const dest = join(ws, name);
    const pct = 12 + Math.round((i / repos.length) * 33);
    if (!existsSync(dest)) {
      send("Clonage de " + name + "…", pct);
      try { await shRun(`gh repo clone ${repos[i]} '${dest}'`); }
      catch (e) { return { ok: false, error: "Clone de " + name + " échoué : " + e.message }; }
    } else {
      send("Mise à jour de " + name + "…", pct);
      try { await shRun(`git -C '${dest}' pull --ff-only`); } catch {}
    }
  }

  // ── 3) Dépendances (npm install partout où il y a un package.json)
  if (nodeOk) {
    const pkgDirs = [];
    for (const repo of repos) {
      const d = join(ws, repo.split("/").pop());
      if (existsSync(d)) pkgDirs.push(...findPackageDirs(d));
    }
    for (let i = 0; i < pkgDirs.length; i++) {
      const label = pkgDirs[i].replace(ws + "/", "");
      send("Dépendances : " + label + "…", 48 + Math.round((i / Math.max(pkgDirs.length, 1)) * 44));
      try { await shRun(`npm install --prefix '${pkgDirs[i]}' --no-audit --no-fund`); } catch {}
    }
  } else {
    send("Node absent — dépendances ignorées", 92);
  }

  // ── 4) Accès Supabase : on NE copie AUCUN secret. On vérifie juste que la clé Pegasus locale existe
  //     et on pointe Claude vers elle (~/.pegasus/team-key) dans le CLAUDE.md.
  send("Vérification des accès (Supabase)…", 95);
  const supabaseReady = existsSync(join(homedir(), ".pegasus", "team-key"));

  // ── 5) Carte du code pour Claude
  send("Préparation de l'accès Claude…", 97);
  const list = repos.map((r) => `- **${r.split("/").pop()}/** — \`${r}\``).join("\n");
  const claudeMd = `# Orphic-Dev — espace de travail (installé par Titan 🛠️)

Code source de **toutes les apps internes d'Orphic Agency**. Ouvre ce dossier dans Claude Code
pour **scanner, corriger, faire évoluer et déployer** n'importe quelle app.

## Applications
${list}

## Accès accordés (super admin)
- **Git / push** : \`gh\` est authentifié et configuré comme credential helper (\`gh auth setup-git\`).
  Tu peux \`git commit\` puis \`git push\` directement dans chaque dépôt.
- **Supabase** : ${supabaseReady
    ? "les identifiants (URL, clé service, clé anon, clé privée) sont dans `~/.pegasus/team-key` (JSON base64). Décode-le à la volée pour lire/écrire la base et appeler l'API/RPC — **ne les recopie nulle part**."
    : "⚠️ non disponible — installe d'abord Pegasus (clé d'équipe), puis relance Titan."}

## Notes
- Dépendances déjà installées (\`npm install\`).
- Lancer une app Electron en dev : \`cd <app> && npm start\`.
`;
  try { writeFileSync(join(ws, "CLAUDE.md"), claudeMd); } catch {}

  send("Terminé", 100);
  return { ok: true, workspace: ws, supabaseReady };
});

ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));

// ══════════ AUTHENTIFICATION + MEMBRES (projet Supabase Olympus dédié) ══════════
const OLY = CFG.olympus;
const AUTH_BASE = OLY.supabase_url.replace(/\/$/, "");
const AUTH_ANON = OLY.supabase_anon_key;
const ADMIN_FN = OLY.admin_function || `${AUTH_BASE}/functions/v1/admin`;

// Appel de l'Edge Function admin (gestion des membres). La clé service reste côté serveur ;
// useAuth=true envoie le jeton du membre → le serveur vérifie le rôle super_admin.
async function adminCall(action, params = {}, useAuth = true) {
  const send = () => {
    const s = loadSession();
    const bearer = useAuth && s?.access_token ? s.access_token : AUTH_ANON;
    return fetch(ADMIN_FN, {
      method: "POST",
      headers: { apikey: AUTH_ANON, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    });
  };
  let r = await send();
  // 401 = JWT expiré (la passerelle des Edge Functions le renvoie, pas 403) : sans ça, tous les
  // handlers Titan/membres échouaient après ~1h de session au lieu de rafraîchir le jeton.
  if ((r.status === 401 || r.status === 403) && useAuth && (await refreshToken())) r = await send();
  return r.json().catch(() => ({ error: "Réponse invalide." }));
}

// Session persistante (jeton) — fichier local protégé.
function sessionPath() { return join(app.getPath("userData"), "olympus-session.json"); }
function loadSession() { try { return JSON.parse(readFileSync(sessionPath(), "utf8")); } catch { return null; } }
function saveSession(s) { writeJsonAtomic(sessionPath(), s, { pretty: false, mode: 0o600 }); }
function clearSession() { try { writeFileSync(sessionPath(), "{}", { mode: 0o600 }); } catch {} }

ipcMain.handle("auth:session", () => {
  const s = loadSession();
  if (!s || !s.user) return null;
  return { user: s.user, mustReset: !!s.mustReset };
});

ipcMain.handle("auth:login", async (_e, email, password) => {
  email = String(email || "").trim().toLowerCase();
  if (!email || !password) return { ok: false, error: "Email et mot de passe requis." };
  let r;
  try {
    r = await fetch(`${AUTH_BASE}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: AUTH_ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (e) { return { ok: false, error: "Pas de connexion internet ? " + e.message }; }
  const j = await r.json();
  if (!r.ok || !j.access_token) return { ok: false, error: j.error_description || j.msg || "Email ou mot de passe incorrect." };
  const m = j.user?.user_metadata || {};
  const user = { id: j.user.id, email: j.user.email, first_name: m.first_name || "", last_name: m.last_name || "", role: m.role || "classic" };
  saveSession({ user, mustReset: !!m.must_reset_password, access_token: j.access_token, refresh_token: j.refresh_token });
  return { ok: true, user, mustReset: !!m.must_reset_password };
});

ipcMain.handle("auth:setPassword", async (_e, newPassword) => {
  if (!newPassword || String(newPassword).length < 8) return { ok: false, error: "Mot de passe : 8 caractères minimum." };
  const s = loadSession();
  if (!s?.access_token) return { ok: false, error: "Session expirée, reconnecte-toi." };
  let r;
  try {
    r = await fetch(`${AUTH_BASE}/auth/v1/user`, {
      method: "PUT", headers: { apikey: AUTH_ANON, Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword, data: { must_reset_password: false } }),
    });
  } catch (e) { return { ok: false, error: e.message }; }
  if (!r.ok) { const j = await r.json().catch(() => ({})); return { ok: false, error: j.msg || j.error_description || "Échec." }; }
  s.mustReset = false; saveSession(s);
  return { ok: true };
});

ipcMain.handle("auth:logout", () => { clearSession(); return { ok: true }; });

// ── Bootstrap + membres via l'Edge Function admin (clé service jamais exposée à l'app)
ipcMain.handle("auth:needsBootstrap", async () => {
  const r = await adminCall("needsBootstrap", {}, false);
  return { possible: !!r.possible };
});
ipcMain.handle("auth:bootstrap", (_e, d) => adminCall("bootstrap", d || {}, false));
ipcMain.handle("members:list", () => adminCall("list", {}));
ipcMain.handle("members:create", (_e, d) => adminCall("create", d || {}));
ipcMain.handle("members:delete", (_e, id) => adminCall("delete", { id }));
ipcMain.handle("members:resetPassword", (_e, id) => adminCall("resetPassword", { id }));
ipcMain.handle("members:setRole", (_e, id, role) => adminCall("setRole", { id, role }));

// ══════════ Version & mise à jour de l'app (via git — l'app est distribuée par le dépôt Git) ══════════
function gitRun(args) {
  return new Promise((res, rej) => execFile("git", args, { cwd: __dirname, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => err ? rej(new Error(String(stderr || err.message).trim())) : res(String(stdout).trim())));
}
function pkgVersion() { try { return JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")).version || "?"; } catch { return "?"; } }
async function gitBranch() { try { return (await gitRun(["rev-parse", "--abbrev-ref", "HEAD"])) || "main"; } catch { return "main"; } }
ipcMain.handle("app:info", async () => {
  let commit = ""; try { commit = await gitRun(["rev-parse", "--short", "HEAD"]); } catch {}
  return { version: pkgVersion(), commit };
});
ipcMain.handle("app:checkUpdate", async () => {
  try {
    const br = await gitBranch();
    await gitRun(["fetch", "--quiet", "origin", br]);
    const behind = parseInt(await gitRun(["rev-list", "--count", "HEAD..origin/" + br]), 10) || 0;
    let latest = null; try { latest = JSON.parse(await gitRun(["show", "origin/" + br + ":package.json"])).version; } catch {}
    return { ok: true, updateAvailable: behind > 0, behind, current: pkgVersion(), latest };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});
ipcMain.handle("app:doUpdate", async () => {
  try {
    const br = await gitBranch();
    await gitRun(["fetch", "origin", br]);
    await gitRun(["merge", "--ff-only", "origin/" + br]);   // fast-forward only : refuse plutôt que d'écraser des modifs locales
    // Réinstalle les dépendances au cas où package.json a changé (best-effort — ne bloque pas la MAJ si ça échoue).
    try { await new Promise((res, rej) => execFile("npm", ["install", "--no-audit", "--no-fund"], { cwd: __dirname, timeout: 300000, maxBuffer: 32 * 1024 * 1024 }, (e) => e ? rej(e) : res())); } catch {}
    setTimeout(() => { app.relaunch(); app.exit(0); }, 500);  // redémarre sur la nouvelle version
    return { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

// ══════════ HERMÈS (chat d'équipe) ══════════
async function refreshToken() {
  const s = loadSession();
  if (!s?.refresh_token) return false;
  const r = await fetch(`${AUTH_BASE}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: { apikey: AUTH_ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!r.ok) return false;
  const j = await r.json();
  if (!j.access_token) return false;
  s.access_token = j.access_token; if (j.refresh_token) s.refresh_token = j.refresh_token;
  saveSession(s);
  return true;
}
async function authedFetch(path, opts = {}) {
  const tok = () => loadSession()?.access_token;
  const call = (t) => fetch(`${AUTH_BASE}${path}`, { ...opts, headers: { apikey: AUTH_ANON, Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
  let r = await call(tok());
  if (r.status === 401 && (await refreshToken())) r = await call(tok());
  return r;
}

ipcMain.handle("chat:list", async (_e, afterId) => {
  const after = Number(afterId) || 0;
  const r = await authedFetch(`/rest/v1/messages?select=id,user_id,author_name,body,created_at&id=gt.${after}&order=id.asc&limit=300`);
  if (!r.ok) return { ok: false, error: "Chat indisponible (table créée ?)." };
  return { ok: true, messages: await r.json() };
});

ipcMain.handle("chat:send", async (_e, body) => {
  body = String(body || "").trim();
  if (!body) return { ok: false, error: "Message vide." };
  const s = loadSession();
  if (!s?.user) return { ok: false, error: "Non connecté." };
  const author = ((s.user.first_name || "") + " " + (s.user.last_name || "")).trim() || s.user.email;
  const r = await authedFetch(`/rest/v1/messages`, {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: s.user.id, author_name: author, body }),
  });
  if (!r.ok) return { ok: false, error: "Envoi impossible." };
  const arr = await r.json();
  return { ok: true, message: Array.isArray(arr) ? arr[0] : arr };
});

// ══════════ CHRONOS (calendrier / tâches) ══════════
ipcMain.handle("chronos:list", async (_e, from, to) => {
  // chevauchement : date <= to ET (date >= from OU end_date >= from) → capture les events multi-jours
  // Supabase et iCloud sont interrogés EN PARALLÈLE (avant : en série, latences additionnées).
  const [r, apple] = await Promise.all([
    authedFetch(`/rest/v1/events?select=*&date=lte.${to}&or=(date.gte.${from},end_date.gte.${from})&order=date.asc,time.asc.nullsfirst`),
    loadSettings().appleEmail ? getAppleEvents(from, to).catch(() => []) : Promise.resolve([]),
  ]);
  const internal = r.ok ? await r.json() : [];
  if (!r.ok && !apple.length) return { ok: false, error: "Chronos indisponible." };
  // partial:true = les événements internes ont échoué mais on a du Apple — le renderer garde
  // alors son affichage précédent au lieu de peindre un calendrier faussement vide.
  return { ok: true, partial: !r.ok, events: [...internal, ...apple] };
});
// Champs autorisés d'un événement (le brief est fusionné dans l'événement).
const EVENT_FIELDS = ["title", "date", "end_date", "time", "end_time", "category", "assignee", "notes",
  "client", "shoot_type", "participants", "objectives", "moodboard", "attachments",
  "location", "shotlist", "delivery_date", "is_personal", "show_busy"];
function pickEvent(src) {
  const b = {};
  for (const f of EVENT_FIELDS) if (src[f] !== undefined) b[f] = src[f] === "" ? null : src[f];
  return b;
}
// Crée / met à jour / supprime l'événement "Rendu" lié à la date de premier rendu.
async function syncDeliveryEvent(existingId, date, title, userId) {
  if (!date) { if (existingId) await authedFetch(`/rest/v1/events?id=eq.${existingId}`, { method: "DELETE" }); return null; }
  const clean = (title || "").replace(/^Rendu — /, "");
  const payload = { title: "Rendu — " + clean, date, category: "rendu" };
  if (existingId) { await authedFetch(`/rest/v1/events?id=eq.${existingId}`, { method: "PATCH", body: JSON.stringify(payload) }); return existingId; }
  payload.created_by = userId;
  const r = await authedFetch(`/rest/v1/events`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) });
  if (!r.ok) return null;
  const a = await r.json(); return Array.isArray(a) ? a[0].id : a.id;
}
ipcMain.handle("chronos:create", async (_e, ev) => {
  const s = loadSession();
  const body = pickEvent(ev);
  body.created_by = s?.user?.id || null;
  const r = await authedFetch(`/rest/v1/events`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: "Création impossible." };
  const arr = await r.json();
  const event = Array.isArray(arr) ? arr[0] : arr;
  if (ev.delivery_date) {
    const did = await syncDeliveryEvent(null, ev.delivery_date, event.title, body.created_by);
    if (did) { await authedFetch(`/rest/v1/events?id=eq.${event.id}`, { method: "PATCH", body: JSON.stringify({ delivery_event_id: did }) }); event.delivery_event_id = did; }
  }
  return { ok: true, event };
});
ipcMain.handle("chronos:update", async (_e, id, patch) => {
  const body = pickEvent(patch);
  if (patch.done !== undefined) body.done = patch.done;
  if ("delivery_date" in patch) {                 // enregistrement complet depuis la modal
    const g = await authedFetch(`/rest/v1/events?select=delivery_event_id,title&id=eq.${id}`);
    const cur = g.ok ? (await g.json())[0] : null;
    body.delivery_event_id = await syncDeliveryEvent(cur?.delivery_event_id || null, patch.delivery_date, patch.title || cur?.title, loadSession()?.user?.id || null);
  }
  const r = await authedFetch(`/rest/v1/events?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(body) });
  return r.ok ? { ok: true } : { ok: false, error: "Mise à jour impossible." };
});
ipcMain.handle("chronos:delete", async (_e, id) => {
  const g = await authedFetch(`/rest/v1/events?select=delivery_event_id&id=eq.${id}`);
  if (g.ok) { const c = (await g.json())[0]; if (c?.delivery_event_id) await authedFetch(`/rest/v1/events?id=eq.${c.delivery_event_id}`, { method: "DELETE" }); }
  const r = await authedFetch(`/rest/v1/events?id=eq.${id}`, { method: "DELETE" });
  return r.ok ? { ok: true } : { ok: false, error: "Suppression impossible." };
});

// ══════════ PRÉSENCE (qui est en ligne) ══════════
ipcMain.handle("presence:beat", async () => {
  const s = loadSession();
  if (!s?.user) return { ok: false };
  const name = ((s.user.first_name || "") + " " + (s.user.last_name || "")).trim() || s.user.email;
  await authedFetch(`/rest/v1/presence?on_conflict=user_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: s.user.id, name, last_seen: new Date().toISOString() }),
  });
  return { ok: true };
});
ipcMain.handle("presence:online", async () => {
  const r = await authedFetch(`/rest/v1/presence?select=user_id,name,last_seen&order=name.asc`);
  if (!r.ok) return { ok: false, users: [] };
  return { ok: true, users: await r.json() };
});

// ══════════ IRIS (email + CRM) ══════════
function escHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function keychainGet(account) {
  return new Promise((res) => execFile("security", ["find-generic-password", "-a", account, "-s", "OlympusGmail", "-w"], (err, out) => res(err ? null : String(out).trim())));
}
function keychainSet(account, password) {
  return new Promise((res) => execFile("security", ["add-generic-password", "-U", "-a", account, "-s", "OlympusGmail", "-w", password], () => res()));
}

ipcMain.handle("iris:status", async () => {
  const email = loadSettings().gmailEmail || null;
  return { connected: !!email && !!(await keychainGet(email)), email };
});

ipcMain.handle("iris:connect", async (_e, email, appPassword) => {
  email = String(email || "").trim();
  appPassword = String(appPassword || "").replace(/\s+/g, ""); // Google affiche le mdp avec des espaces
  if (!email || !appPassword) return { ok: false, error: "Email et mot de passe d'application requis." };
  try {
    await nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: email, pass: appPassword } }).verify();
  } catch {
    return { ok: false, error: "Connexion Gmail refusée. Vérifie l'email et le mot de passe d'application." };
  }
  const s = loadSettings(); s.gmailEmail = email; saveSettings(s);
  await keychainSet(email, appPassword);
  return { ok: true };
});

ipcMain.handle("iris:disconnect", () => { const s = loadSettings(); delete s.gmailEmail; saveSettings(s); return { ok: true }; });

// ══════════ CHRONOS — calendrier iCloud (CalDAV via tsdav, deux sens) ══════════
let appleClient = null;
function appleKeychainGet(a) { return new Promise((res) => execFile("security", ["find-generic-password", "-a", a, "-s", "OlympusApple", "-w"], (e, o) => res(e ? null : String(o).trim()))); }
function appleKeychainSet(a, p) { return new Promise((res) => execFile("security", ["add-generic-password", "-U", "-a", a, "-s", "OlympusApple", "-w", p], () => res())); }
async function appleMakeClient(email, password) {
  const { DAVClient } = await import("tsdav"); // ESM → import() dynamique
  const client = new DAVClient({ serverUrl: "https://caldav.icloud.com", credentials: { username: email, password }, authMethod: "Basic", defaultAccountType: "caldav" });
  await client.login();
  return client;
}
async function appleGetClient() {
  if (appleClient) return appleClient;
  const email = loadSettings().appleEmail; if (!email) return null;
  const pw = await appleKeychainGet(email); if (!pw) return null;
  try { appleClient = await appleMakeClient(email, pw); return appleClient; } catch { return null; }
}
function appleName(dn) { return typeof dn === "string" ? dn : (dn && (dn._cdata || dn["#text"] || dn.value)) || "Calendrier"; }
function appleCalsLight(cals) {
  return (cals || [])
    .filter((c) => c.url && (!c.components || c.components.includes("VEVENT")))
    .map((c) => ({ url: c.url, name: appleName(c.displayName), color: c.calendarColor || null }));
}
ipcMain.handle("apple:status", async () => {
  const s = loadSettings(); const email = s.appleEmail || null;
  return { ok: true, connected: !!email && !!(await appleKeychainGet(email)), email, calendars: s.appleCalendars || [], sync: s.appleSync || null };
});
ipcMain.handle("apple:connect", async (_e, email, appPassword) => {
  email = String(email || "").trim(); appPassword = String(appPassword || "").replace(/\s+/g, "");
  if (!email || !appPassword) return { ok: false, error: "Identifiant Apple et mot de passe d'application requis." };
  let client;
  try { client = await appleMakeClient(email, appPassword); }
  catch (e) { return { ok: false, error: /401|403|unauthor|credential|principal/i.test(e.message || "") ? "Identifiant Apple ou mot de passe d'application refusé par iCloud. Vérifie l'email et le mot de passe d'application (pas ton mot de passe habituel)." : ("Connexion iCloud échouée : " + String(e.message).slice(0, 140)) }; }
  let cals;
  try { cals = appleCalsLight(await client.fetchCalendars()); }
  catch (e) { return { ok: false, error: "Connecté, mais lecture des calendriers impossible : " + String(e.message).slice(0, 140) }; }
  const s = loadSettings(); s.appleEmail = email; s.appleCalendars = cals; if (!s.appleSync && cals[0]) s.appleSync = cals[0].url; saveSettings(s);
  await appleKeychainSet(email, appPassword);
  appleClient = client; appleInvalidateCache();
  return { ok: true, calendars: cals };
});
ipcMain.handle("apple:setSync", (_e, url) => { const s = loadSettings(); s.appleSync = url; saveSettings(s); return { ok: true }; });
ipcMain.handle("apple:disconnect", () => { const s = loadSettings(); delete s.appleEmail; delete s.appleCalendars; delete s.appleSync; saveSettings(s); appleClient = null; appleInvalidateCache(); return { ok: true }; });

// ── Lecture des événements iCloud (CalDAV → iCal → forme Chronos), avec cache ──
const pad2 = (n) => String(n).padStart(2, "0");
const isoLocalD = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
const hmD = (d) => pad2(d.getHours()) + ":" + pad2(d.getMinutes());
function shiftISO(iso, days) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + days); return isoLocalD(d); }
async function fetchAppleRange(fromISO, toISO) {
  const client = await appleGetClient(); if (!client) return [];
  const cals = loadSettings().appleCalendars || [];
  const start = new Date(fromISO + "T00:00:00"), end = new Date(toISO + "T23:59:59");
  const nical = await import("node-ical");
  const parseICS = (nical.default || nical).sync.parseICS;
  const out = [];
  // Les calendriers sont interrogés EN PARALLÈLE — la version séquentielle multipliait la
  // latence iCloud par le nombre de calendriers (5 chez Sacha) et figeait tout le calendrier.
  const results = await Promise.all(cals.map((cal) =>
    client.fetchCalendarObjects({ calendar: { url: cal.url }, timeRange: { start: start.toISOString(), end: end.toISOString() } })
      .then((objs) => ({ cal, objs })).catch(() => ({ cal, objs: [] }))));
  for (const { cal, objs } of results) {
    for (const o of (objs || [])) {
      if (!o.data) continue;
      let parsed; try { parsed = parseICS(o.data); } catch { continue; }
      for (const key in parsed) {
        const ev = parsed[key];
        if (!ev || ev.type !== "VEVENT" || !ev.start) continue;
        const allDay = ev.datetype === "date";
        const push = (sd, ed) => {
          const e = {
            id: "apple:" + (ev.uid || key) + ":" + isoLocalD(sd),
            title: ev.summary || "(sans titre)",
            date: isoLocalD(sd),
            // Journée entière : DTEND est exclusif → on recule d'UN JOUR CALENDAIRE (pas 24h en
            // millisecondes : le jour du passage à l'heure d'été ne fait que 23h et -86400000
            // retombait deux jours plus tôt, amputant le dernier jour de l'événement).
            end_date: allDay ? isoLocalD(new Date(ed.getFullYear(), ed.getMonth(), ed.getDate() - 1)) : isoLocalD(ed),
            time: allDay ? null : hmD(sd),
            // "end_time" — la clé que lit tout le renderer. L'ancien nom "end" n'était lu nulle
            // part : chaque rendez-vous iCloud s'affichait en bloc d'1h sans heure de fin.
            end_time: allDay ? null : hmD(ed),
            category: "apple", all_day: allDay, source: "apple",
            location: ev.location || null, description: ev.description || null,
            cal_name: cal.name, cal_color: cal.color || null,
            apple_uid: ev.uid || key, apple_cal_url: cal.url, apple_obj_url: o.url, apple_etag: o.etag,
          };
          if (e.end_date < e.date) e.end_date = e.date;
          out.push(e);
        };
        if (ev.rrule) {
          let dates = [];
          try { dates = ev.rrule.between(start, end, true); } catch {}
          const durMs = ((ev.end ? ev.end.getTime() : ev.start.getTime()) - ev.start.getTime()) || 0;
          // Occurrences supprimées (EXDATE) et occurrences déplacées (RECURRENCE-ID) : sans ce
          // filtre, un rendez-vous récurrent annulé un jour donné s'affichait quand même.
          const exdates = new Set(Object.keys(ev.exdate || {}));
          const overrides = ev.recurrences || {};
          for (const d0 of dates.slice(0, 80)) {
            // Compensation DST recommandée par node-ical : rrule.between renvoie des instants
            // décalés d'1h de l'autre côté d'un changement d'heure.
            const d = new Date(d0.getTime() + (d0.getTimezoneOffset() - ev.start.getTimezoneOffset()) * 60000);
            const dayKey = d.toISOString().slice(0, 10);
            if (exdates.has(dayKey)) continue;
            const ov2 = overrides[dayKey];
            if (ov2 && ov2.start) { push(ov2.start, ov2.end || new Date(ov2.start.getTime() + durMs)); continue; }
            push(d, new Date(d.getTime() + durMs));
          }
        } else {
          push(ev.start, ev.end || ev.start);
        }
      }
    }
  }
  return out;
}
let appleEvCache = { events: [], from: null, to: null, at: 0 };
let appleFetchInFlight = null;
function appleInvalidateCache() { appleEvCache = { events: [], from: null, to: null, at: 0 }; appleFetchInFlight = null; }
function appleNotifyRenderer() { try { const w = BrowserWindow.getAllWindows()[0]; if (w) w.webContents.send("chronos:appleRefreshed"); } catch {} }
// Stale-while-revalidate (même principe que le cache Argos) : un cache périmé est servi
// IMMÉDIATEMENT pendant qu'un refetch tourne en tâche de fond — avant, tout le calendrier se
// figeait plusieurs secondes à chaque expiration du TTL (3 min) le temps de l'aller-retour iCloud.
async function getAppleEvents(fromISO, toISO) {
  const now = Date.now();
  const inWindow = appleEvCache.from && appleEvCache.from <= fromISO && appleEvCache.to >= toISO;
  const fresh = inWindow && (now - appleEvCache.at) < 180000;
  const slice = () => appleEvCache.events.filter((e) => e.date <= toISO && (e.end_date || e.date) >= fromISO);
  const refetch = () => {
    if (appleFetchInFlight) return appleFetchInFlight;      // dédup : un seul fetch CalDAV à la fois
    const wFrom = shiftISO(fromISO, -31), wTo = shiftISO(toISO, 62);
    appleFetchInFlight = fetchAppleRange(wFrom, wTo)
      .then((events) => { appleEvCache = { events, from: wFrom, to: wTo, at: Date.now() }; })
      .catch(() => {})                                      // échec : on GARDE l'ancien cache (les événements ne disparaissent pas)
      .finally(() => { appleFetchInFlight = null; });
    return appleFetchInFlight;
  };
  if (fresh) return slice();
  if (inWindow) { refetch().then(appleNotifyRenderer); return slice(); } // périmé mais couvrant : stale tout de suite, refresh en fond
  await refetch();                                          // hors fenêtre (navigation lointaine) : on doit attendre
  return slice();
}
ipcMain.handle("apple:refresh", () => { appleInvalidateCache(); return { ok: true }; });

// Libellés Gmail via IMAP (un libellé = une boîte IMAP) — synchro réelle dans les deux sens.
async function gmailImap() {
  const email = loadSettings().gmailEmail; if (!email) return null;
  const pass = await keychainGet(email); if (!pass) return null;
  const { ImapFlow } = require("imapflow");
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: email, pass }, logger: false });
  await c.connect();
  return c;
}
ipcMain.handle("iris:labels", async () => {
  try {
    const c = await gmailImap();
    if (!c) return { ok: false, error: "Gmail non connecté." };
    const boxes = await c.list();
    await c.logout();
    // Dossiers système = INBOX et [Gmail]/… ; tout le reste = libellés créés par l'utilisateur.
    const labels = boxes.filter((b) => b.path !== "INBOX" && !b.path.startsWith("[Gmail]")).map((b) => b.path);
    return { ok: true, labels };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle("iris:createLabel", async (_e, name) => {
  name = String(name || "").trim();
  if (!name) return { ok: false, error: "Nom requis." };
  try {
    const c = await gmailImap();
    if (!c) return { ok: false, error: "Gmail non connecté." };
    await c.mailboxCreate(name.split("/"));               // « Clients/SBM/Marlow » → libellé imbriqué Gmail
    await c.logout();
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle("iris:send", async (_e, d) => {
  const email = loadSettings().gmailEmail;
  if (!email) return { ok: false, error: "Gmail non connecté." };
  const pass = await keychainGet(email);
  if (!pass) return { ok: false, error: "Mot de passe d'application introuvable, reconnecte Gmail." };
  const { to, toName, subject, body } = d || {};
  if (!to || !subject || !body) return { ok: false, error: "Destinataire, sujet et message requis." };
  const trackingId = randomUUID();
  const pixel = `<img src="${AUTH_BASE}/functions/v1/track?t=${trackingId}" width="1" height="1" alt="" style="display:none">`;
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#222;white-space:pre-wrap">${escHtml(body)}</div>${pixel}`;
  const s = loadSession();
  const sentByName = s?.user ? (((s.user.first_name || "") + " " + (s.user.last_name || "")).trim() || s.user.email) : email;
  try {
    await nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: email, pass } })
      .sendMail({ from: `${sentByName} <${email}>`, to, subject, html });
  } catch (e) {
    return { ok: false, error: "Envoi échoué : " + e.message };
  }
  await authedFetch(`/rest/v1/emails`, { method: "POST", body: JSON.stringify({ tracking_id: trackingId, to_email: to, to_name: toName || null, subject, preview: String(body).slice(0, 140), sent_by: s?.user?.id || null, sent_by_name: sentByName }) });
  await authedFetch(`/rest/v1/contacts?on_conflict=email`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ email: to, name: toName || null, created_by: s?.user?.id || null }) });
  return { ok: true };
});

ipcMain.handle("crm:emails", async () => {
  const r = await authedFetch(`/rest/v1/emails?select=*&order=sent_at.desc&limit=100`);
  return r.ok ? { ok: true, emails: await r.json() } : { ok: false, emails: [] };
});
ipcMain.handle("crm:contacts", async () => {
  const r = await authedFetch(`/rest/v1/contacts?select=*&order=created_at.desc&limit=200`);
  return r.ok ? { ok: true, contacts: await r.json() } : { ok: false, contacts: [] };
});

// ══════════ CONTRÔLE PAR CLAUDE CODE (serveur MCP one-clic) ══════════
// ══════════ MEDUSA — MCP de contrôle de Pegasus, installé avec Olympus ══════════
// À chaque lancement : copie du serveur (auto-update) + enregistrement dans
// Claude Code s'il ne l'est pas déjà. Silencieux — l'état est consultable aux Réglages.
const medusaDest = () => join(homedir(), ".olympus", "medusa-mcp.mjs");
let medusaState = { file: false, registered: false, error: null };
// Enregistre Medusa dans ~/.claude.json (portée user) — ce que fait `claude mcp add -s user`,
// mais sans dépendre de la CLI (absente du PATH quand Claude Code est utilisé en app desktop).
function medusaRegisterDirect() {
  const cfgPath = join(homedir(), ".claude.json");
  let raw = null;
  try { raw = readFileSync(cfgPath, "utf8"); } catch {}
  let cfg;
  try { cfg = raw ? JSON.parse(raw) : {}; }
  catch (e) { throw new Error("~/.claude.json illisible — enregistrement annulé (" + e.message + ")"); }
  const want = { command: "node", args: [medusaDest()] };
  const cur = cfg.mcpServers && cfg.mcpServers.medusa;
  if (cur && cur.command === want.command && Array.isArray(cur.args) && cur.args[0] === want.args[0]) return; // déjà enregistré
  if (raw) { try { writeFileSync(cfgPath + ".medusa-bak", raw); } catch {} } // filet avant toute écriture
  cfg.mcpServers = { ...(cfg.mcpServers || {}), medusa: want };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}
async function medusaEnsure() {
  try {
    mkdirSync(join(homedir(), ".olympus"), { recursive: true });
    writeFileSync(medusaDest(), readFileSync(join(__dirname, "medusa-mcp", "server.mjs"), "utf8"));
    medusaState.file = true;
  } catch (e) { medusaState.error = "Écriture impossible : " + e.message; return medusaState; }
  if (await has("claude")) {
    // Voie CLI si disponible
    try { await shRun("claude mcp get medusa"); medusaState.registered = true; }
    catch {
      try { await shRun(`claude mcp add -s user medusa -- node '${medusaDest()}'`); medusaState.registered = true; }
      catch (e) { medusaState.error = "Enregistrement échoué : " + e.message; }
    }
  } else {
    // App desktop : écriture directe de la config user
    try { medusaRegisterDirect(); medusaState.registered = true; }
    catch (e) { medusaState.error = e.message; }
  }
  if (medusaState.registered) medusaState.error = null;
  return medusaState;
}
ipcMain.handle("medusa:status", () => ({ ...medusaState, installed: medusaState.file && medusaState.registered }));
ipcMain.handle("medusa:install", async () => {
  const st = await medusaEnsure();
  return { ok: st.file && st.registered, ...st };
});
// Diagnostic complet : POURQUOI Medusa fonctionne ou pas (pour la vue Medusa)
ipcMain.handle("medusa:diag", async () => {
  const checks = [];
  const nodeV = await sh("node -v");
  checks.push({ id: "node", core: true, ok: !!nodeV, label: "Node.js", detail: nodeV ? "présent (" + nodeV + ")" : "introuvable — Claude Code en a besoin pour lancer Medusa", fix: nodeV ? null : "Installe Node.js (nodejs.org), puis relance Olympus." });
  const cli = await has("claude");
  const appDesktop = existsSync("/Applications/Claude.app");
  const cfgExists = existsSync(join(homedir(), ".claude.json"));
  const claudeOk = cli || appDesktop || cfgExists;
  checks.push({ id: "claude", core: true, ok: claudeOk, label: "Claude installé sur cet ordinateur", detail: cli ? "CLI `claude` détectée" : appDesktop ? "app desktop détectée (/Applications/Claude.app)" : cfgExists ? "configuration Claude Code détectée (~/.claude.json)" : "aucune trace de Claude sur ce Mac", fix: claudeOk ? null : "Installe Claude (claude.ai/download) ou Claude Code, puis relance Olympus." });
  let fileOk = false, upToDate = false;
  try {
    const cur = readFileSync(medusaDest(), "utf8");
    fileOk = true;
    upToDate = cur === readFileSync(join(__dirname, "medusa-mcp", "server.mjs"), "utf8");
  } catch {}
  checks.push({ id: "file", core: true, ok: fileOk, label: "Serveur Medusa en place", detail: fileOk ? (upToDate ? "~/.olympus/medusa-mcp.mjs — présent et à jour" : "présent (une mise à jour sera posée au prochain lancement)") : "~/.olympus/medusa-mcp.mjs absent", fix: fileOk ? null : "Clique « Réinstaller Medusa » ci-dessous." });
  let reg = false, regDetail = "Medusa n'est pas déclaré dans Claude Code";
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
    const m = cfg.mcpServers && cfg.mcpServers.medusa;
    if (m && Array.isArray(m.args) && m.args[0] === medusaDest()) { reg = true; regDetail = "déclaré dans ~/.claude.json (portée user)"; }
    else if (m) { reg = true; regDetail = "déclaré, mais vers un autre chemin — réinstalle pour corriger"; }
  } catch {}
  checks.push({ id: "registered", core: true, ok: reg, label: "MCP enregistré dans Claude Code", detail: regDetail, fix: reg ? null : "Clique « Réinstaller Medusa » (écrit l'entrée medusa dans ~/.claude.json)." });
  const keyOk = existsSync(KEY_FILE);
  checks.push({ id: "pegasus", core: false, ok: keyOk, label: "Clé d'équipe Pegasus", detail: keyOk ? "présente — parc, sauvegardes, déploiement et bibliothèque actifs" : "absente — les outils Pegasus renverront une erreur", fix: keyOk ? null : "Installe Pegasus depuis Alexandrie (code d'accès)." });
  const sessOk = existsSync(join(app.getPath("userData"), "olympus-session.json"));
  checks.push({ id: "session", core: false, ok: sessOk, label: "Session Olympus", detail: sessOk ? "connectée — chat, calendrier, CRM et équipe actifs" : "absente — les outils espace de travail renverront une erreur", fix: sessOk ? null : "Connecte-toi à Olympus." });
  const functional = checks.filter((c) => c.core).every((c) => c.ok);
  return { functional, checks, dest: medusaDest() };
});

function mcpDest() { return join(homedir(), ".olympus", "mcp-server.mjs"); }
ipcMain.handle("claude:status", () => ({ installed: existsSync(mcpDest()) }));
ipcMain.handle("claude:install", async () => {
  if (!(await has("claude"))) return { ok: false, error: "Claude Code introuvable (commande `claude`). Ouvre/installe Claude Code puis réessaie." };
  const dst = mcpDest();
  try {
    mkdirSync(join(homedir(), ".olympus"), { recursive: true });
    writeFileSync(dst, readFileSync(join(__dirname, "olympus-mcp", "server.mjs"), "utf8"));
  } catch (e) { return { ok: false, error: "Écriture du serveur impossible : " + e.message }; }
  try {
    await shRun(`claude mcp remove -s user olympus 2>/dev/null; claude mcp add -s user olympus -- node '${dst}'`);
  } catch (e) { return { ok: false, error: "Enregistrement dans Claude Code échoué : " + e.message }; }
  return { ok: true };
});

// ══════════ PEGASUS — le parc de sites + la bibliothèque Orphic ══════════
// Tout passe par la clé d'équipe (~/.pegasus/team-key). Les mots de passe des
// sites sont déchiffrés ICI (main) et ne sont JAMAIS envoyés au renderer.
function pegTeam() {
  try { return JSON.parse(Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "base64").toString("utf8")); }
  catch { return null; }
}
async function pegSupa(path, opts = {}) {
  const d = pegTeam();
  if (!d || !d.supabase_url || !d.supabase_service_key) throw new Error("Clé Pegasus absente — installe Pegasus d'abord.");
  const r = await fetch(`${d.supabase_url.replace(/\/$/, "")}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: d.supabase_service_key,
      Authorization: `Bearer ${d.supabase_service_key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`Supabase ${r.status} : ${text.slice(0, 200)}`); e.status = r.status; e.body = text; throw e; }
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

// Registre des sites, mots de passe déchiffrés (cache 30 s). Réservé au main.
let _pegSites = { at: 0, sites: {} };
async function pegSites() {
  if (Date.now() - _pegSites.at < 30000) return _pegSites.sites;
  const d = pegTeam();
  if (!d || !d.private_key) throw new Error("Clé Pegasus absente — installe Pegasus d'abord.");
  const rows = await pegSupa("/sites?select=*&order=id.desc");
  const sites = {};
  for (const row of rows) {
    const host = new URL(row.site_url).hostname.replace(/^www\./, "");
    const key = host.split(".")[0].toLowerCase();
    if (sites[key]) continue; // tri id desc → la ligne la plus récente gagne
    let pass;
    try {
      pass = privateDecrypt(
        { key: d.private_key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(row.app_password_enc, "base64")
      ).toString("utf8");
    } catch { continue; }
    sites[key] = { key, label: row.label || host, host, base_url: row.site_url.replace(/\/$/, ""), username: row.username, created_at: row.created_at, pass };
  }
  _pegSites = { at: Date.now(), sites };
  return sites;
}
// Appel signé à l'API pegasus/v1 d'un site (?rest_route= : passe quels que soient les permaliens).
async function pegCall(key, method, path, timeoutMs = 20000, body) {
  const s = (await pegSites())[key];
  if (!s) throw new Error(`Site inconnu : ${key}`);
  const basic = Buffer.from(`${s.username}:${s.pass.replace(/\s+/g, "")}`).toString("base64");
  const [p, qs] = path.split("?");
  const url = `${s.base_url}/?rest_route=/pegasus/v1${p}` + (qs ? `&${qs}` : "");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      headers: { Authorization: `Basic ${basic}`, "X-Pegasus-Auth": basic, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    if (!r.ok) throw new Error(`Pegasus ${r.status} : ${data?.message || data?.code || text.slice(0, 150)}`);
    return data;
  } finally { clearTimeout(t); }
}

// Conservé pour compat (ancienne liste simple)
ipcMain.handle("pegasus:clients", async () => {
  try {
    const sites = await pegSites();
    return { ok: true, clients: Object.values(sites).map(({ pass, ...s }) => ({ site_url: s.base_url, username: s.username, label: s.label, created_at: s.created_at })) };
  } catch (e) { return { ok: false, error: e.message, clients: [] }; }
});

// ── Le parc : sites (sans secrets), santé, structure, SEO
ipcMain.handle("pegasus:sites", async () => {
  try {
    const sites = await pegSites();
    return { ok: true, sites: Object.values(sites).map(({ pass, ...s }) => s) };
  } catch (e) { return { ok: false, error: e.message, sites: [] }; }
});
ipcMain.handle("pegasus:siteHealth", async (_e, key) => {
  try { return { ok: true, health: await pegCall(key, "GET", "/health", 12000) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:siteInspect", async (_e, key) => {
  try { return { ok: true, inspect: await pegCall(key, "GET", "/inspect") }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Diagnostic complet (verrous serveur, capacités, page builder, multilingue, collisions)
ipcMain.handle("pegasus:siteDiag", async (_e, key) => {
  try { return { ok: true, diag: await pegCall(key, "GET", "/diagnostic", 30000) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ── Historique des métriques (SEO / Performance / Sécurité) : séries dans le temps
// pour les tableaux de bord et les rapports. Stocké dans <site>/metrics.json ──
async function pegMetricsPath(key) { return join(await pegSiteDir(key), "metrics.json"); }
ipcMain.handle("pegasus:metricsGet", async (_e, key) => {
  try {
    const p = await pegMetricsPath(key);
    if (!existsSync(p)) return { ok: true, metrics: { seo: [], perf: [], secu: [] } };
    const m = JSON.parse(readFileSync(p, "utf8"));
    return { ok: true, metrics: { seo: m.seo || [], perf: m.perf || [], secu: m.secu || [] } };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Ajoute un point de mesure daté à une série (seo|perf|secu). Dédupe si < 5 min.
ipcMain.handle("pegasus:metricsAppend", async (_e, key, kind, point) => {
  try {
    if (!["seo", "perf", "secu"].includes(kind)) throw new Error("Série inconnue.");
    const p = await pegMetricsPath(key);
    const m = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
    m.seo = m.seo || []; m.perf = m.perf || []; m.secu = m.secu || [];
    const now = new Date().toISOString();
    const arr = m[kind];
    const last = arr[arr.length - 1];
    if (last && new Date(now) - new Date(last.ts) < 5 * 60 * 1000) arr[arr.length - 1] = { ts: now, ...point };
    else arr.push({ ts: now, ...point });
    if (arr.length > 500) arr.splice(0, arr.length - 500);
    writeFileSync(p, JSON.stringify(m, null, 2));
    return { ok: true, count: arr.length };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Audience (Google Analytics 4 + Search Console) via COMPTE DE SERVICE ──
// Connexion Google par OAUTH (compte agence) : identifiants « client OAuth » posés
// UNE fois dans ~/.pegasus/google-oauth.json ; le dev autorise dans le navigateur
// (boucle locale) ; le refresh_token est gardé dans les réglages. Par site :
// analytics.json { ga4Property, scUrl }. Le compte Google connecté doit avoir accès
// aux propriétés GA4 / Search Console des clients.
const http = require("node:http");
const PEG_GOOGLE_OAUTH = join(homedir(), ".pegasus", "google-oauth.json");
const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";
function pegOAuthCreds() {
  if (!existsSync(PEG_GOOGLE_OAUTH)) throw new Error("Identifiants OAuth Google absents (~/.pegasus/google-oauth.json).");
  const j = JSON.parse(readFileSync(PEG_GOOGLE_OAUTH, "utf8"));
  const c = j.installed || j.web || j;
  if (!c.client_id || !c.client_secret) throw new Error("Fichier OAuth invalide (client_id / client_secret manquants).");
  return c;
}
// Ouvre le navigateur sur l'écran de consentement Google + attend le retour sur une boucle locale
function pegGoogleAuthCode(clientId) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      const code = u.searchParams.get("code"), err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset=utf-8><body style="font-family:system-ui;text-align:center;padding:60px;background:#111;color:#eee"><h2 style="color:#8fd6a6">${err ? "Autorisation refusée" : "Connexion Google réussie ✓"}</h2><p>Tu peux fermer cet onglet et revenir à Olympus.</p></body>`);
      server.close();
      if (err) return reject(new Error("Autorisation refusée : " + err));
      if (!code) return reject(new Error("Aucun code reçu."));
      resolve({ code, redirect: server._redir });
    });
    server.listen(0, "127.0.0.1", () => {
      const redirect = `http://127.0.0.1:${server.address().port}`;
      server._redir = redirect;
      const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: "code",
        scope: GOOGLE_SCOPES, access_type: "offline", prompt: "consent",
      });
      shell.openExternal(url);
    });
    setTimeout(() => { try { server.close(); } catch {} reject(new Error("Délai dépassé — autorisation non terminée dans le navigateur.")); }, 180000);
  });
}
let _gAccess = null;
async function pegGoogleAccessToken() {
  if (_gAccess && _gAccess.exp - 60000 > Date.now()) return _gAccess.token;
  const cr = pegOAuthCreds();
  const rt = loadSettings().googleOAuth?.refresh_token;
  if (!rt) throw new Error("Non connecté à Google.");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cr.client_id, client_secret: cr.client_secret, refresh_token: rt, grant_type: "refresh_token" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("Reconnexion Google échouée : " + (j.error_description || j.error || "reconnecte-toi"));
  _gAccess = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}
async function pegAnalyticsCfg(key) {
  const p = join(await pegSiteDir(key), "analytics.json");
  return { path: p, cfg: existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {} };
}
// Audience mesurée par le traqueur Pegasus (route /audience du plugin) — sans Google
ipcMain.handle("pegasus:audiencePegasus", async (_e, key, days) => {
  try { return { ok: true, data: await pegCall(key, "GET", `/audience?days=${Math.max(1, Math.min(365, days || 30))}`, 20000) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:audienceReset", async (_e, key) => {
  try { return { ok: true, data: await pegCall(key, "POST", "/audience/reset", 20000) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ══════════ ÉOLE — transfert de fichiers (WeTransfer interne, Supabase Olympus) ══════════
// Fichiers zippés → Storage privé du projet Olympus → URL signée (1 mois). Auth = session
// connectée (authedFetch), zéro nouveau projet / service key. Le destinataire n'a besoin
// que du lien signé (aucune authentification).
const EOLE_BUCKET = "transfers";
ipcMain.handle("eole:status", () => ({ ok: true, signedIn: !!loadSession()?.access_token }));
ipcMain.handle("eole:setupSql", () => {
  let editor = null; try { editor = `https://supabase.com/dashboard/project/${new URL(AUTH_BASE).hostname.split(".")[0]}/sql/new`; } catch {}
  let sql = null; try { sql = readFileSync(join(__dirname, "config", "eole.sql"), "utf8"); } catch {}
  return { ok: true, sql, editor };
});
ipcMain.handle("eole:pick", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Fichiers à envoyer", buttonLabel: "Choisir", properties: ["openFile", "multiSelections"] });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  const files = r.filePaths.map((p) => ({ path: p, name: basename(p), size: statSync(p).size }));
  return { ok: true, files, totalSize: files.reduce((n, f) => n + f.size, 0) };
});
ipcMain.handle("eole:send", async (_e, payload) => {
  let tmp = null;
  try {
    const { paths, title, note, days } = payload || {};
    if (!paths || !paths.length) throw new Error("Aucun fichier sélectionné.");
    const s = loadSession();
    if (!s?.access_token) throw new Error("Connecte-toi pour envoyer des fichiers.");
    const id = randomUUID();
    const objectPath = `${id}.zip`;
    // 1. Zip à plat des fichiers choisis
    tmp = join(tmpdir(), `eole-${id}.zip`);
    await new Promise((res, rej) => execFile("/usr/bin/zip", ["-j", "-q", tmp, ...paths], { maxBuffer: 16 * 1024 * 1024 }, (e) => e ? rej(new Error("Compression : " + e.message)) : res()));
    const bytes = readFileSync(tmp);
    // 2. Upload dans le Storage privé
    const up = await authedFetch(`/storage/v1/object/${EOLE_BUCKET}/${objectPath}`, { method: "POST", headers: { "Content-Type": "application/zip", "x-upsert": "true" }, body: bytes });
    if (!up.ok) throw new Error("Upload : " + (await up.text()).slice(0, 200));
    // 3. URL signée (jusqu'à 1 mois)
    const ttl = Math.min(366, Math.max(1, days || 30)) * 86400;
    const sg = await authedFetch(`/storage/v1/object/sign/${EOLE_BUCKET}/${objectPath}`, { method: "POST", body: JSON.stringify({ expiresIn: ttl }) });
    const sj = await sg.json().catch(() => ({}));
    const rel = sj.signedURL || sj.signedUrl;
    if (!sg.ok || !rel) throw new Error("Lien : " + JSON.stringify(sj).slice(0, 150));
    const signed = AUTH_BASE + "/storage/v1" + rel;
    // 4. Ligne de transfert
    const files = paths.map((p) => ({ name: basename(p), size: statSync(p).size }));
    const row = { id, title: title || null, note: note || null, files, object_path: objectPath, size_total: bytes.length, signed_url: signed, created_by: s.user?.name || s.user?.email || null, expires_at: new Date(Date.now() + ttl * 1000).toISOString() };
    const ins = await authedFetch(`/rest/v1/transfers`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!ins.ok) throw new Error("Enregistrement : " + (await ins.text()).slice(0, 200));
    return { ok: true, transfer: (await ins.json())[0] };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { if (tmp) try { rmSync(tmp, { force: true }); } catch {} }
});
ipcMain.handle("eole:list", async () => {
  try {
    const r = await authedFetch(`/rest/v1/transfers?select=*&order=created_at.desc&limit=100`);
    if (!r.ok) { const t = await r.text(); return { ok: false, error: t.slice(0, 200), missing_table: /relation|PGRST205|does not exist|not find the table/i.test(t) }; }
    const rows = await r.json();
    const now = Date.now();
    for (const x of rows.filter((x) => new Date(x.expires_at).getTime() < now)) {
      try { await authedFetch(`/storage/v1/object/${EOLE_BUCKET}/${x.object_path}`, { method: "DELETE" }); await authedFetch(`/rest/v1/transfers?id=eq.${x.id}`, { method: "DELETE" }); } catch {}
    }
    return { ok: true, transfers: rows.filter((x) => new Date(x.expires_at).getTime() >= now) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("eole:delete", async (_e, id, objectPath) => {
  try {
    if (objectPath) await authedFetch(`/storage/v1/object/${EOLE_BUCKET}/${objectPath}`, { method: "DELETE" });
    await authedFetch(`/rest/v1/transfers?id=eq.${id}`, { method: "DELETE" });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ══════════ HERMÈS — WhatsApp perso (Baileys, WhatsApp Web multi-appareils) ══════════
// Connexion par QR (comme WhatsApp Web). Auth persistée dans ~/.olympus/whatsapp.
// Store en mémoire (chats/contacts/messages) car Baileys ne stocke rien lui-même.
const WA_DIR = join(homedir(), ".olympus", "whatsapp");
let waSock = null, waState = "disconnected", waQR = null, waMe = null;
const waStore = { chats: new Map(), contacts: new Map(), messages: new Map() };
function waPush(p) { try { win && win.webContents.send("wa:event", p); } catch {} }
function waChatName(jid) {
  if (!jid) return "";
  const c = waStore.chats.get(jid); if (c && c.name) return c.name;
  const ct = waStore.contacts.get(jid); if (ct && (ct.name || ct.notify)) return ct.name || ct.notify;
  if (jid.endsWith("@g.us")) return "Groupe";
  return "+" + jid.split("@")[0];
}
function waText(m) {
  const x = m.message || {};
  return x.conversation || x.extendedTextMessage?.text || x.imageMessage?.caption || x.videoMessage?.caption
    || (x.imageMessage ? "📷 Photo" : x.videoMessage ? "🎥 Vidéo" : x.audioMessage ? "🎤 Message vocal" : x.documentMessage ? "📎 " + (x.documentMessage.fileName || "Document") : x.stickerMessage ? "🌟 Sticker" : x.locationMessage ? "📍 Position" : x.contactMessage ? "👤 Contact" : "");
}
function waStoreMsg(m) {
  const jid = m.key && m.key.remoteJid; if (!jid || jid === "status@broadcast" || jid.endsWith("@broadcast")) return;
  const arr = waStore.messages.get(jid) || [];
  if (!arr.some((y) => y.key && y.key.id === m.key.id)) {
    arr.push(m); arr.sort((a, b) => (+a.messageTimestamp || 0) - (+b.messageTimestamp || 0));
    if (arr.length > 250) arr.splice(0, arr.length - 250);
    waStore.messages.set(jid, arr);
  }
  const c = waStore.chats.get(jid) || { id: jid };
  c.conversationTimestamp = Math.max(+c.conversationTimestamp || 0, +m.messageTimestamp || 0);
  c.lastText = waText(m); c.lastFromMe = !!(m.key && m.key.fromMe);
  if (!c.name) c.name = waChatName(jid);
  waStore.chats.set(jid, c);
}
let waConnecting = null;
function waConnect() {
  if (waSock) return Promise.resolve();
  if (waConnecting) return waConnecting;                    // verrou synchrone : le garde `if (waSock)`
  return waConnecting = waConnectInner().finally(() => { waConnecting = null; }); // était après les await → 2 sockets possibles
}
async function waConnectInner() {
  const baileys = await import("@whiskeysockets/baileys"); // Baileys 7 = ESM → import() dynamique
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, Browsers } = baileys;
  mkdirSync(WA_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(WA_DIR);
  waState = "connecting"; waPush({ type: "status", state: waState });
  waSock = makeWASocket({ auth: state, browser: Browsers.macOS("Olympus"), markOnlineOnConnect: false, syncFullHistory: false });
  waSock.ev.on("creds.update", saveCreds);
  waSock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) { waState = "qr"; try { const qm = await import("qrcode"); waQR = await (qm.default || qm).toDataURL(qr, { margin: 1, width: 264 }); } catch { waQR = null; } waPush({ type: "status", state: "qr", qr: waQR }); }
    if (connection === "open") { waState = "connected"; waQR = null; waMe = { id: waSock.user?.id, name: waSock.user?.name || waSock.user?.verifiedName }; waPush({ type: "status", state: "connected", me: waMe }); }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      waSock = null;
      if (code === DisconnectReason.loggedOut) { waState = "disconnected"; waMe = null; try { rmSync(WA_DIR, { recursive: true, force: true }); } catch {} waStore.chats.clear(); waStore.messages.clear(); waStore.contacts.clear(); waPush({ type: "status", state: "disconnected" }); }
      else { waState = "connecting"; waPush({ type: "status", state: "connecting" }); setTimeout(() => waConnect().catch(() => {}), 2500); }
    }
  });
  waSock.ev.on("messaging-history.set", ({ chats, contacts, messages }) => {
    (contacts || []).forEach((c) => waStore.contacts.set(c.id, { id: c.id, name: c.name, notify: c.notify }));
    (chats || []).forEach((c) => { const e = waStore.chats.get(c.id) || { id: c.id }; e.name = c.name || e.name || waChatName(c.id); e.conversationTimestamp = +c.conversationTimestamp || e.conversationTimestamp || 0; e.unreadCount = c.unreadCount || 0; waStore.chats.set(c.id, e); });
    (messages || []).forEach(waStoreMsg);
    waPush({ type: "chats" });
  });
  waSock.ev.on("contacts.upsert", (cs) => { cs.forEach((c) => waStore.contacts.set(c.id, { id: c.id, name: c.name, notify: c.notify })); waPush({ type: "chats" }); });
  waSock.ev.on("contacts.update", (cs) => { cs.forEach((c) => { const e = waStore.contacts.get(c.id) || { id: c.id }; if (c.name) e.name = c.name; if (c.notify) e.notify = c.notify; waStore.contacts.set(c.id, e); }); });
  waSock.ev.on("chats.upsert", (cs) => { cs.forEach((c) => { const e = waStore.chats.get(c.id) || { id: c.id }; e.name = c.name || e.name || waChatName(c.id); e.conversationTimestamp = +c.conversationTimestamp || e.conversationTimestamp || 0; waStore.chats.set(c.id, e); }); waPush({ type: "chats" }); });
  waSock.ev.on("messages.upsert", ({ messages }) => { (messages || []).forEach(waStoreMsg); const last = messages && messages[messages.length - 1]; waPush({ type: "chats" }); if (last?.key?.remoteJid) waPush({ type: "message", jid: last.key.remoteJid }); });
}
function waChatList() {
  return [...waStore.chats.values()]
    .filter((c) => c.id && !c.id.endsWith("@broadcast") && c.id !== "status@broadcast")
    .map((c) => ({ id: c.id, name: c.name || waChatName(c.id), lastText: c.lastText || "", lastFromMe: !!c.lastFromMe, ts: +c.conversationTimestamp || 0, unread: c.unreadCount || 0, isGroup: c.id.endsWith("@g.us") }))
    .sort((a, b) => b.ts - a.ts).slice(0, 100);
}
function waMsgList(jid) {
  return (waStore.messages.get(jid) || []).map((m) => ({ id: m.key?.id, fromMe: !!m.key?.fromMe, text: waText(m), ts: +m.messageTimestamp || 0, author: m.pushName || "" })).filter((m) => m.text);
}
ipcMain.handle("wa:status", () => ({ ok: true, state: waState, qr: waQR, me: waMe, hasCreds: existsSync(join(WA_DIR, "creds.json")) }));
ipcMain.handle("wa:connect", async () => { try { await waConnect(); return { ok: true }; } catch (e) { waState = "disconnected"; waSock = null; return { ok: false, error: e.message }; } });
ipcMain.handle("wa:logout", async () => { try { if (waSock) { try { await waSock.logout(); } catch {} waSock = null; } waState = "disconnected"; waMe = null; waStore.chats.clear(); waStore.messages.clear(); waStore.contacts.clear(); try { rmSync(WA_DIR, { recursive: true, force: true }); } catch {} waPush({ type: "status", state: "disconnected" }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("wa:chats", () => ({ ok: true, chats: waChatList() }));
ipcMain.handle("wa:messages", (_e, jid) => ({ ok: true, messages: waMsgList(jid), name: waChatName(jid) }));
ipcMain.handle("wa:send", async (_e, jid, text) => { try { if (!waSock) throw new Error("WhatsApp non connecté."); const sent = await waSock.sendMessage(jid, { text: String(text || "") }); if (sent) waStoreMsg(sent); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });

// ══════════ ARGOS — social media management (marques, publication, inbox, écoute, ads) ══════════
// Architecture : le renderer ne parle qu'aux IPC argos:* — la même interface servira les
// vraies API (Meta/TikTok/LinkedIn/X/YouTube/Google Ads) une fois les clés en place.
// Tant qu'une plateforme n'est pas connectée, un générateur DÉTERMINISTE fournit des
// données de démonstration réalistes (flag demo:true) pour travailler l'UI et les flux.
function argosPath() { return join(app.getPath("userData"), "argos.json"); }
function argosLoad() {
  const p = argosPath();
  if (!existsSync(p)) return null; // vrai premier lancement
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) {
    // Fichier présent mais illisible : ne JAMAIS l'écraser en silence — on le sauvegarde
    // avant de repartir sur un état neuf, pour ne pas perdre les données réelles.
    try { renameSync(p, p + ".corrupt-" + Date.now()); } catch {}
    console.error("[argos] argos.json corrompu, sauvegardé en .corrupt :", e.message);
    return null;
  }
}
// Écriture atomique (tmp + rename) : un crash pendant l'écriture ne peut pas tronquer le store.
function argosSave(st) {
  const p = argosPath(); const tmp = p + ".tmp";
  try { writeFileSync(tmp, JSON.stringify(st, null, 2)); renameSync(tmp, p); return true; }
  catch (e) { console.error("[argos] échec de sauvegarde :", e.message); try { rmSync(tmp, { force: true }); } catch {} return false; }
}
// Chiffrement des secrets d'app (safeStorage = Keychain macOS). Préfixe "enc:" = chiffré.
function argosEncSecret(v) {
  if (v == null || v === "") return v;
  try { if (safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(String(v)).toString("base64"); } catch {}
  return String(v); // repli : au pire en clair, mais jamais renvoyé au renderer (cf. argos:state)
}
function argosDecSecret(v) {
  if (typeof v !== "string" || !v.startsWith("enc:")) return v;
  try { return safeStorage.decryptString(Buffer.from(v.slice(4), "base64")); } catch { return null; }
}
// ── Clé API Claude propre à Olympus (chiffrée via safeStorage). macOS isole safeStorage par app :
// la clé chiffrée de Zevs n'est pas déchiffrable ici, l'utilisateur la colle une fois dans Olympus. ──
function aiGetKey() { const st = argosLoad(); return st.claudeKey ? argosDecSecret(st.claudeKey) : null; }
ipcMain.handle("ai:hasKey", () => ({ has: !!aiGetKey() }));
ipcMain.handle("ai:setKey", (_e, key) => {
  key = String(key || "").trim();
  if (!/^sk-ant-/.test(key)) return { ok: false, error: "Clé Anthropic invalide (elle commence par sk-ant-)." };
  const st = argosLoad(); st.claudeKey = argosEncSecret(key); argosSave(st);
  return { ok: true };
});
// Rédige un brouillon de réponse à partir d'une conversation. La clé reste côté main, jamais renvoyée.
async function aiDraftReply({ kind, participants, messages, mode, draft }) {
  const key = aiGetKey();
  if (!key) return { ok: false, needKey: true };
  const convo = (messages || []).map((m) => `${m.who}: ${m.text}`).join("\n").slice(0, 12000);
  const canal = kind === "mail" ? "d'e-mails" : "de chat d'équipe";
  let sys, user;
  if (mode === "improve") {
    // Améliore le brouillon de l'utilisateur SANS changer son intention ni inventer d'information.
    sys = `Tu es l'assistant de rédaction de l'agence Orphic (Monaco). On te donne un brouillon de message ${canal} écrit par « Moi », et éventuellement la conversation pour le contexte. Réécris le brouillon en français en améliorant le style : plus clair, fluide et ${kind === "mail" ? "professionnel et chaleureux" : "naturel"}. NE CHANGE PAS son intention, N'AJOUTE aucune information ni engagement qui n'y sont pas, garde la même langue et le même sens. Renvoie UNIQUEMENT le message amélioré, sans guillemets ni préambule.`;
    user = `${convo ? "Contexte de la conversation :\n" + convo + "\n\n" : ""}Brouillon de « Moi » à améliorer :\n${draft || ""}`;
  } else {
    sys = kind === "mail"
      ? "Tu es l'assistant de rédaction de l'agence Orphic (Monaco). On te donne un fil d'e-mails. Rédige UNIQUEMENT le corps d'une réponse en français, professionnelle, chaleureuse et concise, du point de vue de « Moi » (Orphic Agency), prête à envoyer. Pas d'objet, pas de balises, juste le texte de la réponse."
      : "Tu es l'assistant de messagerie de l'agence Orphic. On te donne une conversation de chat d'équipe. Rédige UNIQUEMENT une réponse courte, naturelle et utile en français, du point de vue de « Moi », prête à envoyer. Juste le message, sans guillemets ni préambule.";
    user = `Conversation avec ${participants || "un interlocuteur"} :\n\n${convo}\n\nRédige la réponse de « Moi ».`;
  }
  try {
    const r = await anthropic.message({ apiKey: key, model: anthropic.MODELS.sonnet, system: sys, maxTokens: 800, user });
    return r.text ? { ok: true, text: r.text, cost: r.cost } : { ok: false, error: "Réponse vide." };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}
ipcMain.handle("ai:draftReply", (_e, payload) => aiDraftReply(payload || {}));
// Iris — l'assistante IA d'accueil d'Olympus (conversation multi-tours). La clé reste côté main.
// (NB : préfixes internes `at*`/`ai*` conservés ; seul le nom affiché a changé. « Athéna » est désormais le mail.)
async function aiChat({ messages, context, userName, model }) {
  const key = aiGetKey();
  if (!key) return { ok: false, needKey: true };
  const allowed = new Set(Object.values(anthropic.MODELS));   // opus / sonnet / haiku
  const useModel = allowed.has(model) ? model : anthropic.MODELS.sonnet;
  const who = (userName || "l'utilisateur").trim();
  const sys = `Tu es Iris, l'assistante IA de l'agence Orphic (agence créative à Monaco), intégrée à son espace de travail Olympus. Tu accompagnes ${who} au quotidien.
Style : réponds en français, tutoie ${who}, sois chaleureuse, concise et surtout ACTIONNABLE (va droit au but, propose des prochaines étapes concrètes). Utilise des listes courtes quand c'est utile. N'invente jamais d'information : si une donnée n'est pas dans le contexte fourni, dis-le simplement.
Olympus regroupe : Hermès (chat d'équipe), Chronos (calendrier), Athéna (e-mails/CRM), Argos (analytics & pub), Atlas (drive), Apollon (galerie), Ploutos (devis), Mnémosyne (notes).${context ? "\n\nContexte en temps réel de la journée de " + who + " (issu de l'app — utilise-le s'il est pertinent, sinon ignore-le) :\n" + String(context).slice(0, 8000) : ""}`;
  try {
    const r = await anthropic.chat({ apiKey: key, model: useModel, system: sys, maxTokens: 1024, messages });
    return r.text ? { ok: true, text: r.text, cost: r.cost } : { ok: false, error: "Réponse vide." };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}
ipcMain.handle("ai:chat", (_e, payload) => aiChat(payload || {}));
// Lit un média local (renderer/assets) et renvoie ses octets → le renderer en fait un blob: URL
// pour la <video> d'ambiance (le file:// est bloqué par Chromium pour les médias). basename = pas de traversée.
ipcMain.handle("media:read", (_e, name) => {
  try { return { ok: true, data: readFileSync(join(__dirname, "renderer", "assets", basename(String(name || "")))) }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});
function argosState() {
  let st = argosLoad();
  if (!st) {
    // Premier lancement : trois marques de démonstration (retirables)
    st = {
      brands: [
        { id: "solene", name: "Maison Solène", secteur: "mode", networks: { instagram: "@maisonsolene", tiktok: "@maisonsolene", facebook: "Maison Solène" }, keywords: ["maison solène", "robe lin", "mode éthique"], competitors: [{ name: "Sézane", handle: "@sezane" }, { name: "Rouje", handle: "@rouje" }] },
        { id: "riviera", name: "Villa Riviera", secteur: "hôtellerie", networks: { instagram: "@villariviera.mc", linkedin: "Villa Riviera" }, keywords: ["villa riviera", "hôtel monaco", "spa riviera"], competitors: [{ name: "Hôtel Metropole", handle: "@metropolemc" }] },
        { id: "solaris", name: "Solaris", secteur: "eyewear", networks: { instagram: "@solaris.eyewear", tiktok: "@solaris.eyewear" }, keywords: ["solaris eyewear", "lunettes créateur"], competitors: [{ name: "Izipizi", handle: "@izipizi" }, { name: "Jimmy Fairly", handle: "@jimmyfairly" }] },
      ],
      posts: [], inboxReplies: [], connections: {},
    };
    argosSave(st);
  }
  st.brands = st.brands || []; st.posts = st.posts || []; st.inboxReplies = st.inboxReplies || []; st.connections = st.connections || {}; st.providers = st.providers || {}; st.cache = st.cache || {}; st.reports = st.reports || {};
  return st;
}
// Registre des plateformes + leurs API réelles (endpoints chargés depuis argos-apis.json,
// produit par la recherche de documentation — substitution {placeholders} à la connexion).
const ARGOS_PLATFORMS = [
  { id: "instagram", label: "Instagram", icon: "📷", api: "Instagram Graph API (Meta)" },
  { id: "facebook", label: "Facebook", icon: "👥", api: "Facebook Pages API (Meta)" },
  { id: "tiktok", label: "TikTok", icon: "🎵", api: "TikTok API v2 (Business)" },
  { id: "linkedin", label: "LinkedIn", icon: "💼", api: "LinkedIn Marketing API" },
  { id: "x", label: "X", icon: "𝕏", api: "X API v2" },
  { id: "youtube", label: "YouTube", icon: "▶️", api: "YouTube Data + Analytics API" },
  { id: "meta_ads", label: "Meta Ads", icon: "📣", api: "Meta Marketing API" },
  { id: "google_ads", label: "Google Ads", icon: "🔎", api: "Google Ads API" },
  { id: "google_analytics", label: "Google Analytics", icon: "📈", api: "Analytics Data API (GA4)" },
  { id: "search_console", label: "Search Console", icon: "🔍", api: "Search Console API" },
  { id: "google_business", label: "Google Business", icon: "📍", api: "Business Profile API" },
];
// Une "app développeur" (fournisseur) peut couvrir plusieurs surfaces : une seule app Meta
// donne Instagram + Facebook + Meta Ads. Les clés sont stockées par fournisseur, pas par surface.
const ARGOS_PROVIDERS = {
  meta: {
    label: "Meta",
    surfaces: ["instagram", "facebook", "meta_ads"],
    graph: "v25.0",
    authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v25.0/oauth/access_token",
    // Les apps créées via le nouveau flux "Facebook Login for Business" (use cases Pages/
    // Instagram/Marketing API) n'acceptent plus de scopes bruts dans l'URL d'autorisation —
    // il faut un config_id créé dans Facebook Login for Business → Configurations.
    // Permissions modernes de référence à sélectionner dans cette configuration :
    //   Page          : pages_show_list, pages_read_engagement, pages_manage_posts, read_insights
    //   Instagram acct: instagram_business_basic, instagram_business_manage_insights,
    //                   instagram_business_manage_comments, instagram_business_content_publish
    //   Ad account    : ads_read, ads_management (ou business_management pour lister les comptes pub)
  },
  google: {
    label: "Google",
    // Un seul login Google (compte agence) couvre les 4 produits Argos ET Drive (Atlas).
    surfaces: ["google_analytics", "search_console", "google_ads", "google_business"],
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid", "email", "profile",
      "https://www.googleapis.com/auth/analytics.readonly",   // GA4 (lecture)
      "https://www.googleapis.com/auth/webmasters.readonly",  // Search Console
      "https://www.googleapis.com/auth/adwords",              // Google Ads
      "https://www.googleapis.com/auth/business.manage",      // Business Profile (avis, insights)
      "https://www.googleapis.com/auth/drive",                // Drive (Atlas)
    ],
  },
};
function argosProviderOf(platform) {
  for (const [prov, cfg] of Object.entries(ARGOS_PROVIDERS)) if (cfg.surfaces.includes(platform)) return prov;
  return platform;
}
const ARGOS_OAUTH_PORT = 47823; // fixe : le redirect URI enregistré côté plateforme doit correspondre
// Version de l'API Google Ads. À bumper quand Google sunset l'ancienne (~1/an) — un appel sur une
// version périmée renvoie 404. Voir developers.google.com/google-ads/api/docs/release-notes.
const GOOGLE_ADS_API_VERSION = "v24";
function argosCallbackHtml(ok) {
  return `<!doctype html><meta charset="utf-8"><title>Olympus — Argos</title>
<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1012;color:#eee;display:grid;place-items:center;height:100vh;text-align:center">
<div><div style="font-size:40px">${ok ? "✓" : "✕"}</div>
<h2 style="font-weight:600">${ok ? "Compte autorisé" : "Autorisation annulée"}</h2>
<p style="color:#888">Tu peux fermer cet onglet et revenir dans Olympus.</p></div>`;
}
// Flux OAuth "native app" (RFC 8252) : navigateur système + serveur de redirection en localhost.
function argosLoopbackAuth(authUrl, expectedState) {
  return new Promise((resolve, reject) => {
    let done = false;
    let stale = null;        // code reçu avec un état différent (onglet périmé) : gardé en secours
    let graceTimer = null;
    const finish = (fn, arg) => { if (done) return; done = true; if (graceTimer) clearTimeout(graceTimer); setTimeout(() => { try { server.close(); } catch {} }, 300); fn(arg); };
    const server = createServer((req, res) => {
      let u; try { u = new URL(req.url, `http://localhost:${ARGOS_OAUTH_PORT}`); } catch { res.writeHead(400); return res.end(); }
      if (u.pathname !== "/callback") { res.writeHead(404); return res.end(); }        // favicon, etc. : ignoré
      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      const err = u.searchParams.get("error_description") || u.searchParams.get("error");
      if (err) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(argosCallbackHtml(false)); return finish(reject, new Error(err)); }
      if (!code) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(argosCallbackHtml(false)); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(argosCallbackHtml(true));
      // État correct : c'est le bon callback, on résout tout de suite.
      if (state === expectedState) return finish(resolve, code);
      // État différent (onglet d'une tentative précédente) : sur loopback local le vrai garde-fou
      // est que seul 127.0.0.1 reçoit le code, et l'échange de token l'arbitre. On garde ce code en
      // secours et on laisse une courte fenêtre au « bon » callback ; sinon on tente celui-ci plutôt
      // que d'attendre le délai complet dans le vide.
      if (!stale) { stale = code; graceTimer = setTimeout(() => finish(resolve, stale), 3000); }
    });
    server.on("error", (e) => finish(reject, new Error(`Port ${ARGOS_OAUTH_PORT} indisponible : ${e.message}`)));
    server.listen(ARGOS_OAUTH_PORT, "127.0.0.1", () => { shell.openExternal(authUrl); });
    setTimeout(() => finish(reject, new Error("Délai dépassé — la connexion a été annulée.")), 300000);
  });
}
// fetch avec timeout (AbortController) — sans ça, un appel Graph API qui traîne bloquait le
// handler IPC indéfiniment au lieu de retomber proprement sur le cache/la démo.
async function timedFetch(url, opts = {}, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}
async function argosJson(url) { const r = await timedFetch(url); const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j }; }
// Connexion Meta complète : code → jeton court → jeton long → Pages + comptes IG + comptes pub.
// configId : Configuration ID de "Facebook Login for Business" (obligatoire pour les apps créées
// via le flux "use cases" — elles n'acceptent plus de scopes bruts dans l'URL d'autorisation).
async function argosMetaConnect(appId, appSecret, configId) {
  const V = ARGOS_PROVIDERS.meta.graph;
  const redirect = `http://localhost:${ARGOS_OAUTH_PORT}/callback`;
  const state = randomUUID();
  const authUrl = `${ARGOS_PROVIDERS.meta.authUrl}?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}&response_type=code&config_id=${encodeURIComponent(configId)}`;
  const code = await argosLoopbackAuth(authUrl, state);
  const short = await argosJson(`${ARGOS_PROVIDERS.meta.tokenUrl}?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&redirect_uri=${encodeURIComponent(redirect)}&code=${encodeURIComponent(code)}`);
  if (!short.ok || !short.j.access_token) throw new Error("Échange du code refusé : " + (short.j.error?.message || short.status));
  const ll = await argosJson(`${ARGOS_PROVIDERS.meta.tokenUrl}?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(short.j.access_token)}`);
  const userToken = ll.j.access_token || short.j.access_token;
  const expiresIn = ll.j.expires_in || short.j.expires_in || 0;
  const pg = await argosJson(`https://graph.facebook.com/${V}/me/accounts?fields=name,access_token,instagram_business_account{username,id}&access_token=${encodeURIComponent(userToken)}`);
  const pages = (pg.j.data || []).map((p) => ({ id: p.id, name: p.name, access_token: p.access_token, ig_user_id: p.instagram_business_account?.id || null, ig_username: p.instagram_business_account?.username || null }));
  let adAccounts = [];
  try { const ad = await argosJson(`https://graph.facebook.com/${V}/me/adaccounts?fields=name,account_id&access_token=${encodeURIComponent(userToken)}`); adAccounts = (ad.j.data || []).map((a) => ({ id: a.account_id, name: a.name })); } catch {}
  return { userToken, expiresIn, pages, adAccounts };
}
// ── Google (Analytics GA4 + Search Console + Ads + Business Profile + Drive) ──
// Un seul flux OAuth "Desktop app" (loopback) avec accès hors-ligne → refresh_token stocké
// (chiffré) : Google renvoie des access_token courts (~1h), régénérés à la demande.
async function googleTokenPost(params) {
  const r = await timedFetch(ARGOS_PROVIDERS.google.tokenUrl, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Google token " + r.status + " : " + (j.error_description || j.error || ""));
  return j;
}
// Renvoie un access_token Google valide, en le rafraîchissant si expiré (marge 60 s).
async function argosGoogleAccessToken() {
  const st = argosState();
  const g = st.providers.google;
  if (!g || !g.refresh_token) { const e = new Error("Google non connecté."); e.notConnected = true; throw e; }
  if (g.access_token && g.token_expiry && Date.now() < g.token_expiry - 60000) return argosDecSecret(g.access_token);
  const j = await googleTokenPost({ grant_type: "refresh_token", refresh_token: argosDecSecret(g.refresh_token), client_id: g.client_id, client_secret: argosDecSecret(g.client_secret) });
  const st2 = argosState();
  st2.providers.google = { ...st2.providers.google, access_token: argosEncSecret(j.access_token), token_expiry: Date.now() + (j.expires_in || 3600) * 1000 };
  argosSave(st2);
  return j.access_token;
}
// GET JSON authentifié Google (Bearer). `dev` = developer-token (Google Ads uniquement).
async function argosGoogleGet(url, extraHeaders = {}) {
  const token = await argosGoogleAccessToken();
  const r = await timedFetch(url, { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google ${r.status} : ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}
// POST JSON authentifié Google (GA4 Data API runReport, Search Console searchAnalytics…).
async function argosGooglePost(url, body, extraHeaders = {}) {
  const token = await argosGoogleAccessToken();
  const r = await timedFetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google ${r.status} : ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
// Requête GAQL Google Ads (search). `loginCustomerId` = compte administrateur (MCC) sous lequel
// le compte est géré ; `devToken` déjà déchiffré. Les deux entêtes prennent l'ID sans tirets.
async function argosGoogleAdsSearch(customerId, query, loginCustomerId, devToken) {
  const cid = String(customerId).replace(/-/g, "");
  const headers = { "developer-token": devToken };
  if (loginCustomerId) headers["login-customer-id"] = String(loginCustomerId).replace(/-/g, "");
  return argosGooglePost(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cid}/googleAds:search`, { query }, headers);
}
// Découverte des actifs accessibles au compte agence (best-effort : chaque produit peut
// échouer indépendamment, ex. Ads sans developer token approuvé ou Business non allowlisté).
async function argosGoogleDiscover() {
  const st = argosState();
  const devToken = st.providers.google.developer_token ? argosDecSecret(st.providers.google.developer_token) : null;
  const assets = { analytics: [], searchConsole: [], googleAds: [], business: [] };
  // GA4 : comptes + propriétés
  try {
    const r = await argosGoogleGet("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200");
    for (const acc of (r.accountSummaries || [])) for (const p of (acc.propertySummaries || []))
      assets.analytics.push({ id: p.property, label: (p.displayName || p.property) + (acc.displayName ? " · " + acc.displayName : "") });
  } catch (e) { assets.analyticsError = e.message; }
  // Search Console : sites vérifiés
  try {
    const r = await argosGoogleGet("https://www.googleapis.com/webmasters/v3/sites");
    for (const s of (r.siteEntry || [])) if (s.permissionLevel !== "siteUnverifiedUser") assets.searchConsole.push({ id: s.siteUrl, label: s.siteUrl });
  } catch (e) { assets.searchConsoleError = e.message; }
  // Google Ads : comptes accessibles (nécessite le developer token). On tente d'enrichir chaque
  // compte avec son nom réel et de repérer le compte administrateur (MCC) — best-effort : ces
  // requêtes GAQL échouent tant que le token est en niveau « Test » (accès Basic requis), auquel
  // cas on retombe sur l'ID brut et login_customer_id reste vide (rempli au prochain re-sync).
  if (devToken) {
    try {
      const r = await argosGoogleGet(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`, { "developer-token": devToken });
      const accessible = (r.resourceNames || []).map((rn) => rn.split("/")[1]).filter(Boolean);
      // Noms + hiérarchie : pour chaque compte accessible, `customer_client` liste le compte ET ses
      // sous-comptes (nom réel, manager, niveau) — un MCC renvoie tous ses enfants d'un coup. C'est
      // ce qui donne les descriptive_name qui manquaient (l'ancien SELECT … FROM customer, lancé avec
      // login-customer-id = le compte lui-même, échouait en silence pour les comptes sous MCC).
      const byId = new Map();          // comptes NON-manager (clients mappables) : id -> {id,name}
      const managers = new Set();       // comptes administrateurs (MCC) — jamais mappés à un client
      const enumCount = new Map();      // combien de sous-comptes chaque compte accessible a énuméré
      let lastErr = null;
      for (const cust of accessible) {
        try {
          const q = await argosGoogleAdsSearch(cust, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level, customer_client.status FROM customer_client", cust, devToken);
          const rows = q.results || [];
          enumCount.set(cust, rows.length);
          for (const row of rows) {
            const cc = row.customerClient || {};
            const id = String(cc.id || "").replace(/-/g, "");
            if (!id || cc.status === "CANCELLED" || cc.status === "CLOSED") continue;
            if (cc.manager) { managers.add(id); continue; }
            const name = cc.descriptiveName || null;
            const prev = byId.get(id);
            if (!prev || (!prev.name && name)) byId.set(id, { id, name });
          }
        } catch (e) { lastErr = e.message; }
      }
      // login-customer-id = le compte accessible qui a énuméré le plus de sous-comptes (le MCC
      // utilisable pour interroger la perf des comptes enfants ensuite). Un compte feuille n'en
      // renvoie qu'un (lui-même) → non retenu.
      let bestMcc = null, bestN = 1;
      for (const [cust, n] of enumCount) if (n > bestN) { bestN = n; bestMcc = cust; }
      if (bestMcc) assets.loginCustomerId = bestMcc;
      // Filet : un compte accessible jamais vu comme enfant ET non confirmé manager ne doit pas
      // disparaître (sa requête a pu échouer) — on le garde avec son ID brut plutôt que de le perdre.
      for (const id of accessible) if (!byId.has(id) && !managers.has(id)) byId.set(id, { id, name: null });
      let list = [...byId.values()];
      if (!list.length) { list = accessible.map((id) => ({ id, name: null })); if (lastErr) assets.googleAdsError = lastErr; }
      list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, "fr", { numeric: true }));
      assets.googleAds = list.map((x) => ({ id: x.id, name: x.name || null, label: x.name || x.id }));
    } catch (e) { assets.googleAdsError = e.message; }
  }
  // Business Profile : comptes puis établissements
  try {
    const r = await argosGoogleGet("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
    for (const acc of (r.accounts || []).slice(0, 5)) {
      try {
        const locs = await argosGoogleGet(`https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title&pageSize=100`);
        for (const l of (locs.locations || [])) assets.business.push({ id: l.name, label: l.title || l.name });
      } catch {}
    }
  } catch (e) { assets.businessError = e.message; }
  return assets;
}
// Connexion Google complète : OAuth loopback (offline) → refresh_token → découverte des actifs.
async function argosGoogleConnect(clientId, clientSecret) {
  const redirect = `http://localhost:${ARGOS_OAUTH_PORT}/callback`;
  const state = randomUUID();
  const authUrl = ARGOS_PROVIDERS.google.authUrl + "?" + new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: "code",
    scope: ARGOS_PROVIDERS.google.scopes.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true",
  }).toString();
  const code = await argosLoopbackAuth(authUrl, state);
  const tok = await googleTokenPost({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect });
  if (!tok.refresh_token) throw new Error("Google n'a pas renvoyé de refresh_token — révoque l'accès dans ton compte Google puis reconnecte (prompt=consent requis).");
  // Email du compte (via userinfo)
  let email = null;
  try { const ui = await timedFetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } }); email = (await ui.json()).email; } catch {}
  return { refresh_token: tok.refresh_token, access_token: tok.access_token, expires_in: tok.expires_in || 3600, email };
}
let _argosApis = null;
function argosApis() {
  if (_argosApis) return _argosApis;
  try { _argosApis = JSON.parse(readFileSync(join(__dirname, "argos-apis.json"), "utf8")); }
  catch { _argosApis = { apis: [] }; }
  return _argosApis;
}
// Appel API réel — prêt : substitue les placeholders et exécute dès qu'un token existe.
// overrides : identifiants spécifiques à une MARQUE (page_id, ig_user_id, ad_account_id…) qui
// remplacent ceux de la connexion globale — indispensable pour une agence multi-clients où
// chaque marque a sa propre Page/compte pub derrière le même compte Meta de l'agence.
async function argosApiCall(platform, endpointId, params = {}, overrides = {}) {
  const st = argosState();
  const conn = st.connections[platform];
  const token = overrides.access_token ? argosDecSecret(overrides.access_token) : (conn && argosDecSecret(conn.access_token));
  if (!conn || conn.status !== "connected" || !token) {
    const err = new Error("non-connecté"); err.notConnected = true; throw err;
  }
  const spec = (argosApis().apis || []).find((a) => a.platform === platform || (a.covers || []).includes(platform));
  const ep = spec && (spec.endpoints || []).find((e) => e.id === endpointId);
  if (!ep) throw new Error(`Endpoint inconnu : ${platform}/${endpointId}`);
  const ctx = { ...conn, ...overrides };
  let url = ep.url_template.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? ctx[k] ?? `{${k}}`);
  const q = new URLSearchParams();
  for (const p of ep.params || []) if (params[p.name] != null) q.set(p.name, params[p.name]);
  if (!/\baccess_token\b/.test(url) && ep.method === "GET") q.set("access_token", token);
  if ([...q].length) url += (url.includes("?") ? "&" : "?") + q.toString();
  const r = await timedFetch(url, { method: ep.method, headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${platform} ${r.status} : ${JSON.stringify(j).slice(0, 180)}`);
  return j;
}
// ── Générateur démo déterministe (stable par marque : mêmes chiffres à chaque rendu) ──
function argosRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h ^= h >>> 16) >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const AR_FIRST = ["Camille", "Léa", "Hugo", "Emma", "Nina", "Théo", "Chloé", "Marco", "Julie", "Antoine", "Sofia", "Mathis", "Inès", "Paul", "Elena"];
const AR_LAST = ["M.", "R.", "B.", "L.", "D.", "V.", "G.", "P."];
function argosDemoOverview(brand, days) {
  const rng = argosRng(brand.id + ":ov");
  const nets = Object.keys(brand.networks || {});
  const followers = {}; let totF = 0;
  nets.forEach((n) => { const f = Math.round((3000 + rng() * 40000) / 100) * 100; followers[n] = f; totF += f; });
  const base = 800 + rng() * 4000;
  const byDay = []; const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const wd = d.getDay(); const wk = (wd === 0 || wd === 6) ? 0.72 : 1;
    byDay.push({ date: isoLocalD(d), reach: Math.round(base * wk * (0.7 + rng() * 0.7)), eng: +(2 + rng() * 5).toFixed(1) });
  }
  const reach = byDay.reduce((n, x) => n + x.reach, 0);
  const engagement = +(byDay.reduce((n, x) => n + x.eng, 0) / byDay.length).toFixed(1);
  const perNet = nets.map((n) => ({ network: n, handle: brand.networks[n], followers: followers[n], growth: +(rng() * 9 - 1).toFixed(1), engagement: +(1.5 + rng() * 6).toFixed(1), posts: 4 + Math.round(rng() * 10) }));
  const TOPS = ["Coulisses du shoot", "Nouveautés de la saison", "Avant / après", "3 conseils de pro", "L'équipe en action", "Détail matière", "Teaser vidéo", "Story à la une"];
  const topPosts = Array.from({ length: 4 }, (_, i) => ({ id: "tp" + i, network: nets[Math.floor(rng() * nets.length)] || "instagram", title: TOPS[Math.floor(rng() * TOPS.length)], reach: Math.round(2000 + rng() * 30000), eng: +(3 + rng() * 8).toFixed(1), date: byDay[Math.max(0, byDay.length - 1 - Math.floor(rng() * days))].date })).sort((a, b) => b.reach - a.reach);
  const health = Math.round(52 + rng() * 40);
  const alerts = [];
  if (rng() > 0.5) alerts.push({ type: "opportunity", txt: "Le format vidéo court surperforme de 2,3× ce mois-ci — un créneau à saisir cette semaine." });
  if (rng() > 0.65) alerts.push({ type: "warn", txt: "Engagement en baisse sur " + (nets[0] || "instagram") + " depuis 6 jours — varier les hooks." });
  const fbInsights = nets.includes("facebook") ? { postEngagements: Math.round(rng() * 400), pageViews: Math.round(rng() * 900), newFollows: Math.round(rng() * 60) } : null;
  return { demo: true, days, followers: totF, reach, engagement, published: perNet.reduce((n, x) => n + x.posts, 0), byDay, perNet, topPosts, health, alerts, fbInsights };
}
function argosDemoInbox(brand) {
  const rng = argosRng(brand.id + ":inbox");
  const nets = Object.keys(brand.networks || {});
  const MSGS = [
    "Bonjour, est-ce que ce modèle est encore disponible ?",
    "Superbe collection 😍 vous livrez en Belgique ?",
    "J'ai un souci avec ma commande #48213…",
    "C'est possible d'avoir les tarifs pour un événement privé ?",
    "Bravo pour la vidéo, magnifique ! 👏",
    "Vous faites des collaborations avec des créateurs ?",
    "Quels sont vos horaires cet été ?",
    "Le lien du site en bio ne fonctionne pas 🙁",
  ];
  const n = 5 + Math.floor(rng() * 4);
  return Array.from({ length: n }, (_, i) => {
    const name = AR_FIRST[Math.floor(rng() * AR_FIRST.length)] + " " + AR_LAST[Math.floor(rng() * AR_LAST.length)];
    const net = nets[Math.floor(rng() * nets.length)] || "instagram";
    const hoursAgo = Math.round(rng() * 40);
    return { id: brand.id + "-c" + i, network: net, from: name, kind: rng() > 0.5 ? "dm" : "commentaire", text: MSGS[Math.floor(rng() * MSGS.length)], hoursAgo, unread: hoursAgo < 12 && rng() > 0.35 };
  }).sort((a, b) => a.hoursAgo - b.hoursAgo);
}
function argosDemoListening(brand) {
  const rng = argosRng(brand.id + ":listen");
  const SRC = ["instagram", "tiktok", "x", "facebook", "web"];
  const TXT = [
    ["J'ai découvert {b} ce week-end, coup de cœur absolu", "pos"],
    ["Quelqu'un a déjà commandé chez {b} ? Des avis ?", "neu"],
    ["Le service client de {b} a mis 5 jours à répondre…", "neg"],
    ["La nouvelle collection {b} est incroyable 🔥", "pos"],
    ["{b} vu dans le magazine ce mois-ci !", "pos"],
    ["Déçu de la qualité par rapport au prix chez {b}", "neg"],
    ["On m'a offert un produit {b}, très bonne surprise", "pos"],
    ["{b} ouvre bientôt à Nice ? quelqu'un sait ?", "neu"],
  ];
  const n = 6 + Math.floor(rng() * 5);
  const mentions = Array.from({ length: n }, (_, i) => {
    const t = TXT[Math.floor(rng() * TXT.length)];
    return { id: "m" + i, source: SRC[Math.floor(rng() * SRC.length)], author: "@" + AR_FIRST[Math.floor(rng() * AR_FIRST.length)].toLowerCase() + Math.floor(rng() * 90), text: t[0].replace("{b}", brand.name), sentiment: t[1], hoursAgo: Math.round(rng() * 96), reach: Math.round(rng() * 8000) };
  }).sort((a, b) => a.hoursAgo - b.hoursAgo);
  const pos = mentions.filter((m) => m.sentiment === "pos").length, neg = mentions.filter((m) => m.sentiment === "neg").length;
  return { demo: true, mentions, sentiment: { pos, neu: mentions.length - pos - neg, neg }, spike: rng() > 0.8 };
}
function argosDemoAds(brand) {
  const rng = argosRng(brand.id + ":ads");
  const NAMES = ["Conversions — collection", "Notoriété — vidéo", "Retargeting — paniers", "Search — marque", "Trafic — nouveautés", "Leads — événement"];
  const n = 2 + Math.floor(rng() * 3);
  const campaigns = Array.from({ length: n }, (_, i) => {
    const budget = Math.round((300 + rng() * 1200) / 50) * 50;
    const spend = Math.round(budget * (0.3 + rng() * 0.65));
    const roas = +(1.8 + rng() * 5.5).toFixed(1);
    return { id: "cp" + i, name: NAMES[(i + Math.floor(rng() * 3)) % NAMES.length], platform: rng() > 0.35 ? "meta_ads" : "google_ads", status: rng() > 0.25 ? "active" : "ended", budget, spend, roas, cpc: +(0.2 + rng() * 0.9).toFixed(2), impressions: Math.round(30000 + rng() * 400000), clicks: Math.round(500 + rng() * 9000), conversions: Math.round(10 + rng() * 320) };
  });
  const totSpend = campaigns.reduce((n2, c) => n2 + c.spend, 0);
  const totConv = campaigns.reduce((n2, c) => n2 + c.conversions, 0);
  const wRoas = +(campaigns.reduce((n2, c) => n2 + c.roas * c.spend, 0) / (totSpend || 1)).toFixed(1);
  const platformSplit = [
    { platform: "instagram", spend: Math.round(totSpend * (0.55 + rng() * 0.2)), impressions: 0, clicks: 0 },
  ]; platformSplit.push({ platform: "facebook", spend: Math.max(0, totSpend - platformSplit[0].spend), impressions: 0, clicks: 0 });
  const AGE_B = ["18-24", "25-34", "35-44", "45-54", "55+"];
  const demoSplit = AGE_B.flatMap((age) => ["female", "male"].map((gender) => ({ age, gender, spend: Math.round(rng() * totSpend * 0.15), impressions: Math.round(rng() * 20000) }))).sort((a, b) => b.spend - a.spend);
  return { demo: true, campaigns, totals: { spend: totSpend, conversions: totConv, roas: wRoas }, platformSplit, demoSplit };
}
// Modèle générique multi-réseaux : brand.assets = [{network, id, label}]. Une marque peut
// combiner des actifs de plusieurs réseaux (Facebook, Instagram, Meta Ads, et demain Google/
// TikTok/etc.) — chaque réseau est résolu indépendamment, ce qui permet par exemple de ne
// suivre QUE l'Instagram d'un client sans sa Page, ou l'inverse.
function argosBrandAsset(brand, network) {
  return (brand.assets || []).find((a) => a.network === network)?.id || null;
}
// Vraies données Meta Ads pour une marque mappée à un compte publicitaire (act_{id}).
// Renvoie EXACTEMENT la forme d'argosDemoAds — le renderer n'a rien à changer pour l'afficher.
async function argosRealAds(brand) {
  const adId = argosBrandAsset(brand, "meta_ads");
  if (!adId) return null;
  const ov = { ad_account_id: adId };
  const [camp, ins, platformBd, demoBd] = await Promise.all([
    argosApiCall("meta_ads", "ads_campaigns", { fields: "id,name,objective,effective_status,daily_budget,lifetime_budget" }, ov),
    argosApiCall("meta_ads", "ads_insights", { level: "campaign", fields: "campaign_id,campaign_name,spend,impressions,clicks,cpc,cpm,ctr,actions,purchase_roas", date_preset: "last_30d" }, ov),
    argosApiCall("meta_ads", "ads_insights", { level: "campaign", fields: "spend,impressions,clicks", breakdowns: "publisher_platform", date_preset: "last_30d" }, ov).catch(() => null),
    argosApiCall("meta_ads", "ads_insights", { level: "campaign", fields: "spend,impressions", breakdowns: "age,gender", date_preset: "last_30d" }, ov).catch(() => null),
  ]);
  const insByCamp = new Map((ins.data || []).map((i) => [i.campaign_id, i]));
  const campaigns = (camp.data || []).map((c) => {
    const i = insByCamp.get(c.id) || {};
    const spend = +(i.spend || 0);
    const roasArr = i.purchase_roas || [];
    const roas = roasArr.length ? +roasArr[0].value : 0;
    const conversions = (i.actions || []).reduce((n, a) => n + (/purchase|lead|complete_registration|omni_/.test(a.action_type) ? +a.value : 0), 0);
    const budget = c.daily_budget ? Math.round((+c.daily_budget / 100) * 30) : (c.lifetime_budget ? Math.round(+c.lifetime_budget / 100) : Math.round(spend));
    return { id: c.id, name: c.name, platform: "meta_ads", status: c.effective_status === "ACTIVE" ? "active" : "ended", budget, spend: Math.round(spend), roas: +roas.toFixed(1), cpc: +(i.cpc || 0), impressions: Math.round(+(i.impressions || 0)), clicks: Math.round(+(i.clicks || 0)), conversions };
  });
  const totSpend = campaigns.reduce((n, c) => n + c.spend, 0);
  const totConv = campaigns.reduce((n, c) => n + c.conversions, 0);
  const wRoas = totSpend ? +(campaigns.reduce((n, c) => n + c.roas * c.spend, 0) / totSpend).toFixed(1) : 0;
  // Répartition par plateforme (Instagram vs Facebook) — agrégée sur toutes les campagnes.
  const platformMap = new Map();
  for (const r of (platformBd?.data || [])) {
    const k = r.publisher_platform || "autre";
    const cur = platformMap.get(k) || { platform: k, spend: 0, impressions: 0, clicks: 0 };
    cur.spend += +(r.spend || 0); cur.impressions += +(r.impressions || 0); cur.clicks += +(r.clicks || 0);
    platformMap.set(k, cur);
  }
  const platformSplit = [...platformMap.values()].map((p) => ({ ...p, spend: Math.round(p.spend) })).sort((a, b) => b.spend - a.spend);
  // Répartition démographique (âge × genre) — agrégée par tranche, genre ignoré si "unknown".
  const demoMap = new Map();
  for (const r of (demoBd?.data || [])) {
    const k = (r.age || "?") + "·" + (r.gender || "?");
    const cur = demoMap.get(k) || { age: r.age || "?", gender: r.gender || "?", spend: 0, impressions: 0 };
    cur.spend += +(r.spend || 0); cur.impressions += +(r.impressions || 0);
    demoMap.set(k, cur);
  }
  const demoSplit = [...demoMap.values()].map((d) => ({ ...d, spend: Math.round(d.spend) })).sort((a, b) => b.spend - a.spend);
  return { demo: false, campaigns, totals: { spend: totSpend, conversions: totConv, roas: wRoas }, platformSplit, demoSplit };
}
// Vraies campagnes Google Ads d'une marque mappée à un compte (customer id). Nécessite le
// developer token + l'accès Basic (les requêtes GAQL sur comptes réels sont bloquées en niveau
// Test). Renvoie une liste de campagnes à la MÊME forme que celles d'argosRealAds (fusionnables).
async function argosRealGoogleAds(brand) {
  const cid = argosBrandAsset(brand, "google_ads");
  if (!cid) return [];
  const st = argosState();
  const g = st.providers.google || {};
  const devToken = g.developer_token ? argosDecSecret(g.developer_token) : null;
  if (!devToken) return [];
  const j = await argosGoogleAdsSearch(cid, "SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.average_cpc FROM campaign WHERE segments.date DURING LAST_30_DAYS", g.login_customer_id, devToken);
  return (j.results || []).map((r) => {
    const m = r.metrics || {}, c = r.campaign || {};
    const spend = +(m.costMicros || 0) / 1e6;
    const convVal = +(m.conversionsValue || 0);
    return { id: c.id, name: c.name, platform: "google_ads", status: c.status === "ENABLED" ? "active" : "ended", budget: Math.round(spend), spend: Math.round(spend), roas: spend ? +(convVal / spend).toFixed(1) : 0, cpc: +((+(m.averageCpc || 0)) / 1e6).toFixed(2), impressions: Math.round(+(m.impressions || 0)), clicks: Math.round(+(m.clicks || 0)), conversions: Math.round(+(m.conversions || 0)) };
  });
}
// Type de campagne Google Ads → libellé lisible (Search = « AdWords » classique ; le reste = display,
// vidéo, notoriété/Demand Gen, etc. — tous n'ont PAS de mots-clés : seul Search cible par mots-clés).
const ADS_CHANNEL_LABELS = { SEARCH: "Search (AdWords)", DISPLAY: "Display", VIDEO: "Vidéo (YouTube)", SHOPPING: "Shopping", PERFORMANCE_MAX: "Performance Max", DEMAND_GEN: "Demand Gen (notoriété)", DISCOVERY: "Discovery", MULTI_CHANNEL: "Multi-canal", LOCAL: "Local", LOCAL_SERVICES: "Local Services", SMART: "Smart", HOTEL: "Hôtel", TRAVEL: "Voyage" };
const ADS_KEYWORD_CHANNELS = new Set(["SEARCH", "MULTI_CHANNEL", "SHOPPING"]); // canaux qui utilisent des mots-clés
function argosAdsClient(brand) {
  const cid = argosBrandAsset(brand, "google_ads"); if (!cid) return null;
  const g = argosState().providers.google || {};
  const devToken = g.developer_token ? argosDecSecret(g.developer_token) : null; if (!devToken) return null;
  return { cid, login: g.login_customer_id, devToken };
}
// GAQL n'accepte comme constantes que LAST_7/14/30_DAYS — pour une plage arbitraire on passe par
// segments.date BETWEEN 'AAAA-MM-JJ' AND 'AAAA-MM-JJ'. Accepte une PÉRIODE : {days:N} (N derniers
// jours) OU {from,to} (plage de dates explicite, ex. une fenêtre de 5 jours).
function gaqlDateRange(period) {
  const p = period || {};
  const fmt = (dt) => dt.toISOString().slice(0, 10);
  if (p.from && p.to) return `segments.date BETWEEN '${p.from}' AND '${p.to}'`;
  const days = Math.max(1, Math.min(+p.days || 90, 365));
  const end = new Date(), start = new Date(end.getTime() - days * 86400000);
  return `segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'`;
}
function adsPeriodNorm(period) {
  const p = period || {};
  if (p.from && p.to) return { from: p.from, to: p.to };
  return { days: Math.max(1, Math.min(+p.days || 90, 365)) };
}
function adsPeriodKey(period) { const p = adsPeriodNorm(period); return p.from ? p.from + "_" + p.to : "d" + p.days; }
// Campagnes Google Ads réelles du client (type, budget, statut, métriques) sur une PÉRIODE choisie.
async function argosAdsCampaigns(brand, period) {
  const c = argosAdsClient(brand); if (!c) return null;
  const q = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.optimization_score, campaign_budget.amount_micros, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.average_cpc, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${gaqlDateRange(period)} ORDER BY metrics.cost_micros DESC`;
  const j = await argosGoogleAdsSearch(c.cid, q, c.login, c.devToken);
  const camps = (j.results || []).map((r) => {
    const cp = r.campaign || {}, m = r.metrics || {}, b = r.campaignBudget || {};
    const channel = cp.advertisingChannelType || "UNKNOWN";
    return { id: cp.id, name: cp.name, status: cp.status, current: cp.status === "ENABLED",
      channel, channelLabel: ADS_CHANNEL_LABELS[channel] || channel, usesKeywords: ADS_KEYWORD_CHANNELS.has(channel),
      optScore: cp.optimizationScore != null ? Math.round(+cp.optimizationScore * 100) : null,
      dailyBudget: b.amountMicros != null ? +(+b.amountMicros / 1e6).toFixed(2) : null,
      spend: +(+(m.costMicros || 0) / 1e6).toFixed(2), impressions: +(m.impressions || 0), clicks: +(m.clicks || 0),
      cpc: +((+(m.averageCpc || 0)) / 1e6).toFixed(2), conversions: +(m.conversions || 0) };
  });
  return { demo: false, period: adsPeriodNorm(period), campaigns: camps };
}
// Mots-clés Google Ads réels du client (par campagne Search) : texte, correspondance, CPC, coût, clics.
async function argosAdsKeywords(brand, period) {
  const c = argosAdsClient(brand); if (!c) return null;
  const q = `SELECT campaign.name, campaign.status, campaign.advertising_channel_type, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, metrics.average_cpc, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE ${gaqlDateRange(period)} AND ad_group_criterion.status != 'REMOVED' ORDER BY metrics.cost_micros DESC`;
  const j = await argosGoogleAdsSearch(c.cid, q, c.login, c.devToken);
  const rows = (j.results || []).map((r) => {
    const cp = r.campaign || {}, ag = r.adGroup || {}, k = (r.adGroupCriterion || {}).keyword || {}, m = r.metrics || {};
    return { keyword: k.text || null, matchType: k.matchType || null, campaign: cp.name || null, campaignStatus: cp.status || null,
      current: cp.status === "ENABLED", adGroup: ag.name || null,
      cpc: +((+(m.averageCpc || 0)) / 1e6).toFixed(2), clicks: +(m.clicks || 0), impressions: +(m.impressions || 0),
      cost: +(+(m.costMicros || 0) / 1e6).toFixed(2), conversions: +(m.conversions || 0) };
  }).filter((x) => x.keyword);
  return { demo: false, period: adsPeriodNorm(period), keywords: rows };
}
// ── « Google Trends maison » via Google Ads Keyword Planner (GRATUIT, même auth Ads) ──────────────
// Donne le volume de recherche MENSUEL sur ~4 ans (= intérêt dans le temps + saisonnalité de Trends),
// la concurrence, la fourchette de CPC, et les mots-clés associés (= related/rising queries de Trends).
const ADS_MONTHS = { JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12 };
const GEO_CONST = { france: "2250", monaco: "2492" }; // raccourcis fréquents (évite un appel de résolution)
async function argosGeoResolve(locationName, headers) {
  const name = (locationName || "").trim().toLowerCase();
  if (!name) return "geoTargetConstants/2250"; // France par défaut
  if (GEO_CONST[name]) return "geoTargetConstants/" + GEO_CONST[name];
  try {
    const j = await argosGooglePost(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/geoTargetConstants:suggest`, { locale: "fr", locationNames: { names: [locationName] } }, headers);
    const s = (j.geoTargetConstantSuggestions || [])[0];
    if (s && s.geoTargetConstant && s.geoTargetConstant.resourceName) return s.geoTargetConstant.resourceName;
  } catch {}
  return "geoTargetConstants/2250";
}
async function argosTrends(brand, keywords, locationName) {
  const c = argosAdsClient(brand); if (!c) return null;
  const kws = [...new Set((keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, 5);
  if (!kws.length) return { keywords: [], ideas: [], location: locationName || "France" };
  const headers = { "developer-token": c.devToken };
  if (c.login) headers["login-customer-id"] = String(c.login).replace(/-/g, "");
  const geo = await argosGeoResolve(locationName, headers);
  const base = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${String(c.cid).replace(/-/g, "")}`;
  const lang = "languageConstants/1002"; // français
  const toSeries = (mv) => (mv || []).map((m) => ({ y: +m.year, m: ADS_MONTHS[m.month] || 0, v: +(m.monthlySearches || 0) })).filter((x) => x.m).sort((a, b) => a.y - b.y || a.m - b.m);
  const trendPct = (s) => { if (s.length < 6) return null; const n = s.length, recent = (s[n - 1].v + s[n - 2].v + s[n - 3].v) / 3, prior = (s[n - 4].v + s[n - 5].v + s[n - 6].v) / 3; return prior ? Math.round((recent - prior) / prior * 100) : null; };
  const cpc = (mic) => mic != null ? +(+mic / 1e6).toFixed(2) : null;
  let series = [];
  try {
    const j = await argosGooglePost(`${base}:generateKeywordHistoricalMetrics`, { keywords: kws, geoTargetConstants: [geo], keywordPlanNetwork: "GOOGLE_SEARCH", language: lang, historicalMetricsOptions: { includeAverageCpc: true } }, headers);
    series = (j.results || []).map((r) => {
      const m = r.keywordMetrics || {}, s = toSeries(m.monthlySearchVolumes);
      return { keyword: r.text, avgMonthly: +(m.avgMonthlySearches || 0), competition: m.competition || null, competitionIndex: m.competitionIndex != null ? +m.competitionIndex : null, cpcLow: cpc(m.lowTopOfPageBidMicros), cpcHigh: cpc(m.highTopOfPageBidMicros), monthly: s, trendPct: trendPct(s), peak: s.length ? s.reduce((a, x) => x.v > a.v ? x : a, s[0]) : null };
    });
  } catch (e) { return { error: e.message.slice(0, 160), keywords: [], ideas: [], location: locationName || "France" }; }
  let ideas = [];
  try {
    const j = await argosGooglePost(`${base}:generateKeywordIdeas`, { keywordSeed: { keywords: kws }, geoTargetConstants: [geo], keywordPlanNetwork: "GOOGLE_SEARCH", language: lang, pageSize: 30, includeAdultKeywords: false }, headers);
    ideas = (j.results || []).map((r) => { const m = r.keywordIdeaMetrics || {}; return { keyword: r.text, avgMonthly: +(m.avgMonthlySearches || 0), competition: m.competition || null, trendPct: trendPct(toSeries(m.monthlySearchVolumes)) }; })
      .filter((x) => x.keyword && !kws.includes(x.keyword.toLowerCase()))
      .sort((a, b) => b.avgMonthly - a.avgMonthly).slice(0, 25);
  } catch {}
  return { keywords: series, ideas, location: locationName || "France" };
}
// Tendance (Google Trends maison) — gratuit (Google Ads Keyword Planner), cache-first + peek.
ipcMain.handle("argos:trends", (_e, brandId, keywords, location, forceRefresh, peek) => {
  const kws = [...new Set((keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean))].slice(0, 5);
  const extra = "t:" + (location || "").trim().toLowerCase() + ":" + kws.join("|");
  return argosCached(brandId, "trends", extra, forceRefresh, (b) => !!argosBrandAsset(b, "google_ads"),
    async (b) => { const real = await argosTrends(b, kws, location); return real ? { data: real } : null; },
    () => ({ data: { demo: true, keywords: [], ideas: [] } }), peek);
});
const ADS_AUDIENCE_LABELS = { USER_INTEREST: "Centre d'intérêt", USER_LIST: "Liste (remarketing)", AUDIENCE: "Audience", CUSTOM_AUDIENCE: "Audience personnalisée", CUSTOM_AFFINITY: "Affinité personnalisée", CUSTOM_INTENT: "Intention personnalisée", COMBINED_AUDIENCE: "Audience combinée", DETAILED_DEMOGRAPHIC: "Démographie détaillée", LIFE_EVENT: "Événement de vie", AGE_RANGE: "Âge", GENDER: "Genre", INCOME_RANGE: "Revenu", PARENTAL_STATUS: "Statut parental" };
// Segments d'audience ciblés par les campagnes du client (réel) — centres d'intérêt, listes de
// remarketing, démographie… avec leurs métriques. Pertinent surtout pour Display / notoriété.
async function argosAdsAudiences(brand, period) {
  const c = argosAdsClient(brand); if (!c) return null;
  const q = `SELECT campaign.name, campaign.status, ad_group.name, ad_group_criterion.type, ad_group_criterion.display_name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM ad_group_audience_view WHERE ${gaqlDateRange(period)} ORDER BY metrics.cost_micros DESC`;
  const j = await argosGoogleAdsSearch(c.cid, q, c.login, c.devToken);
  const rows = (j.results || []).map((r) => {
    const cp = r.campaign || {}, ag = r.adGroup || {}, cr = r.adGroupCriterion || {}, m = r.metrics || {};
    const type = cr.type || null;
    return { campaign: cp.name || null, current: cp.status === "ENABLED", adGroup: ag.name || null,
      type, typeLabel: ADS_AUDIENCE_LABELS[type] || type, name: cr.displayName || null,
      impressions: +(m.impressions || 0), clicks: +(m.clicks || 0), cost: +(+(m.costMicros || 0) / 1e6).toFixed(2), conversions: +(m.conversions || 0) };
  }).filter((x) => x.name || x.typeLabel);
  // display_name des centres d'intérêt = « uservertical::ID » (illisible) → on résout via la
  // ressource user_interest (id → nom réel, ex. « Amateurs de gastronomie »).
  if (rows.some((r) => /uservertical::\d+/.test(r.name || ""))) {
    try {
      const uj = await argosGoogleAdsSearch(c.cid, "SELECT user_interest.user_interest_id, user_interest.name FROM user_interest", c.login, c.devToken);
      const map = new Map();
      for (const u of (uj.results || [])) { const ui = u.userInterest || {}; if (ui.userInterestId != null) map.set(String(ui.userInterestId), ui.name); }
      for (const r of rows) { const mm = /uservertical::(\d+)/.exec(r.name || ""); if (mm && map.has(mm[1])) r.name = map.get(mm[1]); }
    } catch {}
  }
  return { demo: false, period: adsPeriodNorm(period), audiences: rows };
}
// Ciblage géographique des campagnes DU CLIENT (réel) : zones incluses / exclues + proximité (rayon).
// geo_target_constant renvoie un ID (geoTargetConstants/2492) → on résout le nom via la ressource.
async function argosAdsGeo(brand) {
  const c = argosAdsClient(brand); if (!c) return null;
  const q = `SELECT campaign.name, campaign.status, campaign_criterion.type, campaign_criterion.negative, campaign_criterion.location.geo_target_constant, campaign_criterion.proximity.radius, campaign_criterion.proximity.radius_units, campaign_criterion.proximity.address.city_name, campaign_criterion.proximity.address.postal_code, campaign_criterion.proximity.address.country_code FROM campaign_criterion WHERE campaign_criterion.type IN ('LOCATION','PROXIMITY')`;
  const j = await argosGoogleAdsSearch(c.cid, q, c.login, c.devToken);
  const results = j.results || [];
  const gtc = new Set();
  for (const r of results) { const loc = r.campaignCriterion?.location?.geoTargetConstant; if (loc) gtc.add(loc); }
  const nameMap = new Map();
  if (gtc.size) {
    try {
      const inList = [...gtc].map((x) => `'${x}'`).join(",");
      const gj = await argosGoogleAdsSearch(c.cid, `SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.target_type FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${inList})`, c.login, c.devToken);
      for (const g of (gj.results || [])) { const t = g.geoTargetConstant || {}; if (t.resourceName) nameMap.set(t.resourceName, { name: t.name, canonical: t.canonicalName, type: t.targetType }); }
    } catch {}
  }
  const byCamp = {};
  for (const r of results) {
    const cp = r.campaign || {}, cr = r.campaignCriterion || {};
    const nm = cp.name; if (!byCamp[nm]) byCamp[nm] = { campaign: nm, current: cp.status === "ENABLED", locations: [], excluded: [] };
    if (cr.type === "LOCATION" && cr.location?.geoTargetConstant) {
      const info = nameMap.get(cr.location.geoTargetConstant) || {};
      const entry = { name: info.canonical || info.name || cr.location.geoTargetConstant, type: (info.type || "").toLowerCase() || null };
      (cr.negative ? byCamp[nm].excluded : byCamp[nm].locations).push(entry);
    } else if (cr.type === "PROXIMITY" && cr.proximity) {
      const p = cr.proximity, a = p.address || {};
      const place = a.cityName || a.postalCode || a.countryCode || "un point";
      byCamp[nm].locations.push({ name: `${place} + ${p.radius || "?"} ${(p.radiusUnits || "").toLowerCase() || "km"} autour`, proximity: true });
    }
  }
  return { demo: false, campaigns: Object.values(byCamp) };
}
const ADS_PLACEMENT_LABELS = { WEBSITE: "Site web", MOBILE_APPLICATION: "Application", MOBILE_APP_CATEGORY: "Catégorie d'apps", YOUTUBE_VIDEO: "Vidéo YouTube", YOUTUBE_CHANNEL: "Chaîne YouTube", GOOGLE_PRODUCTS: "Produits Google" };
// EMPLACEMENTS RÉELS où le budget Display/Vidéo a été dépensé (sites, apps, vidéos/chaînes YouTube) —
// la vraie réponse à « où est parti mon argent », pas une approximation.
async function argosAdsPlacements(brand, period) {
  const c = argosAdsClient(brand); if (!c) return null;
  // Fenêtres récente (R) / antérieure (P) pour la tendance : W = min(14, moitié de la période).
  const pn = adsPeriodNorm(period);
  const endD = (pn.from && pn.to) ? pn.to : new Date().toISOString().slice(0, 10);
  const startD = (pn.from && pn.to) ? pn.from : new Date(Date.now() - (pn.days || 90) * 86400000).toISOString().slice(0, 10);
  const periodDays = Math.max(1, Math.round((new Date(endD) - new Date(startD)) / 86400000) + 1);
  const W = Math.max(1, Math.min(14, Math.floor(periodDays / 2)));
  const shift = (n) => new Date(new Date(endD).getTime() - n * 86400000).toISOString().slice(0, 10);
  const rStart = shift(W - 1), pStart = shift(2 * W - 1), pEnd = shift(W); // R = [rStart, endD] · P = [pStart, pEnd]
  // Segmenté par jour → agrégé par emplacement. `metrics.conversions` best-effort (retiré si l'API le rejette).
  const base = "detail_placement_view.display_name, detail_placement_view.placement, detail_placement_view.placement_type, detail_placement_view.target_url, campaign.id, campaign.name, campaign.status, ad_group.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros";
  // Active View = impressions RÉELLEMENT visibles. Essentiel : ~1/3 des impressions display ne sont
  // jamais vues (IAS 2025), et ce taux varie énormément d'un emplacement à l'autre → un CPM bas sur
  // un emplacement peu visible est en fait cher. Best-effort : retiré si l'API le rejette.
  const AV = ", metrics.active_view_impressions, metrics.active_view_measurable_impressions";
  const runQ = (extra) => argosGoogleAdsSearch(c.cid, `SELECT ${base}${extra} FROM detail_placement_view WHERE ${gaqlDateRange(period)} AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC`, c.login, c.devToken);
  let convSupported = true, avSupported = true, j;
  try { j = await runQ(", metrics.conversions" + AV); }
  catch {
    try { j = await runQ(", metrics.conversions"); avSupported = false; }
    catch { convSupported = false; avSupported = false; j = await runQ(""); }
  }
  const win = () => ({ impr: 0, clicks: 0, cost: 0, conv: 0 });
  const agg = new Map();
  for (const r of (j.results || [])) {
    const dp = r.detailPlacementView || {}, m = r.metrics || {}, cp = r.campaign || {}, ag = r.adGroup || {}, date = r.segments?.date || null;
    const type = dp.placementType || null;
    const key = (dp.placement || dp.displayName || "") + "|" + (cp.name || "");
    if (key === "|") continue;
    let e = agg.get(key);
    if (!e) { e = { name: dp.displayName || dp.placement || null, url: dp.targetUrl || dp.placement || null, type, typeLabel: ADS_PLACEMENT_LABELS[type] || type, placement: dp.placement || null, campaign: cp.name || null, campaignId: cp.id || null, adGroupId: ag.id || null, current: cp.status === "ENABLED", impressions: 0, clicks: 0, cost: 0, conv: 0, avImpr: 0, avMeas: 0, firstDate: null, lastDate: null, R: win(), P: win() }; agg.set(key, e); }
    const imp = +(m.impressions || 0), clk = +(m.clicks || 0), cost = +(m.costMicros || 0) / 1e6, cv = convSupported ? +(m.conversions || 0) : 0;
    e.impressions += imp; e.clicks += clk; e.cost += cost; e.conv += cv;
    if (avSupported) { e.avImpr += +(m.activeViewImpressions || 0); e.avMeas += +(m.activeViewMeasurableImpressions || 0); }
    if (date) {
      if (!e.firstDate || date < e.firstDate) e.firstDate = date; if (!e.lastDate || date > e.lastDate) e.lastDate = date;
      const w = date >= rStart ? e.R : (date >= pStart && date <= pEnd ? e.P : null);
      if (w) { w.impr += imp; w.clicks += clk; w.cost += cost; w.conv += cv; }
    }
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const rows = [...agg.values()].map((e) => {
    const daysSinceLast = e.lastDate ? Math.round((new Date(todayIso) - new Date(e.lastDate)) / 86400000) : null;
    // Visibilité mesurée (part des impressions mesurables réellement vues). null si non mesuré.
    const viewability = (avSupported && e.avMeas > 0) ? e.avImpr / e.avMeas : null;
    return { ...e, cost: +e.cost.toFixed(2), conv: +e.conv.toFixed(2), daysSinceLast, ongoing: e.current && daysSinceLast != null && daysSinceLast <= 2, convSupported, avSupported, viewability, windowDays: W };
  }).sort((a, z) => z.cost - a.cost).slice(0, 300);
  return { demo: false, period: adsPeriodNorm(period), convSupported, avSupported, windowDays: W, placements: rows };
}
// ── Exclusion / réactivation d'emplacements (ÉCRITURE réelle sur le compte Google Ads) ──
// Le seul vrai levier pour un emplacement Display automatique est le critère négatif au niveau
// campagne (campaign_criterion negative=true). « Exclure » = créer ce critère, « Réactiver » =
// le supprimer. Google conserve l'historique de perf à vie (pas de « remise à zéro »).
// Construit le sous-objet critère selon le type d'emplacement.
function adsPlacementCriterion(type, placement, url) {
  const val = placement || url || "";
  switch (type) {
    case "WEBSITE": return { placement: { url: val } };
    case "MOBILE_APPLICATION": return { mobileApplication: { appId: val } };
    case "YOUTUBE_VIDEO": return { youtubeVideo: { videoId: val } };
    case "YOUTUBE_CHANNEL": return { youtubeChannel: { channelId: val } };
    default: return null;
  }
}
// Liste les emplacements DÉJÀ exclus (critères négatifs) → clé "campaignId|type|valeur" + resourceName
// (nécessaire pour la réactivation = suppression). Best-effort, ne casse pas si l'API refuse.
async function argosAdsExclusions(brand) {
  const c = argosAdsClient(brand); if (!c) return null;
  const q = "SELECT campaign_criterion.criterion_id, campaign_criterion.resource_name, campaign_criterion.type, campaign_criterion.placement.url, campaign_criterion.mobile_application.app_id, campaign_criterion.youtube_video.video_id, campaign_criterion.youtube_channel.channel_id, campaign.id FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type IN ('PLACEMENT','MOBILE_APPLICATION','YOUTUBE_VIDEO','YOUTUBE_CHANNEL')";
  const j = await argosGoogleAdsSearch(c.cid, q, c.login, c.devToken);
  const out = {};
  for (const r of (j.results || [])) {
    const cc = r.campaignCriterion || {}, cid = r.campaign?.id || "";
    const val = cc.placement?.url || cc.mobileApplication?.appId || cc.youtubeVideo?.videoId || cc.youtubeChannel?.channelId || "";
    if (!val) continue;
    const type = cc.type === "PLACEMENT" ? "WEBSITE" : cc.type; // detail_placement_view utilise WEBSITE
    out[`${cid}|${type}|${val}`] = { resourceName: cc.resourceName, campaignId: cid, type, value: val };
  }
  return out;
}
// Liste les emplacements DÉJÀ ciblés explicitement (critères positifs au niveau groupe d'annonces =
// « emplacements gérés ») → clé "adGroupId|type|valeur" + resourceName (pour annuler la relance).
async function argosAdsManaged(brand) {
  const c = argosAdsClient(brand); if (!c) return null;
  const q = "SELECT ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.resource_name, ad_group_criterion.type, ad_group_criterion.placement.url, ad_group_criterion.mobile_application.app_id, ad_group_criterion.youtube_video.video_id, ad_group_criterion.youtube_channel.channel_id FROM ad_group_criterion WHERE ad_group_criterion.negative = FALSE AND ad_group_criterion.type IN ('PLACEMENT','MOBILE_APPLICATION','YOUTUBE_VIDEO','YOUTUBE_CHANNEL')";
  const j = await argosGoogleAdsSearch(c.cid, q, c.login, c.devToken);
  const out = {};
  for (const r of (j.results || [])) {
    const cc = r.adGroupCriterion || {}, agId = r.adGroup?.id || "";
    const val = cc.placement?.url || cc.mobileApplication?.appId || cc.youtubeVideo?.videoId || cc.youtubeChannel?.channelId || "";
    if (!val) continue;
    const type = cc.type === "PLACEMENT" ? "WEBSITE" : cc.type;
    out[`${agId}|${type}|${val}`] = { resourceName: cc.resourceName, adGroupId: agId, type, value: val };
  }
  return out;
}
// ÉCRITURE réelle. exclude/reactivate = critère négatif campagne (bloquer). target/untarget = critère
// positif groupe d'annonces (« emplacement géré » : forcer Google à recibler un bon emplacement arrêté).
async function argosAdsMutatePlacement(brand, action, spec) {
  const c = argosAdsClient(brand); if (!c) throw new Error("Compte Google Ads non résolu pour cette marque.");
  const cid = String(c.cid).replace(/-/g, "");
  const headers = { "developer-token": c.devToken };
  if (c.login) headers["login-customer-id"] = String(c.login).replace(/-/g, "");
  const V = GOOGLE_ADS_API_VERSION;
  const campUrl = `https://googleads.googleapis.com/${V}/customers/${cid}/campaignCriteria:mutate`;
  const agUrl = `https://googleads.googleapis.com/${V}/customers/${cid}/adGroupCriteria:mutate`;
  if (action === "reactivate") {
    if (!spec.resourceName) throw new Error("Exclusion introuvable (rien à réactiver).");
    const j = await argosGooglePost(campUrl, { operations: [{ remove: spec.resourceName }] }, headers);
    return { ok: true, removed: j.results?.[0]?.resourceName || spec.resourceName };
  }
  if (action === "untarget") {
    if (!spec.resourceName) throw new Error("Ciblage introuvable (rien à annuler).");
    const j = await argosGooglePost(agUrl, { operations: [{ remove: spec.resourceName }] }, headers);
    return { ok: true, removed: j.results?.[0]?.resourceName || spec.resourceName };
  }
  const crit = adsPlacementCriterion(spec.type, spec.placement, spec.url);
  if (!crit) throw new Error(`Type d'emplacement non pris en charge : ${spec.type}`);
  if (action === "target") {
    if (!spec.adGroupId) throw new Error("Groupe d'annonces inconnu pour cet emplacement.");
    const create = { adGroup: `customers/${cid}/adGroups/${spec.adGroupId}`, ...crit };
    const j = await argosGooglePost(agUrl, { operations: [{ create }] }, headers);
    return { ok: true, resourceName: j.results?.[0]?.resourceName || null };
  }
  // exclude
  if (!spec.campaignId) throw new Error("Campagne inconnue pour cet emplacement.");
  const create = { campaign: `customers/${cid}/campaigns/${spec.campaignId}`, negative: true, ...crit };
  const j = await argosGooglePost(campUrl, { operations: [{ create }] }, headers);
  return { ok: true, resourceName: j.results?.[0]?.resourceName || null };
}
// Publicité consolidée d'une marque : Meta Ads + Google Ads fusionnés dans une seule vue. Chaque
// source est best-effort (une qui échoue n'annule pas l'autre) — null seulement si AUCUNE ne
// donne de campagne, auquel cas la vue retombe en démo.
async function argosRealAdsAll(brand) {
  const [metaR, googleC] = await Promise.all([
    argosBrandAsset(brand, "meta_ads") ? argosRealAds(brand).catch(() => null) : Promise.resolve(null),
    argosBrandAsset(brand, "google_ads") ? argosRealGoogleAds(brand).catch(() => null) : Promise.resolve(null),
  ]);
  const meta = metaR || null;
  const gCamps = googleC || [];
  if (!meta && !gCamps.length) return null;
  const campaigns = [...(meta?.campaigns || []), ...gCamps];
  const totSpend = campaigns.reduce((n, c) => n + c.spend, 0);
  const totConv = campaigns.reduce((n, c) => n + c.conversions, 0);
  const wRoas = totSpend ? +(campaigns.reduce((n, c) => n + c.roas * c.spend, 0) / totSpend).toFixed(1) : 0;
  const platformSplit = [...(meta?.platformSplit || [])];
  const gSpend = gCamps.reduce((n, c) => n + c.spend, 0);
  if (gSpend) platformSplit.push({ platform: "google_ads", spend: gSpend, impressions: gCamps.reduce((n, c) => n + c.impressions, 0), clicks: gCamps.reduce((n, c) => n + c.clicks, 0) });
  platformSplit.sort((a, b) => b.spend - a.spend);
  return { demo: false, campaigns, totals: { spend: totSpend, conversions: totConv, roas: wRoas }, platformSplit, demoSplit: meta?.demoSplit || [] };
}
// Résout la Page mappée à une marque (jeton "général" — scopes Pages/Ads).
function argosBrandFbPage(brand) {
  const st = argosState();
  const pageId = argosBrandAsset(brand, "facebook");
  if (!pageId) return null;
  const pages = (st.providers.meta && st.providers.meta.assets && st.providers.meta.assets.pages) || [];
  const p = pages.find((x) => x.id === pageId);
  return p ? { page_id: p.id, access_token: p.token } : null;
}
// Résout le compte Instagram mappé à une marque (jeton dédié — scopes instagram_business_*,
// obtenu via la connexion "mode instagram" séparée). null tant que cette connexion n'a pas été faite.
function argosBrandIg(brand) {
  const st = argosState();
  const pageId = argosBrandAsset(brand, "instagram");
  if (!pageId) return null;
  // Depuis que la configuration Meta unique porte les permissions instagram_*, le jeton de la
  // connexion générale (assets.pages) suffit — plus besoin de la connexion Instagram séparée.
  const pages = (st.providers.meta && st.providers.meta.assets && st.providers.meta.assets.pages) || [];
  const p = pages.find((x) => x.id === pageId);
  if (p && p.ig_user_id) return { ig_user_id: p.ig_user_id, page_id: p.id, access_token: p.token };
  // Repli : connexion Instagram dédiée si elle existe encore (ancien flux, compat descendante).
  const igPages = (st.providers.meta && st.providers.meta.igAssets && st.providers.meta.igAssets.pages) || [];
  const pi = igPages.find((x) => x.id === pageId);
  return pi && pi.ig_user_id ? { ig_user_id: pi.ig_user_id, page_id: pi.id, access_token: pi.token } : null;
}
// Extrait un breakdown démographique {age|gender|country|city} d'une réponse ig_account_insights.
function argosParseDemoBreakdown(resp, metricName) {
  const entry = (resp?.data || []).find((d) => d.name === metricName);
  const results = entry?.total_value?.breakdowns?.[0]?.results || [];
  return results.map((r) => ({ label: r.dimension_values[0], value: r.value })).sort((a, b) => b.value - a.value);
}
// Vraies données Audience — démographie des abonnés ET de l'audience engagée (âge/genre/pays/
// ville), répartition de la portée par type de contenu (Post/Reel/Story/Pub), actions de profil.
// Instagram uniquement : Facebook n'expose pas ces breakdowns avec nos permissions actuelles.
async function argosRealAudience(brand) {
  const igCtx = argosBrandIg(brand);
  if (!igCtx) return null;
  const call = (metric, extra) => argosApiCall("instagram", "ig_account_insights", { metric, period: "lifetime", metric_type: "total_value", timeframe: "last_30_days", ...extra }, igCtx).catch(() => null);
  const [ageR, genderR, countryR, cityR, engAgeR, engGenderR, reachTypeR, actionsR] = await Promise.all([
    call("follower_demographics", { breakdown: "age" }),
    call("follower_demographics", { breakdown: "gender" }),
    call("follower_demographics", { breakdown: "country" }),
    call("follower_demographics", { breakdown: "city" }),
    call("engaged_audience_demographics", { breakdown: "age", timeframe: "this_month" }),
    call("engaged_audience_demographics", { breakdown: "gender", timeframe: "this_month" }),
    argosApiCall("instagram", "ig_account_insights", { metric: "reach", period: "day", metric_type: "total_value", timeframe: "last_30_days", breakdown: "media_product_type" }, igCtx).catch(() => null),
    argosApiCall("instagram", "ig_account_insights", { metric: "website_clicks,profile_links_taps,accounts_engaged", period: "day", metric_type: "total_value", timeframe: "last_30_days" }, igCtx).catch(() => null),
  ]);
  const followerAge = argosParseDemoBreakdown(ageR, "follower_demographics");
  const followerGender = argosParseDemoBreakdown(genderR, "follower_demographics");
  const followerCountry = argosParseDemoBreakdown(countryR, "follower_demographics").slice(0, 8);
  const followerCity = argosParseDemoBreakdown(cityR, "follower_demographics").slice(0, 8);
  if (!followerAge.length && !followerGender.length && !followerCountry.length) return null; // rien d'exploitable
  const engagedAge = argosParseDemoBreakdown(engAgeR, "engaged_audience_demographics");
  const engagedGender = argosParseDemoBreakdown(engGenderR, "engaged_audience_demographics");
  const reachEntry = (reachTypeR?.data || []).find((d) => d.name === "reach");
  const contentReach = (reachEntry?.total_value?.breakdowns?.[0]?.results || []).map((r) => ({ type: r.dimension_values[0], reach: r.value })).sort((a, b) => b.reach - a.reach);
  const totalReachAllTypes = reachEntry?.total_value?.value || 0;
  const val = (name) => (actionsR?.data || []).find((d) => d.name === name)?.total_value?.value || 0;
  return { demo: false, followerAge, followerGender, followerCountry, followerCity, engagedAge, engagedGender, contentReach, totalReachAllTypes, actions: { websiteClicks: val("website_clicks"), profileLinksTaps: val("profile_links_taps"), accountsEngaged: val("accounts_engaged") } };
}
// Démo déterministe pour Audience — même principe que les autres générateurs (seedé par marque).
function argosDemoAudience(brand) {
  const rng = argosRng(brand.id + ":audience");
  const buckets = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
  const total = 800 + Math.round(rng() * 3000);
  const weights = buckets.map(() => rng()); const wsum = weights.reduce((a, b) => a + b, 0);
  const followerAge = buckets.map((label, i) => ({ label, value: Math.round((weights[i] / wsum) * total) })).sort((a, b) => b.value - a.value);
  const fem = Math.round(total * (0.35 + rng() * 0.35));
  const followerGender = [{ label: "F", value: fem }, { label: "M", value: total - fem }];
  const countries = ["FR", "MC", "IT", "GB", "US", "DE", "BE", "CH"];
  const followerCountry = countries.slice(0, 5 + Math.floor(rng() * 3)).map((c) => ({ label: c, value: Math.round(rng() * total * 0.3) })).sort((a, b) => b.value - a.value);
  const cities = ["Monaco", "Nice", "Paris", "London", "Milan", "Genève", "Cannes"];
  const followerCity = cities.slice(0, 4 + Math.floor(rng() * 3)).map((c) => ({ label: c, value: Math.round(rng() * total * 0.2) })).sort((a, b) => b.value - a.value);
  const engagedAge = followerAge.map((x) => ({ label: x.label, value: Math.round(x.value * (0.04 + rng() * 0.08)) }));
  const engagedGender = followerGender.map((x) => ({ label: x.label, value: Math.round(x.value * (0.04 + rng() * 0.08)) }));
  const types = ["POST", "REEL", "STORY", "CAROUSEL_CONTAINER", "AD"];
  const contentReach = types.map((t) => ({ type: t, reach: Math.round(rng() * 3000) })).sort((a, b) => b.reach - a.reach);
  const totalReachAllTypes = contentReach.reduce((n, x) => n + x.reach, 0);
  return { demo: true, followerAge, followerGender, followerCountry, followerCity, engagedAge, engagedGender, contentReach, totalReachAllTypes, actions: { websiteClicks: Math.round(rng() * 200), profileLinksTaps: Math.round(rng() * 150), accountsEngaged: Math.round(rng() * 500) } };
}
// ══ Google Analytics 4 (Data API) — trafic du site mappé à une marque ══
// "YYYYMMDD" (dimension date GA4) → "YYYY-MM-DD".
function ga4Date(s) { return s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s; }
async function argosRealWebAnalytics(brand, days) {
  const prop = argosBrandAsset(brand, "google_analytics"); // ex: "properties/481185730"
  if (!prop) return null;
  const property = prop.startsWith("properties/") ? prop : "properties/" + prop;
  const base = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  const range = [{ startDate: `${days}daysAgo`, endDate: "today" }];
  const [byDateR, chanR, pagesR] = await Promise.all([
    argosGooglePost(base, { dateRanges: range, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }, { name: "conversions" }], orderBys: [{ dimension: { dimensionName: "date" } }] }),
    argosGooglePost(base, { dateRanges: range, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 8 }).catch(() => null),
    argosGooglePost(base, { dateRanges: range, dimensions: [{ name: "pageTitle" }], metrics: [{ name: "screenPageViews" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 8 }).catch(() => null),
  ]);
  const mv = (row, i) => +(row.metricValues?.[i]?.value || 0);
  const byDay = (byDateR.rows || []).map((r) => ({ date: ga4Date(r.dimensionValues?.[0]?.value), sessions: mv(r, 0), users: mv(r, 1), pageviews: mv(r, 2), conversions: mv(r, 3) }));
  const totals = byDay.reduce((t, x) => ({ sessions: t.sessions + x.sessions, users: t.users + x.users, pageviews: t.pageviews + x.pageviews, conversions: t.conversions + x.conversions }), { sessions: 0, users: 0, pageviews: 0, conversions: 0 });
  const channels = (chanR?.rows || []).map((r) => ({ label: r.dimensionValues?.[0]?.value || "—", value: mv(r, 0) }));
  const topPages = (pagesR?.rows || []).map((r) => ({ label: r.dimensionValues?.[0]?.value || "—", value: mv(r, 0) }));
  return { demo: false, property, totals, byDay, channels, topPages };
}
function argosDemoWeb(brand, days) {
  const rng = argosRng(brand.id + ":web");
  const base = 120 + rng() * 900;
  const byDay = []; const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const wk = (d.getDay() === 0 || d.getDay() === 6) ? 0.7 : 1;
    const sessions = Math.round(base * wk * (0.7 + rng() * 0.7));
    byDay.push({ date: isoLocalD(d), sessions, users: Math.round(sessions * (0.75 + rng() * 0.2)), pageviews: Math.round(sessions * (1.8 + rng() * 1.5)), conversions: Math.round(sessions * (0.01 + rng() * 0.03)) });
  }
  const totals = byDay.reduce((t, x) => ({ sessions: t.sessions + x.sessions, users: t.users + x.users, pageviews: t.pageviews + x.pageviews, conversions: t.conversions + x.conversions }), { sessions: 0, users: 0, pageviews: 0, conversions: 0 });
  const channels = [["Organic Search", .38], ["Direct", .24], ["Paid Search", .16], ["Social", .12], ["Referral", .1]].map(([label, f]) => ({ label, value: Math.round(totals.sessions * f * (0.8 + rng() * 0.4)) }));
  const topPages = ["Accueil", "Nos services", "À propos", "Contact", "Blog"].map((label) => ({ label, value: Math.round(totals.pageviews * (0.05 + rng() * 0.2)) })).sort((a, b) => b.value - a.value);
  return { demo: true, totals, byDay, channels, topPages };
}
// ══ Core Web Vitals (PageSpeed Insights / Lighthouse) — GRATUIT, sur le site mappé ══
// Niveau 3 de la cascade : API Google gratuite. URL = site Search Console de la marque.
async function argosRealVitals(brand) {
  const site = argosBrandAsset(brand, "search_console");
  if (!site) return null;
  const url = site.replace(/\/+$/, "");
  // Appel AUTHENTIFIÉ (token Google OAuth) → quota du projet 693842101251, au lieu du quota
  // anonyme partagé (429 systématique). Nécessite "PageSpeed Insights API" activée dans le projet.
  const call = async (strategy) => {
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance`;
    const j = await argosGoogleGet(api);
    const lh = j.lighthouseResult || {}, a = lh.audits || {};
    const num = (id) => a[id]?.numericValue;
    return { score: Math.round((lh.categories?.performance?.score || 0) * 100), lcp: num("largest-contentful-paint"), inp: num("interaction-to-next-paint") ?? num("experimental-interaction-to-next-paint"), cls: num("cumulative-layout-shift"), fcp: num("first-contentful-paint"), tbt: num("total-blocking-time") };
  };
  const [mobile, desktop] = await Promise.all([call("mobile").catch(() => null), call("desktop").catch(() => null)]);
  if (!mobile && !desktop) return null;
  return { demo: false, url, mobile, desktop };
}
function argosDemoVitals(brand) {
  const rng = argosRng(brand.id + ":cwv");
  const gen = () => ({ score: Math.round(55 + rng() * 40), lcp: 1500 + rng() * 2500, inp: 90 + rng() * 250, cls: +(rng() * 0.25).toFixed(3), fcp: 900 + rng() * 1500, tbt: 100 + rng() * 400 });
  return { demo: true, url: null, mobile: gen(), desktop: gen() };
}
// ══ Search Console (searchAnalytics.query) — SEO du site mappé à une marque ══
async function argosRealSeo(brand, days) {
  const siteRaw = argosBrandAsset(brand, "search_console"); // ex: "https://chezteva.com/"
  if (!siteRaw) return null;
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteRaw)}/searchAnalytics/query`;
  const endDate = isoLocalD(new Date());
  const startDate = isoLocalD(new Date(Date.now() - days * 86400000));
  const q = (dims, rowLimit) => argosGooglePost(endpoint, { startDate, endDate, dimensions: dims, rowLimit }).catch(() => null);
  const [byDateR, queriesR, pagesR] = await Promise.all([q(["date"], 500), q(["query"], 12), q(["page"], 10)]);
  const byDay = (byDateR?.rows || []).map((r) => ({ date: r.keys?.[0], clicks: +(r.clicks || 0), impressions: +(r.impressions || 0) }));
  const totClicks = byDay.reduce((n, x) => n + x.clicks, 0);
  const totImpr = byDay.reduce((n, x) => n + x.impressions, 0);
  // CTR et position moyens pondérés par impressions sur la période entière (via la ligne agrégée).
  let ctr = totImpr ? totClicks / totImpr : 0, position = 0, posW = 0;
  for (const r of (byDateR?.rows || [])) { position += (+r.position || 0) * (+r.impressions || 0); posW += (+r.impressions || 0); }
  position = posW ? position / posW : 0;
  const topQueries = (queriesR?.rows || []).map((r) => ({ label: r.keys?.[0] || "—", clicks: +(r.clicks || 0), impressions: +(r.impressions || 0), ctr: +(r.ctr || 0), position: +(r.position || 0) }));
  const topPages = (pagesR?.rows || []).map((r) => ({ label: (r.keys?.[0] || "—").replace(/^https?:\/\/[^/]+/, "") || "/", clicks: +(r.clicks || 0), impressions: +(r.impressions || 0) }));
  return { demo: false, site: siteRaw, totals: { clicks: totClicks, impressions: totImpr, ctr: +(ctr * 100).toFixed(1), position: +position.toFixed(1) }, byDay, topQueries, topPages };
}
function argosDemoSeo(brand, days) {
  const rng = argosRng(brand.id + ":seo");
  const base = 30 + rng() * 250;
  const byDay = []; const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const clicks = Math.round(base * (0.7 + rng() * 0.7));
    byDay.push({ date: isoLocalD(d), clicks, impressions: Math.round(clicks * (14 + rng() * 20)) });
  }
  const totClicks = byDay.reduce((n, x) => n + x.clicks, 0);
  const totImpr = byDay.reduce((n, x) => n + x.impressions, 0);
  const QS = ["photographe monaco", "shooting produit", "studio photo", "book mannequin", "vidéaste événementiel", "retouche photo pro", "portrait corporate"];
  const topQueries = QS.map((label) => { const impressions = Math.round(200 + rng() * 4000); const ctr = 0.01 + rng() * 0.09; return { label, impressions, clicks: Math.round(impressions * ctr), ctr, position: +(1 + rng() * 30).toFixed(1) }; }).sort((a, b) => b.clicks - a.clicks);
  const topPages = ["/", "/services", "/portfolio", "/contact", "/blog"].map((label) => { const impressions = Math.round(300 + rng() * 3000); return { label, impressions, clicks: Math.round(impressions * (0.02 + rng() * 0.08)) }; }).sort((a, b) => b.clicks - a.clicks);
  return { demo: true, totals: { clicks: totClicks, impressions: totImpr, ctr: +((totClicks / (totImpr || 1)) * 100).toFixed(1), position: +(3 + rng() * 12).toFixed(1) }, byDay, topQueries, topPages };
}
// ══ SEO Intelligence (gratuit, 100% calculé en local depuis Search Console) ══
// Cannibalisation : requêtes où PLUSIEURS pages du site se positionnent (elles se concurrencent).
// Quick-wins : requêtes en position 4-20 avec du volume (remonter = gain rapide).
// Chutes A/B : requêtes ayant perdu clics/position vs la période précédente de même durée.
const clean = (u) => (u || "").replace(/^https?:\/\/[^/]+/, "") || "/";
async function argosRealSeoIntel(brand, days) {
  const site = argosBrandAsset(brand, "search_console");
  if (!site) return null;
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const end = isoLocalD(new Date());
  const start = isoLocalD(new Date(Date.now() - days * 86400000));
  const prevEnd = isoLocalD(new Date(Date.now() - (days + 1) * 86400000));
  const prevStart = isoLocalD(new Date(Date.now() - (2 * days + 1) * 86400000));
  const q = (body) => argosGooglePost(endpoint, body).catch(() => null);
  const [qpNow, qNow, qPrev] = await Promise.all([
    q({ startDate: start, endDate: end, dimensions: ["query", "page"], rowLimit: 2000 }),
    q({ startDate: start, endDate: end, dimensions: ["query"], rowLimit: 1000 }),
    q({ startDate: prevStart, endDate: prevEnd, dimensions: ["query"], rowLimit: 1000 }),
  ]);
  // Cannibalisation
  const byQuery = new Map();
  for (const r of (qpNow?.rows || [])) {
    const [query, page] = r.keys || [];
    if (!byQuery.has(query)) byQuery.set(query, []);
    byQuery.get(query).push({ page, clicks: +(r.clicks || 0), impressions: +(r.impressions || 0), position: +(r.position || 0) });
  }
  const cannibal = [...byQuery.entries()]
    .filter(([, pages]) => pages.length >= 2 && pages.reduce((n, p) => n + p.impressions, 0) >= 50)
    .map(([query, pages]) => ({ query, pages: pages.length, impressions: pages.reduce((n, p) => n + p.impressions, 0), clicks: pages.reduce((n, p) => n + p.clicks, 0), urls: pages.sort((a, b) => b.clicks - a.clicks).slice(0, 3).map((p) => ({ url: clean(p.page), clicks: p.clicks, position: +p.position.toFixed(1) })) }))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 15);
  // Quick-wins (striking distance : position 4-20)
  const quickWins = (qNow?.rows || []).map((r) => ({ query: r.keys[0], clicks: +(r.clicks || 0), impressions: +(r.impressions || 0), ctr: +(r.ctr || 0), position: +(r.position || 0) }))
    .filter((x) => x.position >= 4 && x.position <= 20 && x.impressions >= 30)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 15);
  // Chutes A/B
  const prevMap = new Map((qPrev?.rows || []).map((r) => [r.keys[0], { clicks: +(r.clicks || 0), position: +(r.position || 0) }]));
  const drops = (qNow?.rows || []).map((r) => {
    const query = r.keys[0], prev = prevMap.get(query);
    if (!prev) return null;
    return { query, clicks: +(r.clicks || 0), prevClicks: prev.clicks, dClicks: +(r.clicks || 0) - prev.clicks, position: +(r.position || 0), prevPosition: prev.position, dPos: +(+(r.position || 0) - prev.position).toFixed(1) };
  }).filter((x) => x && x.prevClicks >= 3 && (x.dClicks <= -3 || x.dPos >= 1.5))
    .sort((a, b) => a.dClicks - b.dClicks).slice(0, 15);
  return { demo: false, cannibal, quickWins, drops };
}
function argosDemoSeoIntel(brand) {
  const rng = argosRng(brand.id + ":seoi");
  const QS = ["restaurant monaco", "meilleur resto monaco", "brunch monaco", "réserver table monaco", "menu du jour monaco", "restaurant vue mer"];
  const cannibal = QS.slice(0, 3).map((query) => ({ query, pages: 2 + Math.round(rng() * 2), impressions: Math.round(200 + rng() * 2000), clicks: Math.round(rng() * 40), urls: [{ url: "/", clicks: Math.round(rng() * 30), position: +(2 + rng() * 5).toFixed(1) }, { url: "/menu", clicks: Math.round(rng() * 15), position: +(6 + rng() * 8).toFixed(1) }] }));
  const quickWins = QS.map((query) => ({ query, clicks: Math.round(rng() * 20), impressions: Math.round(100 + rng() * 3000), ctr: 0.01 + rng() * 0.05, position: +(4 + rng() * 14).toFixed(1) })).sort((a, b) => b.impressions - a.impressions).slice(0, 6);
  const drops = QS.slice(0, 4).map((query) => { const prevClicks = 8 + Math.round(rng() * 40); const dClicks = -(2 + Math.round(rng() * 15)); return { query, clicks: prevClicks + dClicks, prevClicks, dClicks, position: +(3 + rng() * 10).toFixed(1), prevPosition: +(2 + rng() * 6).toFixed(1), dPos: +(rng() * 4).toFixed(1) }; });
  return { demo: true, cannibal, quickWins, drops };
}
// ══ Audit technique (crawler léger, GRATUIT) — nos propres fetchs sur le site du client ══
// Extraction SEO par regex (pas de dépendance parseur) : suffisant pour les balises head/SEO.
function argosParseSeo(html) {
  const first = (re) => { const x = html.match(re); return x ? x[1].replace(/\s+/g, " ").trim() : null; };
  const title = first(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const desc = first(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || first(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  const canonical = first(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);
  const robots = first(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i) || "";
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imgNoAlt = imgs.filter((t) => !/\balt\s*=\s*["'][^"']/i.test(t)).length;
  const links = [...html.matchAll(/<a\b[^>]+href=["']([^"']+)["']/gi)].map((x) => x[1]).filter((h) => !/^(mailto:|tel:|javascript:)/i.test(h));
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
  const words = (text.match(/[^\s]+/g) || []).length;
  return { title, desc, h1, canonical, noindex: /noindex/i.test(robots), imgCount: imgs.length, imgNoAlt, links, words };
}
async function argosCrawl(brand, { maxPages = 80, maxDepth = 3, concurrency = 5 } = {}) {
  const site = argosBrandAsset(brand, "search_console");
  if (!site) throw new Error("Aucun site Search Console mappé à ce client — associe-le d'abord dans Titan.");
  let origin; try { origin = new URL(/^https?:\/\//.test(site) ? site : "https://" + site).origin; } catch { throw new Error("URL de site invalide."); }
  const norm = (u) => { try { const x = new URL(u); return (x.origin + x.pathname).replace(/\/$/, "") || x.origin; } catch { return u; } };
  const start = origin + "/";
  const seen = new Set([norm(start)]);
  let queue = [{ url: start, depth: 0 }];
  const pages = []; const linkedTo = new Set();
  while (queue.length && pages.length < maxPages) {
    const batch = queue.splice(0, concurrency);
    await Promise.all(batch.map(async ({ url, depth }) => {
      if (pages.length >= maxPages) return;
      let r; try { r = await timedFetch(url, { redirect: "follow" }, 9000); } catch { pages.push({ url: norm(url), status: 0, error: true, depth }); return; }
      const status = r.status, finalUrl = r.url, ct = (r.headers.get("content-type") || "");
      const rec = { url: norm(url), status, depth, redirected: norm(finalUrl) !== norm(url) };
      if (status >= 200 && status < 300 && /text\/html/i.test(ct)) {
        const html = await r.text().catch(() => "");
        const seo = argosParseSeo(html);
        rec.title = seo.title; rec.desc = seo.desc; rec.h1 = seo.h1; rec.canonical = seo.canonical; rec.noindex = seo.noindex; rec.imgNoAlt = seo.imgNoAlt; rec.words = seo.words;
        if (depth < maxDepth) for (const link of seo.links) {
          try { const abs = new URL(link, url); if (abs.origin === origin && /^https?:/.test(abs.protocol)) { const n = norm(abs.href); linkedTo.add(n); if (!seen.has(n) && seen.size < maxPages * 4 && !/\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|css|js|ico|woff2?|mp4|xml)$/i.test(abs.pathname)) { seen.add(n); queue.push({ url: abs.origin + abs.pathname, depth: depth + 1 }); } } } catch {}
        }
      }
      pages.push(rec);
    }));
  }
  // ── Agrégation des problèmes ──
  const html2xx = pages.filter((p) => p.status >= 200 && p.status < 300 && p.title !== undefined);
  const titleMap = new Map();
  for (const p of html2xx) if (p.title) titleMap.set(p.title, (titleMap.get(p.title) || 0) + 1);
  const dupTitles = html2xx.filter((p) => p.title && titleMap.get(p.title) > 1);
  const broken = pages.filter((p) => p.status >= 400 || p.status === 0);
  const redirects = pages.filter((p) => p.redirected && p.status >= 200 && p.status < 400);
  const noTitle = html2xx.filter((p) => !p.title);
  const noDesc = html2xx.filter((p) => !p.desc);
  const badH1 = html2xx.filter((p) => p.h1 !== 1);
  const noindex = html2xx.filter((p) => p.noindex);
  const noCanon = html2xx.filter((p) => !p.canonical);
  const thin = html2xx.filter((p) => (p.words || 0) < 150);
  const imgAlt = html2xx.reduce((n, p) => n + (p.imgNoAlt || 0), 0);
  // ── Health Score (pondéré, plafonné par catégorie) ──
  const cap = (v, m) => Math.min(v, m);
  let penalty = 0;
  penalty += cap(broken.length * 4, 30);
  penalty += cap(redirects.length * 0.5, 8);
  penalty += cap(noTitle.length * 3, 15);
  penalty += cap(dupTitles.length * 1.5, 10);
  penalty += cap(noDesc.length * 0.5, 8);
  penalty += cap(badH1.length * 1, 10);
  penalty += cap(noindex.length * 2, 12);
  penalty += cap(noCanon.length * 0.4, 6);
  penalty += cap(thin.length * 0.5, 8);
  penalty += cap(imgAlt * 0.1, 6);
  const healthScore = Math.max(0, Math.round(100 - penalty));
  // ── Tickets d'action priorisés ──
  const T = [];
  const push = (sev, count, label, sample) => { if (count) T.push({ sev, count, label, sample: (sample || []).slice(0, 5) }); };
  push("high", broken.length, "Pages en erreur (404/5xx) à corriger ou rediriger", broken.map((p) => p.url));
  push("high", noindex.length, "Pages en noindex (vérifier si volontaire)", noindex.map((p) => p.url));
  push("high", noTitle.length, "Pages sans balise <title>", noTitle.map((p) => p.url));
  push("med", dupTitles.length, "Titres dupliqués (même <title> sur plusieurs pages)", dupTitles.map((p) => p.url));
  push("med", badH1.length, "Pages sans H1 unique (0 ou plusieurs)", badH1.map((p) => p.url));
  push("med", redirects.length, "Redirections internes à mettre à jour", redirects.map((p) => p.url));
  push("low", noDesc.length, "Pages sans meta description", noDesc.map((p) => p.url));
  push("low", thin.length, "Pages au contenu léger (< 150 mots)", thin.map((p) => p.url));
  push("low", noCanon.length, "Pages sans balise canonical", noCanon.map((p) => p.url));
  push("low", imgAlt, "Images sans attribut ALT", []);
  const sevRank = { high: 0, med: 1, low: 2 };
  T.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || b.count - a.count);
  return { demo: false, origin, pages: pages.length, indexable: html2xx.length - noindex.length, healthScore, tickets: T, at: new Date().toISOString() };
}
// Vraies données Aperçu — Instagram (si la connexion dédiée existe) + Facebook (posts + champs
// publics de Page ; pas d'insights Facebook tant que read_insights n'est pas accordé).
// Principe strict : ce qui n'est pas accessible reste à 0/vide plutôt qu'estimé — jamais de
// chiffre inventé présenté comme réel.
// ── Cache local "stale-while-revalidate" pour les marques mappées à un vrai compte Meta ──
// Le premier chargement d'une marque reste réel (attend l'appel Meta), mais tout rechargement
// suivant renvoie IMMÉDIATEMENT la dernière donnée connue et rafraîchit en tâche de fond —
// l'utilisateur ne voit jamais l'attente réseau après la toute première fois. Marques en démo :
// pas de cache, c'est déjà instantané (calcul local, aucun appel réseau).
const ARGOS_STALE_MS = 6 * 60 * 60 * 1000; // 6 h — seuil « à rafraîchir » (affichage + prewarm), PAS une expiration de lecture
// Politique cache-first (Obj 1 : revoir une donnée ne rappelle JAMAIS l'API) :
//  · lecture (défaut) : sert l'entrée en cache quel que soit son âge ; ne fetch QUE si absente. Aucun refetch en fond.
//  · peek=true : cache-only strict, jamais d'appel (pour le lecteur de snapshot / générateur de rapport).
//  · forceRefresh=true : refetch + recache (boutons « rafraîchir »).
async function argosCached(brandId, kind, extra, forceRefresh, hasRealSource, realFn, demoFn, peek) {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  if (!hasRealSource(b)) return { ok: true, ...demoFn(b) }; // démo synthétique, gratuite, non cachée
  const key = brandId + ":" + kind + (extra != null ? ":" + extra : "");
  const cached = st.cache[key];
  // realFn renvoie la forme COMPLÈTE à mettre en cache (ex: {data:...}) — null si indisponible → demoFn.
  const doRefresh = async () => {
    let result;
    try { const real = await realFn(b); result = real || demoFn(b); }
    catch (e) { result = { ...demoFn(b), warning: "Compte mappé mais l'appel réel a échoué (" + e.message + ") — données de démonstration affichées." }; }
    const st2 = argosState(); st2.cache[key] = { ...result, fetchedAt: Date.now() }; argosSave(st2);
    return result;
  };
  if (peek) return cached ? { ok: true, ...cached, cached: true } : { ok: true, data: null, peeked: true };
  if (forceRefresh) return { ok: true, ...(await doRefresh()) };
  if (cached) return { ok: true, ...cached, cached: true, stale: Date.now() - (cached.fetchedAt || 0) > ARGOS_STALE_MS };
  return { ok: true, ...(await doRefresh()) }; // absente → un seul fetch
}
async function argosRealOverview(brand, days) {
  const igCtx = argosBrandIg(brand);
  const fbCtx = argosBrandFbPage(brand);
  if (!igCtx && !fbCtx) return null;
  const perNet = []; let followers = 0, published = 0, totalInteractions = 0;
  const topPosts = []; const byDayMap = new Map();
  const nowSec = Math.floor(Date.now() / 1000), sinceSec = nowSec - days * 86400;
  // Instagram et Facebook interrogés EN PARALLÈLE (Promise.all), ainsi que les insights des
  // 4 posts vedettes entre eux — c'était strictement séquentiel avant, d'où la lenteur perçue.
  const fetchIg = async () => {
    if (!igCtx) return;
    try {
      const [acc, reachIns, eng, media] = await Promise.all([
        argosApiCall("instagram", "ig_account", { fields: "username,followers_count,media_count" }, igCtx),
        argosApiCall("instagram", "ig_account_insights", { metric: "reach", period: "day", metric_type: "time_series", since: sinceSec, until: nowSec }, igCtx).catch(() => null),
        argosApiCall("instagram", "ig_account_insights", { metric: "total_interactions", period: "day", metric_type: "total_value", since: sinceSec, until: nowSec }, igCtx).catch(() => null),
        argosApiCall("instagram", "ig_media_list", { fields: "id,caption,timestamp,like_count,comments_count", limit: 25 }, igCtx).catch(() => null),
      ]);
      followers += +(acc.followers_count || 0);
      const igNet = { network: "instagram", handle: "@" + (acc.username || ""), followers: +(acc.followers_count || 0), growth: 0, engagement: 0, posts: 0 };
      perNet.push(igNet);
      if (reachIns) {
        const series = (reachIns.data || []).find((d) => d.name === "reach");
        (series?.values || []).forEach((v) => { const d = (v.end_time || "").slice(0, 10); if (d) byDayMap.set(d, (byDayMap.get(d) || 0) + (v.value || 0)); });
      }
      if (eng) totalInteractions += +(eng.data?.[0]?.total_value?.value || 0);
      if (media) {
        const items = (media.data || []).filter((m) => !m.timestamp || new Date(m.timestamp).getTime() / 1000 >= sinceSec);
        igNet.posts = items.length; published += items.length;
        const top = items.slice().sort((a, b) => (b.like_count || 0) - (a.like_count || 0)).slice(0, 4);
        await Promise.all(top.map(async (m) => {
          const title = (m.caption || "Publication").replace(/\s+/g, " ").slice(0, 44) || "Publication";
          const date = (m.timestamp || "").slice(0, 10);
          try {
            const ins = await argosApiCall("instagram", "ig_media_insights", { metric: "views,reach,total_interactions" }, { ...igCtx, ig_media_id: m.id });
            const val = (name) => (ins.data || []).find((d) => d.name === name)?.values?.[0]?.value || 0;
            const r = val("reach"), ti = val("total_interactions");
            topPosts.push({ id: m.id, network: "instagram", title, reach: r, eng: r ? +((ti / r) * 100).toFixed(1) : 0, date });
          } catch { topPosts.push({ id: m.id, network: "instagram", title, reach: 0, eng: 0, date }); }
        }));
      }
    } catch (e) { /* Instagram indisponible (permission manquante ou autre) — on continue avec Facebook si dispo */ }
  };
  // Métriques de Page confirmées valides en v25 (page_impressions_unique/page_reach/page_fans
  // sont dépréciées et renvoient une erreur — testé en direct le 21/07).
  let fbInsights = null;
  const fetchFb = async () => {
    if (!fbCtx) return;
    try {
      const [info, posts, pageIns] = await Promise.all([
        argosApiCall("facebook", "fb_page_basic", { fields: "name,fan_count,followers_count" }, fbCtx),
        argosApiCall("facebook", "fb_page_posts", { fields: "id,message,created_time,permalink_url,likes.summary(true),comments.summary(true)", limit: 25 }, fbCtx).catch(() => null),
        argosApiCall("facebook", "fb_page_insights", { metric: "page_post_engagements,page_views_total,page_follows", period: "day", since: sinceSec, until: nowSec }, fbCtx).catch(() => null),
      ]);
      followers += +(info.followers_count || info.fan_count || 0);
      const fbNet = { network: "facebook", handle: info.name || "", followers: +(info.followers_count || info.fan_count || 0), growth: 0, engagement: 0, posts: 0 };
      perNet.push(fbNet);
      if (posts) {
        const items = (posts.data || []).filter((p) => !p.created_time || new Date(p.created_time).getTime() / 1000 >= sinceSec);
        fbNet.posts = items.length; published += items.length;
      }
      if (pageIns) {
        const sum = (name) => ((pageIns.data || []).find((d) => d.name === name)?.values || []).reduce((n, v) => n + (+v.value || 0), 0);
        const postEngagements = sum("page_post_engagements"), pageViews = sum("page_views_total"), newFollows = sum("page_follows");
        fbInsights = { postEngagements, pageViews, newFollows };
        // page_post_engagements n'est pas une portée mais une vraie mesure d'engagement Page —
        // on l'utilise pour un % d'engagement Facebook honnête plutôt que de laisser 0.
        if (fbNet.posts) fbNet.engagement = +((postEngagements / Math.max(1, fbNet.followers)) * 100).toFixed(2);
      }
    } catch (e) { /* Facebook indisponible — n'empêche pas l'affichage des données Instagram déjà collectées */ }
  };
  await Promise.all([fetchIg(), fetchFb()]);
  const reach = [...byDayMap.values()].reduce((n, v) => n + v, 0);
  const engagement = reach ? +((totalInteractions / reach) * 100).toFixed(1) : 0;
  const igNet = perNet.find((n) => n.network === "instagram"); if (igNet) igNet.engagement = engagement;
  const byDay = [...byDayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, r]) => ({ date, reach: r, eng: 0 }));
  topPosts.sort((a, b) => b.reach - a.reach);
  return { demo: false, days, followers, reach, engagement, published, byDay, perNet, topPosts, health: null, alerts: [], fbInsights };
}
// Vraies données Inbox — commentaires Facebook (réels, pages_read_engagement suffit) + DM/commentaires
// Instagram si la connexion dédiée existe. Pas de messagerie Facebook (scope non demandé à l'app).
async function argosRealInbox(brand) {
  const igCtx = argosBrandIg(brand);
  const fbCtx = argosBrandFbPage(brand);
  if (!igCtx && !fbCtx) return null;
  const convs = [];
  const hoursSince = (t) => t ? Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 3600000)) : 0;
  // Tout est parallélisé : les commentaires des 8 posts FB entre eux, ceux des 8 médias IG
  // entre eux, et les 3 blocs (FB, IG commentaires, IG DM) ensemble — avant : ~17 appels Graph
  // API strictement en série, cause directe de la lenteur de l'onglet Inbox.
  const fbBlock = async () => {
    if (!fbCtx) return;
    const posts = await argosApiCall("facebook", "fb_page_posts", { fields: "id,message,permalink_url", limit: 10 }, fbCtx).catch(() => null);
    if (!posts) return;
    await Promise.all((posts.data || []).slice(0, 8).map((p) =>
      argosApiCall("facebook", "fb_page_comments", { fields: "from,message,created_time", limit: 5 }, { ...fbCtx, page_post_id: p.id })
        .then((c) => { for (const cm of (c.data || [])) convs.push({ id: cm.id, network: "facebook", from: cm.from?.name || "Anonyme", kind: "commentaire", text: cm.message || "", hoursAgo: hoursSince(cm.created_time), unread: false, replies: [] }); })
        .catch(() => {})));
  };
  const igCommentsBlock = async () => {
    if (!igCtx) return;
    const media = await argosApiCall("instagram", "ig_media_list", { fields: "id", limit: 10 }, igCtx).catch(() => null);
    if (!media) return;
    await Promise.all((media.data || []).slice(0, 8).map((m) =>
      argosApiCall("instagram", "ig_comments", { fields: "id,text,username,timestamp" }, { ...igCtx, ig_media_id: m.id })
        .then((c) => { for (const cm of (c.data || [])) convs.push({ id: cm.id, network: "instagram", from: cm.username || "Compte Instagram", kind: "commentaire", text: cm.text || "", hoursAgo: hoursSince(cm.timestamp), unread: false, replies: [] }); })
        .catch(() => {})));
  };
  const igDmBlock = async () => {
    if (!igCtx) return;
    const dms = await argosApiCall("instagram", "ig_conversations", { platform: "instagram", fields: "participants,updated_time,messages{message,from,created_time}" }, igCtx).catch(() => null);
    if (!dms) return;
    for (const conv of (dms.data || [])) {
      const lastMsg = (conv.messages?.data || [])[0]; if (!lastMsg) continue;
      convs.push({ id: conv.id, network: "instagram", from: lastMsg.from?.username || lastMsg.from?.name || "Contact", kind: "dm", text: lastMsg.message || "", hoursAgo: hoursSince(lastMsg.created_time), unread: false, replies: [] });
    }
  };
  await Promise.all([fbBlock(), igCommentsBlock(), igDmBlock()]);
  convs.sort((a, b) => a.hoursAgo - b.hoursAgo);
  return { demo: false, conversations: convs };
}
function argosDemoCompetitors(brand) {
  const rng = argosRng(brand.id + ":comp");
  const mine = argosDemoOverview(brand, 30);
  const rows = (brand.competitors || []).map((c) => ({ name: c.name, handle: c.handle, followers: Math.round((5000 + rng() * 220000) / 500) * 500, growth: +(rng() * 7 - 0.5).toFixed(1), engagement: +(0.8 + rng() * 5).toFixed(1), posts30: 6 + Math.round(rng() * 22), mine: false }));
  rows.push({ name: brand.name, handle: Object.values(brand.networks || {})[0] || "", followers: mine.followers, growth: +(1 + rng() * 4).toFixed(1), engagement: mine.engagement, posts30: mine.published, mine: true });
  return { demo: true, rows: rows.sort((a, b) => b.followers - a.followers) };
}
// Meilleurs créneaux (démo) : matrice jour × heure stable par marque
function argosDemoBestTimes(brand) {
  const rng = argosRng(brand.id + ":times");
  const out = [];
  for (let wd = 0; wd < 7; wd++) for (let hr = 7; hr < 23; hr++) {
    const lunch = (hr >= 12 && hr <= 13) ? 1.4 : 1, evening = (hr >= 18 && hr <= 21) ? 1.6 : 1, wknd = (wd >= 5) ? 0.85 : 1;
    out.push({ wd, hr, score: +(rng() * lunch * evening * wknd).toFixed(3) });
  }
  return out.sort((a, b) => b.score - a.score);
}
// ── IPC ──
ipcMain.handle("argos:state", () => {
  const st = argosState();
  const connections = {};
  for (const p of ARGOS_PLATFORMS) {
    const c = st.connections[p.id] || {};
    const prov = argosProviderOf(p.id);
    const pk = st.providers[prov] || {};
    // Ne renvoie JAMAIS de secret ni de jeton au renderer — uniquement des métadonnées.
    connections[p.id] = { id: p.id, label: p.label, icon: p.icon, api: p.api, provider: prov, status: c.status || "disconnected", account: c.account || null, hasKeys: !!(pk.app_id || pk.client_id), hasInstagramConfig: !!pk.config_id_instagram, igScoped: c.scoped === "instagram", expires_at: c.expires_at || pk.expires_at || null, docs: !!(argosApis().apis || []).find((a) => a.platform === p.id || (a.covers || []).includes(p.id)) };
  }
  return { ok: true, brands: st.brands, connections };
});
ipcMain.handle("argos:brandSave", (_e, brand) => {
  const st = argosState();
  if (brand.id) { const i = st.brands.findIndex((b) => b.id === brand.id); if (i >= 0) st.brands[i] = { ...st.brands[i], ...brand }; }
  // Un cluster créé via le glisser-déposer de Titan est un choix délibéré du gérant — il
  // s'affiche automatiquement dans Argos (visible par défaut), décochable ensuite depuis Titan.
  else { brand.id = "b" + randomUUID().replace(/-/g, "").slice(0, 12); if (brand.hidden === undefined) brand.hidden = false; st.brands.push(brand); }
  // Le mapping réseaux a peut-être changé — le cache précédent pourrait correspondre au
  // MAUVAIS compte, on le vide pour cette marque.
  if (brand.assets) Object.keys(st.cache).forEach((k) => k.startsWith(brand.id + ":") && delete st.cache[k]);
  return { ok: argosSave(st), brand };
});
ipcMain.handle("argos:brandDelete", (_e, id) => {
  const st = argosState();
  st.brands = st.brands.filter((b) => b.id !== id);
  st.posts = st.posts.filter((p) => p.brandId !== id);
  st.inboxReplies = st.inboxReplies.filter((r) => r.brandId !== id); // pas de fuite de données client
  return { ok: argosSave(st) };
});
ipcMain.handle("argos:overview", (_e, brandId, days, forceRefresh, peek) => {
  const d = Math.max(7, Math.min(90, days || 30));
  return argosCached(brandId, "ov", d, forceRefresh, (b) => !!(argosBrandAsset(b, "facebook") || argosBrandAsset(b, "instagram")),
    async (b) => { const real = await argosRealOverview(b, d); return real ? { data: real } : null; },
    (b) => ({ data: argosDemoOverview(b, d) }), peek);
});
ipcMain.handle("argos:inbox", async (_e, brandId, forceRefresh, peek) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  const mergeReplies = (convs) => (convs || []).map((c) => ({ ...c, replies: st.inboxReplies.filter((r) => r.convId === c.id) }));
  const r = await argosCached(brandId, "inbox", null, forceRefresh, (bb) => !!(argosBrandAsset(bb, "facebook") || argosBrandAsset(bb, "instagram")),
    async (bb) => { const real = await argosRealInbox(bb); return real ? { demo: false, conversations: real.conversations } : null; },
    (bb) => ({ demo: true, conversations: argosDemoInbox(bb) }), peek);
  return { ...r, conversations: mergeReplies(r.conversations) };
});
ipcMain.handle("argos:inboxReply", (_e, brandId, convId, text) => {
  const st = argosState();
  st.inboxReplies.push({ id: "r" + randomUUID().replace(/-/g, "").slice(0, 12), brandId, convId, text: String(text || "").slice(0, 2000), at: new Date().toISOString(), pending: true });
  return { ok: argosSave(st), pending: true };
});
ipcMain.handle("argos:listening", (_e, brandId) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  return { ok: true, data: argosDemoListening(b), keywords: b.keywords || [] };
});
ipcMain.handle("argos:keywords", (_e, brandId, keywords) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  b.keywords = (keywords || []).map((k) => String(k).trim()).filter(Boolean).slice(0, 20);
  return { ok: argosSave(st), keywords: b.keywords };
});
ipcMain.handle("argos:ads", (_e, brandId, forceRefresh, peek) => {
  return argosCached(brandId, "ads", null, forceRefresh, (b) => !!(argosBrandAsset(b, "meta_ads") || argosBrandAsset(b, "google_ads")),
    async (b) => { const real = await argosRealAdsAll(b); return real ? { data: real } : null; },
    (b) => ({ data: argosDemoAds(b) }), peek);
});
ipcMain.handle("argos:audience", (_e, brandId, forceRefresh, peek) => {
  return argosCached(brandId, "aud", null, forceRefresh, (b) => !!argosBrandAsset(b, "instagram"),
    async (b) => { const real = await argosRealAudience(b); return real ? { data: real } : null; },
    (b) => ({ data: argosDemoAudience(b) }), peek);
});
// Campagnes Google Ads du client (type, budget, statut) — réel dès que le compte Ads est mappé.
ipcMain.handle("argos:adsCampaigns", (_e, brandId, period, forceRefresh, peek) => {
  return argosCached(brandId, "adscamp", adsPeriodKey(period), forceRefresh, (b) => !!argosBrandAsset(b, "google_ads"),
    async (b) => { const real = await argosAdsCampaigns(b, period); return real ? { data: real } : null; },
    () => ({ data: { demo: true, campaigns: [] } }), peek);
});
// Mots-clés Google Ads du client (campagnes Search) — CPC, coût, clics réels.
ipcMain.handle("argos:adsKeywords", (_e, brandId, period, forceRefresh, peek) => {
  return argosCached(brandId, "adskw", adsPeriodKey(period), forceRefresh, (b) => !!argosBrandAsset(b, "google_ads"),
    async (b) => { const real = await argosAdsKeywords(b, period); return real ? { data: real } : null; },
    () => ({ data: { demo: true, keywords: [] } }), peek);
});
// Segments d'audience ciblés par les campagnes du client (Display / notoriété surtout).
ipcMain.handle("argos:adsAudiences", (_e, brandId, period, forceRefresh, peek) => {
  return argosCached(brandId, "adsaud", adsPeriodKey(period), forceRefresh, (b) => !!argosBrandAsset(b, "google_ads"),
    async (b) => { const real = await argosAdsAudiences(b, period); return real ? { data: real } : null; },
    () => ({ data: { demo: true, audiences: [] } }), peek);
});
// Ciblage géographique des campagnes du client (zones incluses/exclues + proximité).
ipcMain.handle("argos:adsGeo", (_e, brandId, forceRefresh, peek) => {
  return argosCached(brandId, "adsgeo", null, forceRefresh, (b) => !!argosBrandAsset(b, "google_ads"),
    async (b) => { const real = await argosAdsGeo(b); return real ? { data: real } : null; },
    () => ({ data: { demo: true, campaigns: [] } }), peek);
});
// Emplacements réels (sites, apps, YouTube) où le budget a été dépensé — « où est parti l'argent ».
ipcMain.handle("argos:adsPlacements", (_e, brandId, period, forceRefresh, peek) => {
  return argosCached(brandId, "adsplc2", adsPeriodKey(period), forceRefresh, (b) => !!argosBrandAsset(b, "google_ads"),
    async (b) => { const real = await argosAdsPlacements(b, period); return real ? { data: real } : null; },
    () => ({ data: { demo: true, placements: [] } }), peek);
});
// Emplacements déjà exclus (critères négatifs) — pour refléter l'état des boutons dans la modale.
ipcMain.handle("argos:adsExclusions", async (_e, brandId) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  try { const map = await argosAdsExclusions(b); return { ok: true, exclusions: map || {} }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Emplacements déjà ciblés explicitement (gérés) — reflète l'état du bouton « Relancer ».
ipcMain.handle("argos:adsManaged", async (_e, brandId) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  try { const map = await argosAdsManaged(b); return { ok: true, managed: map || {} }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// ÉCRITURE réelle : exclure / réactiver un emplacement. Toujours déclenché par une action confirmée
// côté renderer. Renvoie {ok, error?} — l'UI gère l'attente d'accès Basic (message dédié).
ipcMain.handle("argos:adsPlacementAction", async (_e, brandId, action, spec) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  if (!["exclude", "reactivate", "target", "untarget"].includes(action)) return { ok: false, error: "Action invalide." };
  try { const r = await argosAdsMutatePlacement(b, action, spec || {}); return { ok: true, ...r }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Site web (GA4) et SEO (Search Console) — réel dès qu'une propriété/un site est mappé à la marque.
ipcMain.handle("argos:web", (_e, brandId, days, forceRefresh, peek) => {
  const d = Math.max(7, Math.min(+days || 30, 90));
  return argosCached(brandId, "web", d, forceRefresh, (b) => !!argosBrandAsset(b, "google_analytics"),
    async (b) => { const real = await argosRealWebAnalytics(b, d); return real ? { data: real } : null; },
    (b) => ({ data: argosDemoWeb(b, d) }), peek);
});
// Audit technique : crawl déclenché à la demande (coûteux), résultat mis en cache 7 j dans argos.json.
ipcMain.handle("argos:crawl", async (_e, brandId, forceRefresh, peek) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  const key = brandId + ":crawl";
  const cached = st.cache[key];
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < 7 * 86400000) return { ok: true, data: cached.data, cached: true, at: cached.fetchedAt };
  if (peek) return { ok: true, data: null }; // ouverture de vue : ne pas lancer le crawl automatiquement
  try {
    const data = await argosCrawl(b);
    const st2 = argosState(); st2.cache[key] = { data, fetchedAt: Date.now() }; argosSave(st2);
    return { ok: true, data };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("argos:vitals", (_e, brandId, forceRefresh, peek) => {
  return argosCached(brandId, "vitals", null, forceRefresh, (b) => !!argosBrandAsset(b, "search_console"),
    async (b) => { const real = await argosRealVitals(b); return real ? { data: real } : null; },
    (b) => ({ data: argosDemoVitals(b) }), peek);
});
ipcMain.handle("argos:seoIntel", (_e, brandId, days, forceRefresh, peek) => {
  const d = Math.max(7, Math.min(+days || 30, 90));
  return argosCached(brandId, "seoIntel", d, forceRefresh, (b) => !!argosBrandAsset(b, "search_console"),
    async (b) => { const real = await argosRealSeoIntel(b, d); return real ? { data: real } : null; },
    (b) => ({ data: argosDemoSeoIntel(b) }), peek);
});
ipcMain.handle("argos:seo", (_e, brandId, days, forceRefresh, peek) => {
  const d = Math.max(7, Math.min(+days || 30, 90));
  return argosCached(brandId, "seo", d, forceRefresh, (b) => !!argosBrandAsset(b, "search_console"),
    async (b) => { const real = await argosRealSeo(b, d); return real ? { data: real } : null; },
    (b) => ({ data: argosDemoSeo(b, d) }), peek);
});
// ── LECTEUR UNIFIÉ « snapshot » (Obj 2) ──────────────────────────────────────
// Rassemble EN CACHE SEUL (aucun appel API) toutes les données déjà récupérées pour un client
// et une période, bien classées par source. `missing` liste les types absents du cache → le
// générateur de rapport sait quoi (re)générer (uniquement sur force / période neuve).
// Table déclarative : [section, nom, store('argos'|'si'|'siPrefix'), builder(clé/préfixe depuis {days,pk,domain})]
const ARGOS_SNAP_TYPES = [
  ["google", "web", "argos", (c) => "web:" + c.days],
  ["google", "seo", "argos", (c) => "seo:" + c.days],
  ["google", "seoIntel", "argos", (c) => "seoIntel:" + c.days],
  ["google", "vitals", "argos", () => "vitals"],
  ["google", "adsCampaigns", "argos", (c) => "adscamp:" + c.pk],
  ["google", "adsKeywords", "argos", (c) => "adskw:" + c.pk],
  ["google", "adsAudiences", "argos", (c) => "adsaud:" + c.pk],
  ["google", "adsGeo", "argos", () => "adsgeo"],
  ["google", "adsPlacements", "argos", (c) => "adsplc2:" + c.pk],
  ["google", "crawl", "argos", () => "crawl"],
  ["meta", "overview", "argos", (c) => "ov:" + c.days],
  ["meta", "inbox", "argos", () => "inbox"],
  ["meta", "audience", "argos", () => "aud"],
  ["ads", "totals", "argos", () => "ads"],
  ["si", "domainOverview", "si", (c) => "domov:" + c.domain],
  ["si", "rankedKw", "si", (c) => "rankkw:" + c.domain],
  ["si", "seoCompetitors", "si", (c) => "seocomp:" + c.domain],
  ["si", "backlinks", "si", (c) => "bl:" + c.domain],
  ["si", "sea", "si", (c) => "sea:" + c.domain],
  ["si", "localCompetitors", "siPrefix", (c) => "localcomp:v4:" + c.domain + ":"],
];
function argosSnapshot(brandId, period) {
  const ast = argosState(); const b = ast.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  const per = period || { days: 30 };
  const ctx = {
    days: Math.max(7, Math.min((per.days) || 30, 90)),
    pk: adsPeriodKey(per),
    domain: (siBrandDomain(b) || "").replace(/^www\./, "").toLowerCase(),
  };
  const ac = ast.cache || {};
  const sc = (() => { try { return siLoad().cache || {}; } catch { return {}; } })();
  const sections = { google: {}, meta: {}, ads: {}, si: {} };
  const fetchedAt = {}; const missing = [];
  for (const [section, name, store, build] of ARGOS_SNAP_TYPES) {
    let payload = null, ts = null;
    if (store === "argos") {
      const e = ac[brandId + ":" + build(ctx)];
      if (e) { payload = (e.data !== undefined ? e.data : (({ fetchedAt, cached, stale, ...rest }) => rest)(e)); ts = e.fetchedAt || null; }
    } else if (store === "si") {
      const e = ctx.domain ? sc[build(ctx)] : null;
      if (e) { payload = e.data; ts = e.at || null; }
    } else if (store === "siPrefix") {
      const prefix = ctx.domain ? build(ctx) : null;
      const k = prefix ? Object.keys(sc).find((x) => x.startsWith(prefix)) : null;
      if (k) { payload = sc[k].data; ts = sc[k].at || null; }
    }
    if (payload != null) { sections[section][name] = payload; fetchedAt[section + "." + name] = ts; }
    else missing.push(section + "." + name);
  }
  return { ok: true, brand: { id: b.id, name: b.name, secteur: b.secteur || null, zone: b.zone || null }, period: per, generatedAt: Date.now(), ...sections, fetchedAt, missing };
}
// Snapshot cache-only (jamais d'appel API) — le générateur de rapport consomme ça.
ipcMain.handle("argos:snapshot", (_e, brandId, period) => argosSnapshot(brandId, period));
// Persistance des rapports générés : revoir un rapport = lecture disque, zéro appel.
ipcMain.handle("argos:reportSave", (_e, brandId, period, snapshot) => {
  const st = argosState(); if (!st.brands.find((x) => x.id === brandId)) return { ok: false, error: "Marque inconnue." };
  const pk = adsPeriodKey(period || { days: 30 });
  st.reports[brandId] = st.reports[brandId] || {};
  st.reports[brandId][pk] = { generatedAt: Date.now(), period: period || { days: 30 }, snapshot };
  return { ok: argosSave(st), periodKey: pk };
});
ipcMain.handle("argos:reportGet", (_e, brandId, period) => {
  const st = argosState(); const pk = adsPeriodKey(period || { days: 30 });
  const r = (st.reports[brandId] || {})[pk] || null;
  return { ok: true, report: r, periodKey: pk, all: Object.keys(st.reports[brandId] || {}) };
});
// Buckets d'actifs disponibles PAR RÉSEAU, pour le glisser-déposer dans Titan — structure
// générique prête à recevoir Google/TikTok/LinkedIn/X dès qu'ils seront connectés (buckets
// vides en attendant, mais déjà là pour ne pas avoir à retoucher l'UI plus tard).
ipcMain.handle("argos:networkBuckets", () => {
  const st = argosState();
  const assets = (st.providers.meta && st.providers.meta.assets) || { pages: [], adAccounts: [] };
  const g = (st.providers.google && st.providers.google.assets) || {};
  const buckets = [
    { network: "facebook", label: "Facebook", icon: "👥", connected: !!st.connections.facebook, items: (assets.pages || []).map((p) => ({ id: p.id, label: p.name })) },
    { network: "instagram", label: "Instagram", icon: "📷", connected: !!st.connections.instagram, items: (assets.pages || []).filter((p) => p.ig_user_id).map((p) => ({ id: p.id, label: "@" + p.ig_username })) },
    { network: "meta_ads", label: "Meta Ads", icon: "📣", connected: !!st.connections.meta_ads, items: (assets.adAccounts || []).map((a) => ({ id: a.id, label: a.name })) },
    { network: "google_analytics", label: "Google Analytics", icon: "📈", connected: !!st.connections.google_analytics, items: (g.analytics || []).map((x) => ({ id: x.id, label: x.label })) },
    { network: "search_console", label: "Search Console", icon: "🔍", connected: !!st.connections.search_console, items: (g.searchConsole || []).map((x) => ({ id: x.id, label: x.label })) },
    { network: "google_ads", label: "Google Ads", icon: "🔎", connected: !!st.connections.google_ads, items: (g.googleAds || []).map((x) => ({ id: x.id, label: x.label, sub: x.name ? x.id : null })) },
    { network: "google_business", label: "Google Business", icon: "📍", connected: !!st.connections.google_business, items: (g.business || []).map((x) => ({ id: x.id, label: x.label })) },
    { network: "tiktok", label: "TikTok", icon: "🎵", connected: false, items: [] },
    { network: "linkedin", label: "LinkedIn", icon: "💼", connected: false, items: [] },
    { network: "x", label: "X", icon: "𝕏", connected: false, items: [] },
  ];
  return { ok: true, buckets };
});
ipcMain.handle("argos:competitors", (_e, brandId) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  return { ok: true, data: argosDemoCompetitors(b) };
});
ipcMain.handle("argos:competitorSave", (_e, brandId, competitors) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  b.competitors = (competitors || []).slice(0, 12);
  return { ok: argosSave(st) };
});
ipcMain.handle("argos:bestTimes", (_e, brandId) => {
  const st = argosState(); const b = st.brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  return { ok: true, demo: true, slots: argosDemoBestTimes(b) };
});
ipcMain.handle("argos:posts", (_e, brandId) => {
  const st = argosState();
  return { ok: true, posts: st.posts.filter((p) => p.brandId === brandId).sort((a, b2) => (a.date + (a.time || "")).localeCompare(b2.date + (b2.time || ""))) };
});
// Publie réellement sur Facebook si la marque a une Page mappée et que "facebook" est coché.
// scheduled_publish_time permet une PROGRAMMATION NATIVE côté Facebook (10 min à 30 jours) —
// Instagram ne le permet pas côté API, cette fonction ne concerne donc que Facebook pour l'instant.
ipcMain.handle("argos:postSave", async (_e, post) => {
  const st = argosState();
  const existing = post.id ? st.posts.find((p) => p.id === post.id) : null;
  const alreadyPublished = existing && existing.fbPublish && existing.fbPublish.ok;
  let publishResult = existing ? existing.fbPublish || null : null;
  const b = st.brands.find((x) => x.id === post.brandId);
  const shouldTryPublish = !alreadyPublished && post.status !== "draft" && b && argosBrandAsset(b, "facebook") && (post.networks || []).includes("facebook");
  if (shouldTryPublish) {
    const fbCtx = argosBrandFbPage(b);
    if (fbCtx) {
      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const scheduleSec = post.date ? Math.floor(new Date(`${post.date}T${post.time || "12:00"}:00`).getTime() / 1000) : null;
        const willSchedule = !!(scheduleSec && scheduleSec > nowSec + 600 && scheduleSec < nowSec + 30 * 86400);
        const params = { message: post.text };
        if (willSchedule) { params.published = "false"; params.scheduled_publish_time = scheduleSec; }
        const r = await argosApiCall("facebook", "fb_publish_post", params, fbCtx);
        publishResult = { ok: true, page_post_id: r.id, scheduled: willSchedule, at: new Date().toISOString() };
      } catch (e) { publishResult = { ok: false, error: e.message, at: new Date().toISOString() }; }
    }
  }
  // L'appel Meta ci-dessus peut durer plusieurs secondes : on RECHARGE l'état juste avant
  // d'écrire et on n'applique que le delta (le post) — sinon toute écriture concurrente
  // survenue pendant l'attente (autre post, réglage Titan…) était silencieusement écrasée.
  const st2 = argosState();
  if (post.id) { const i = st2.posts.findIndex((p) => p.id === post.id); if (i >= 0) st2.posts[i] = { ...st2.posts[i], ...post, fbPublish: publishResult }; else { post.fbPublish = publishResult; st2.posts.push(post); } }
  else { post.id = "p" + randomUUID().replace(/-/g, "").slice(0, 12); post.createdAt = new Date().toISOString(); post.fbPublish = publishResult; st2.posts.push(post); }
  return { ok: argosSave(st2), post, publishResult };
});
ipcMain.handle("argos:postDelete", (_e, id) => {
  const st = argosState(); st.posts = st.posts.filter((p) => p.id !== id); return { ok: argosSave(st) };
});
// Seuls ces champs sont acceptés du renderer — jamais status/access_token (sinon on pourrait
// forcer le chemin API réel sans OAuth). Les secrets sont chiffrés avant stockage.
const ARGOS_KEY_FIELDS = { app_id: false, client_id: false, developer_token: true, app_secret: true, client_secret: true, login_customer_id: false, config_id: false, config_id_instagram: false };
ipcMain.handle("argos:connSaveKeys", (_e, platform, keys) => {
  if (!ARGOS_PLATFORMS.some((p) => p.id === platform)) return { ok: false, error: "Plateforme inconnue." };
  const st = argosState();
  const provider = argosProviderOf(platform); // clés partagées entre surfaces d'un même fournisseur
  const cur = st.providers[provider] || {};
  const clean = {};
  for (const [k, isSecret] of Object.entries(ARGOS_KEY_FIELDS)) {
    if (keys && typeof keys[k] === "string" && keys[k].trim()) clean[k] = isSecret ? argosEncSecret(keys[k].trim()) : keys[k].trim();
  }
  st.providers[provider] = { ...cur, ...clean };
  return { ok: argosSave(st) };
});
// Lance le flux OAuth d'un fournisseur et connecte ses surfaces.
// mode "instagram" : connexion DÉDIÉE via la configuration "Instagram Graph API" — les Pages
// autorisées ici portent des jetons avec les scopes instagram_business_* (stockés à part dans
// providers.meta.igAssets), distincts des jetons Pages/Ads de la connexion générale.
ipcMain.handle("argos:connect", async (_e, platform, mode) => {
  const provider = argosProviderOf(platform);
  const st = argosState();
  const pk = st.providers[provider] || {};
  try {
    if (provider === "google") {
      const clientId = pk.client_id, clientSecret = argosDecSecret(pk.client_secret);
      if (!clientId || !clientSecret) return { ok: false, error: "Renseigne d'abord le Client ID et le Client secret Google." };
      const r = await argosGoogleConnect(clientId, clientSecret);
      // Refresh token stocké AVANT la découverte (qui l'utilise pour rafraîchir l'access token).
      const stG = argosState();
      stG.providers.google = { ...(stG.providers.google || {}), refresh_token: argosEncSecret(r.refresh_token), access_token: argosEncSecret(r.access_token), token_expiry: Date.now() + r.expires_in * 1000, account_email: r.email || null, connected_at: new Date().toISOString() };
      argosSave(stG);
      const assets = await argosGoogleDiscover();
      const stG2 = argosState();
      stG2.providers.google = { ...(stG2.providers.google || {}), assets, ...(assets.loginCustomerId ? { login_customer_id: assets.loginCustomerId } : {}) };
      const mark = (surface, items, account) => { if (items.length) stG2.connections[surface] = { provider: "google", status: "connected", account: account + (items.length > 1 ? ` (+${items.length - 1})` : "") }; };
      mark("google_analytics", assets.analytics, assets.analytics[0]?.label || "");
      mark("search_console", assets.searchConsole, assets.searchConsole[0]?.label || "");
      mark("google_ads", assets.googleAds, assets.googleAds[0]?.label || "");
      mark("google_business", assets.business, assets.business[0]?.label || "");
      argosSave(stG2);
      return { ok: true, summary: { ga: assets.analytics.length, sc: assets.searchConsole.length, ads: assets.googleAds.length, biz: assets.business.length, email: r.email, notes: [assets.googleAdsError && "Ads : " + assets.googleAdsError, assets.businessError && "Business : " + assets.businessError].filter(Boolean) } };
    }
    if (provider === "meta" && mode === "instagram") {
      const appId = pk.app_id, appSecret = argosDecSecret(pk.app_secret), configId = pk.config_id_instagram;
      if (!appId || !appSecret) return { ok: false, error: "Renseigne d'abord l'App ID et le secret Meta." };
      if (!configId) return { ok: false, error: "Il manque le Configuration ID Instagram — crée-le dans Facebook Login for Business → Configurations (variante Instagram Graph API)." };
      const r = await argosMetaConnect(appId, appSecret, configId);
      const igPages = r.pages.filter((p) => p.ig_user_id).map((p) => ({ id: p.id, name: p.name, token: argosEncSecret(p.access_token), ig_user_id: p.ig_user_id, ig_username: p.ig_username }));
      if (!igPages.length) return { ok: false, error: "Aucun compte Instagram professionnel trouvé (vérifie qu'il est relié à une Page)." };
      // Le flux OAuth peut durer plusieurs minutes : on recharge l'état AVANT d'écrire (le
      // snapshot d'entrée est périmé, l'écrire tel quel effacerait les écritures intermédiaires).
      const stI = argosState();
      stI.providers.meta = { ...(stI.providers.meta || {}), igAssets: { pages: igPages } };
      const i0 = igPages[0];
      stI.connections.instagram = { provider: "meta", status: "connected", account: "@" + i0.ig_username + (igPages.length > 1 ? ` (+${igPages.length - 1})` : ""), access_token: i0.token, ig_user_id: i0.ig_user_id, scoped: "instagram" };
      argosSave(stI);
      return { ok: true, summary: { pages: 0, ig: igPages.length, ads: 0 } };
    }
    if (provider === "meta") {
      const appId = pk.app_id, appSecret = argosDecSecret(pk.app_secret), configId = pk.config_id;
      if (!appId || !appSecret) return { ok: false, error: "Renseigne d'abord l'App ID et le secret Meta." };
      if (!configId) return { ok: false, error: "Il manque le Configuration ID — crée-le dans Facebook Login for Business → Configurations, puis colle-le dans les clés Meta." };
      const r = await argosMetaConnect(appId, appSecret, configId);
      if (!r.pages.length) return { ok: false, error: "Aucune Page Facebook accessible avec ce compte. Vérifie que tu es admin d'au moins une Page (et lie ton compte Instagram pro à cette Page)." };
      const pages = r.pages.map((p) => ({ id: p.id, name: p.name, token: argosEncSecret(p.access_token), ig_user_id: p.ig_user_id, ig_username: p.ig_username }));
      const igPages = pages.filter((p) => p.ig_user_id);
      const expires_at = r.expiresIn ? new Date(Date.now() + r.expiresIn * 1000).toISOString() : null;
      // Rechargement post-OAuth : le flux a pu durer plusieurs minutes, le snapshot d'entrée
      // est périmé — on écrit le delta sur l'état FRAIS (sinon lost update sur argos.json).
      const stG = argosState();
      stG.providers.meta = { ...(stG.providers.meta || {}), user_token: argosEncSecret(r.userToken), expires_at, connected_at: new Date().toISOString(), assets: { pages, adAccounts: r.adAccounts } };
      // Surface Facebook : compte primaire = 1re Page (les autres restent dispo pour le mapping par marque)
      const p0 = pages[0];
      stG.connections.facebook = { provider: "meta", status: "connected", account: p0.name + (pages.length > 1 ? ` (+${pages.length - 1})` : ""), access_token: p0.token, page_id: p0.id };
      // Surface Instagram : 1re Page reliée à un compte IG pro (jeton "général" — sans les scopes
      // instagram_business_*, insuffisant pour les vrais appels IG tant que le mode "instagram" n'a pas tourné).
      if (igPages.length) { const i0 = igPages[0]; stG.connections.instagram = { provider: "meta", status: "connected", account: "@" + i0.ig_username + (igPages.length > 1 ? ` (+${igPages.length - 1})` : ""), access_token: i0.token, ig_user_id: i0.ig_user_id }; }
      // Surface Meta Ads : 1er compte publicitaire (utilise le jeton utilisateur)
      if (r.adAccounts.length) { const a0 = r.adAccounts[0]; stG.connections.meta_ads = { provider: "meta", status: "connected", account: a0.name + (r.adAccounts.length > 1 ? ` (+${r.adAccounts.length - 1})` : ""), access_token: argosEncSecret(r.userToken), ad_account_id: a0.id }; }
      argosSave(stG);
      return { ok: true, summary: { pages: pages.length, ig: igPages.length, ads: r.adAccounts.length } };
    }
    return { ok: false, error: "La connexion " + provider + " arrive bientôt — pour l'instant, Meta est disponible." };
  } catch (e) {
    try { writeFileSync(join(app.getPath("userData"), "connect-debug.log"), new Date().toISOString() + " [" + provider + "] " + (e && e.stack ? e.stack : (e.message || String(e))) + "\n", { flag: "a" }); } catch {}
    return { ok: false, error: e.message || String(e) };
  }
});
// Re-synchronise les actifs Google sans repasser par le navigateur : réutilise le refresh_token
// déjà stocké pour relancer la découverte (utile après avoir activé une API côté Google Cloud).
ipcMain.handle("argos:googleResync", async () => {
  try {
    const g = argosState().providers.google;
    if (!g || !g.refresh_token) return { ok: false, error: "Google n'est pas connecté — clique d'abord « Connecter un compte »." };
    const assets = await argosGoogleDiscover();
    const st = argosState();
    st.providers.google = { ...(st.providers.google || {}), assets, ...(assets.loginCustomerId ? { login_customer_id: assets.loginCustomerId } : {}) };
    const mark = (surface, items, account) => { if (items.length) st.connections[surface] = { provider: "google", status: "connected", account: account + (items.length > 1 ? ` (+${items.length - 1})` : "") }; };
    mark("google_analytics", assets.analytics, assets.analytics[0]?.label || "");
    mark("search_console", assets.searchConsole, assets.searchConsole[0]?.label || "");
    mark("google_ads", assets.googleAds, assets.googleAds[0]?.label || "");
    mark("google_business", assets.business, assets.business[0]?.label || "");
    argosSave(st);
    return { ok: true, summary: { ga: assets.analytics.length, sc: assets.searchConsole.length, ads: assets.googleAds.length, biz: assets.business.length, notes: [assets.analyticsError && "GA4 : " + assets.analyticsError, assets.googleAdsError && "Ads : " + assets.googleAdsError, assets.businessError && "Business : " + assets.businessError].filter(Boolean) } };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
});
ipcMain.handle("argos:connDisconnect", (_e, platform) => {
  const st = argosState(); delete st.connections[platform]; return { ok: argosSave(st) };
});
ipcMain.handle("argos:apiDocs", (_e, platform) => {
  const spec = (argosApis().apis || []).find((a) => a.platform === platform || (a.covers || []).includes(platform));
  return { ok: true, spec: spec || null };
});

// ══════════════════ SEARCH INTELLIGENCE — fondation ══════════════════
// Fournisseurs de données SEO payants derrière une ABSTRACTION : un adaptateur par fournisseur
// (DataForSEO en premier), renvoyant des DTO standardisés. Changer de fournisseur = changer
// l'adaptateur, zéro impact sur le domaine. Toute donnée suivra la cascade : cache Olympus →
// calcul local → Google gratuit → fournisseur payant (dernier recours, budgété et mis en cache).
function siPath() { return join(app.getPath("userData"), "search-intel.json"); }
function siDefault() { return { provider: "dataforseo", creds: {}, sandbox: false, budget: { soft: 20, hard: 50, spent: 0, currency: "EUR", history: [] }, cache: {}, seaKw: {} }; }
function siLoad() {
  const p = siPath();
  if (!existsSync(p)) return siDefault();
  try { return { ...siDefault(), ...JSON.parse(readFileSync(p, "utf8")) }; }
  catch { try { renameSync(p, p + ".corrupt-" + Date.now()); } catch {} return siDefault(); }
}
function siSave(st) { return writeJsonAtomic(siPath(), st); }
// Taux de conversion USD→EUR pour l'AFFICHAGE des estimations (DataForSEO facture en USD).
const SI_USD_EUR = 0.92;
// Registre fournisseurs + tarifs unitaires (USD/appel) — le PricingService estime AVANT tout appel.
const SI_PROVIDERS = {
  dataforseo: {
    label: "DataForSEO", base: "https://api.dataforseo.com",
    pricing: {
      serp:           { unit: 0.002,  label: "Résultats Google d'un mot-clé (SERP)" },
      keyword_volume: { unit: 0.0001, label: "Volume de recherche (par mot-clé)" },
      keyword_ideas:  { unit: 0.01,   label: "Idées de mots-clés (par graine)" },
      backlinks:      { unit: 0.02,   label: "Backlinks (par domaine)" },
      competitors:    { unit: 0.02,   label: "Concurrents organiques (par domaine)" },
      seo_competitors:{ unit: 0.02,   label: "Concurrents SEO (par domaine)" },
      content_gap:    { unit: 0.02,   label: "Content gap (par concurrent)" },
      domain_overview:{ unit: 0.02,   label: "Vue d'ensemble domaine" },
      ranked_kw:      { unit: 0.02,   label: "Mots-clés positionnés (par domaine)" },
      backlinks_sum:  { unit: 0.02,   label: "Résumé backlinks (par domaine)" },
      sea_overview:   { unit: 0.02,   label: "Vue SEA (par domaine)" },
      whois:          { unit: 0.13,   label: "Âge de domaine whois (lot de 8)" },
      reviews:        { unit: 0.02,   label: "Avis Google d'un établissement (priorité haute)" },
    },
  },
};
function siProviderCfg() { return SI_PROVIDERS[siLoad().provider] || SI_PROVIDERS.dataforseo; }
// URL de base — bascule sur le Sandbox DataForSEO (données factices, gratuit, sans vérif de compte)
// quand le mode sandbox est actif, pour tester la plomberie sans dépenser ni bloquer sur la vérif.
function siBase() { const st = siLoad(); const b = siProviderCfg().base; return st.sandbox ? b.replace("://api.", "://sandbox.") : b; }
// Estimation de coût (EUR) pour un endpoint × un volume — aucun appel payant sans passer par là.
function siEstimate(endpoint, count = 1) {
  const p = siProviderCfg().pricing[endpoint];
  if (!p) return null;
  const usd = p.unit * count;
  return { endpoint, count, usd: +usd.toFixed(4), eur: +(usd * SI_USD_EUR).toFixed(4), label: p.label };
}
// Auth DataForSEO = Basic (login:password). Secret chiffré au repos, jamais renvoyé au renderer.
function siAuthHeader() {
  const st = siLoad();
  const login = st.creds.login, password = argosDecSecret(st.creds.password);
  if (!login || !password) { const e = new Error("Fournisseur non connecté."); e.notConnected = true; throw e; }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}
async function siDfsCall(path, body, timeoutMs = 30000) {
  const r = await timedFetch(siBase() + path, { method: body ? "POST" : "GET", headers: { Authorization: siAuthHeader(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, timeoutMs);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`DataForSEO ${r.status} : ${(j.status_message || r.statusText || "").slice(0, 140)}`);
  if (j.status_code && j.status_code !== 20000) throw new Error(`DataForSEO ${j.status_code} : ${j.status_message}`);
  return j;
}
// Test de connexion : endpoint GRATUIT renvoyant le solde du compte (prouve l'auth + budget dispo).
async function siProviderTest() {
  const j = await siDfsCall("/v3/appendix/user_data", null);
  const d = j.tasks?.[0]?.result?.[0] || {};
  return { ok: true, balance: d.money?.balance ?? null, currency: d.money?.currency || "USD", login: siLoad().creds.login };
}
// Budget : soft = avertissement, hard = blocage. siBudgetCheck avant, siCharge après chaque appel réel.
function siBudgetState() {
  const b = siLoad().budget;
  return { soft: b.soft, hard: b.hard, spent: +(b.spent || 0).toFixed(2), currency: b.currency || "EUR", remaining: +((b.hard || 0) - (b.spent || 0)).toFixed(2), history: (b.history || []).slice(-50) };
}
function siBudgetCheck(eur) { const b = siLoad().budget; return (b.spent || 0) + eur <= b.hard; }
function siCharge(endpoint, eur, meta = {}) {
  const st = siLoad();
  st.budget.spent = +((st.budget.spent || 0) + eur).toFixed(4);
  st.budget.history = st.budget.history || [];
  st.budget.history.push({ at: new Date().toISOString(), endpoint, eur: +(+eur).toFixed(4), ...meta });
  if (st.budget.history.length > 500) st.budget.history = st.budget.history.slice(-500);
  return siSave(st);
}
ipcMain.handle("si:status", () => {
  const st = siLoad();
  return { ok: true, provider: st.provider, providerLabel: siProviderCfg().label, connected: !!(st.creds.login && st.creds.password), login: st.creds.login || null, sandbox: !!st.sandbox,
    budget: siBudgetState(),
    pricing: Object.entries(siProviderCfg().pricing).map(([id, v]) => ({ id, label: v.label, eur: +(v.unit * SI_USD_EUR).toFixed(4) })) };
});
ipcMain.handle("si:saveKeys", (_e, login, password) => {
  const st = siLoad();
  if (login != null) st.creds.login = String(login).trim();
  if (password) st.creds.password = argosEncSecret(String(password).trim());
  return { ok: siSave(st) };
});
ipcMain.handle("si:test", async () => { try { return await siProviderTest(); } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("si:setBudget", (_e, soft, hard) => {
  const st = siLoad();
  if (soft != null && soft !== "") st.budget.soft = Math.max(0, +soft || 0);
  if (hard != null && hard !== "") st.budget.hard = Math.max(0, +hard || 0);
  return { ok: siSave(st), budget: siBudgetState() };
});
ipcMain.handle("si:estimate", (_e, endpoint, count) => ({ ok: true, est: siEstimate(endpoint, count) }));
ipcMain.handle("si:budget", () => ({ ok: true, budget: siBudgetState() }));
ipcMain.handle("si:setSandbox", (_e, on) => { const st = siLoad(); st.sandbox = !!on; return { ok: siSave(st), sandbox: st.sandbox }; });

// ── Adaptateur DataForSEO Labs (concurrentiel SEO) ──
function siBrandDomain(brand) {
  const site = argosBrandAsset(brand, "search_console");
  if (!site) return null;
  try { return new URL(/^https?:\/\//.test(site) ? site : "https://" + site).hostname.replace(/^www\./, ""); } catch { return null; }
}
const SI_LOC = { location_code: 2250, language_code: "fr" }; // France / français (défaut)
async function siLabs(endpoint, body) {
  const j = await siDfsCall(`/v3/dataforseo_labs/google/${endpoint}/live`, [{ ...body }]);
  return j.tasks?.[0]?.result?.[0] || {};
}
// Concurrents organiques d'un domaine (qui se dispute les mêmes mots-clés) — 1 appel.
async function siSeoCompetitors(brand, opts = {}) {
  const domain = siBrandDomain(brand); if (!domain) throw new Error("Aucun site Search Console mappé à ce client.");
  const res = await siLabs("competitors_domain", { target: domain, ...SI_LOC, limit: 12, exclude_top_domains: true, ...opts });
  const items = (res.items || []).map((it) => {
    const org = (it.full_domain_metrics && it.full_domain_metrics.organic) || (it.metrics && it.metrics.organic) || {};
    return { domain: it.domain, common: it.intersections ?? null, avgPosition: it.avg_position != null ? +(+it.avg_position).toFixed(1) : null, keywords: org.count ?? null, etv: org.etv != null ? Math.round(org.etv) : null };
  }).filter((x) => x.domain);
  return { demo: false, domain, items };
}
// Content gap : mots-clés sur lesquels un concurrent se positionne mais PAS le client — 1 appel.
async function siContentGap(brand, competitorDomain) {
  const domain = siBrandDomain(brand); if (!domain) throw new Error("Aucun site Search Console mappé.");
  if (!competitorDomain) throw new Error("Domaine concurrent manquant.");
  const res = await siLabs("domain_intersection", { target1: competitorDomain, target2: domain, intersections: false, ...SI_LOC, limit: 30, order_by: ["first_domain_serp_element.etv,desc"] });
  const items = (res.items || []).map((it) => {
    const kd = it.keyword_data || {};
    const ki = kd.keyword_info || {};
    const rank = it.first_domain_serp_element || {};
    return { keyword: kd.keyword || it.keyword, volume: ki.search_volume ?? null, cpc: ki.cpc ?? null, competition: ki.competition_level || ki.competition || null, position: rank.rank_absolute ?? rank.rank_group ?? null };
  }).filter((x) => x.keyword);
  return { demo: false, target: domain, competitor: competitorDomain, items };
}
// Vue d'ensemble organique + payante d'un domaine (mots-clés, trafic estimé, distribution de positions).
async function siDomainOverview(brand, domainOverride) {
  const domain = domainOverride || siBrandDomain(brand); if (!domain) throw new Error("Aucun site Search Console mappé.");
  const res = await siLabs("domain_rank_overview", { target: domain, ...SI_LOC });
  const it = (res.items || [])[0] || {};
  const m = it.metrics || {};
  const org = m.organic || {}, paid = m.paid || {};
  const pick = (o) => ({ count: o.count ?? null, etv: o.etv != null ? Math.round(o.etv) : null, value: o.estimated_paid_traffic_cost != null ? Math.round(o.estimated_paid_traffic_cost) : null,
    pos1: o.pos_1 ?? null, pos23: o.pos_2_3 ?? null, pos410: o.pos_4_10 ?? null, pos1120: o.pos_11_20 ?? null, pos2130: o.pos_21_30 ?? null, pos3140: o.pos_31_40 ?? null, pos4150: o.pos_41_50 ?? null, pos51100: o.pos_51_100 ?? null });
  return { demo: false, domain, organic: pick(org), paid: pick(paid) };
}
// Mots-clés sur lesquels le domaine se positionne (top par trafic estimé).
async function siRankedKeywords(brand, domainOverride) {
  const domain = domainOverride || siBrandDomain(brand); if (!domain) throw new Error("Aucun site Search Console mappé.");
  const res = await siLabs("ranked_keywords", { target: domain, ...SI_LOC, limit: 40, order_by: ["ranked_serp_element.serp_item.etv,desc"] });
  const items = (res.items || []).map((it) => {
    const kd = it.keyword_data || {}, ki = kd.keyword_info || {};
    const el = it.ranked_serp_element?.serp_item || {};
    return { keyword: kd.keyword || null, volume: ki.search_volume ?? null, cpc: ki.cpc ?? null, position: el.rank_absolute ?? el.rank_group ?? null, etv: el.etv != null ? Math.round(el.etv) : null, url: el.url || null };
  }).filter((x) => x.keyword);
  return { demo: false, domain, items };
}
// Mots-clés du site avec position VÉRIFIÉE EN DIRECT : on récupère la liste des mots-clés (base
// DataForSEO) puis on interroge le SERP live de chacun (top 10) pour la position réelle du jour —
// et on met chaque SERP en cache, si bien que la loupe s'ouvre ensuite instantanément et cohérente.
async function siKeywordsVerified(brand) {
  const domain = siBrandDomain(brand); if (!domain) throw new Error("Aucun site Search Console mappé.");
  const res = await siLabs("ranked_keywords", { target: domain, ...SI_LOC, limit: 10, order_by: ["ranked_serp_element.serp_item.etv,desc"] });
  const dbItems = (res.items || []).map((it) => { const kd = it.keyword_data || {}, ki = kd.keyword_info || {}; return { keyword: kd.keyword || null, volume: ki.search_volume ?? null }; }).filter((x) => x.keyword);
  const st0 = siLoad();
  const results = await Promise.all(dbItems.map(async (k) => {
    const ck = "serp:" + domain + ":" + k.keyword;
    const c = st0.cache[ck];
    if (c && Date.now() - c.at < 7 * 86400000) return { k, serp: c.data, fresh: false };
    try { return { k, serp: await siSerp(brand, k.keyword), fresh: true, ck }; }
    catch { return { k, serp: null, fresh: false }; }
  }));
  const st = siLoad(); let serpCalls = 0;
  for (const r of results) if (r.fresh && r.serp) { st.cache[r.ck] = { at: Date.now(), data: r.serp }; serpCalls++; } // écriture groupée (pas de race)
  if (serpCalls) siSave(st);
  const items = results.map((r) => ({ keyword: r.k.keyword, volume: r.k.volume, position: r.serp ? r.serp.myPosition : null })).sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
  return { demo: false, domain, items, serpCalls };
}
// Résultats Google (SERP) d'un mot-clé : le classement organique réel. Marque les sites placés
// DEVANT le client (position inférieure à la sienne) pour un mot-clé donné.
async function siSerp(brand, keyword) {
  if (!keyword) throw new Error("Mot-clé manquant.");
  const domain = siBrandDomain(brand);
  const j = await siDfsCall("/v3/serp/google/organic/live/regular", [{ keyword, ...SI_LOC, depth: 20 }]);
  const items = (j.tasks?.[0]?.result?.[0]?.items || []).filter((it) => it.type === "organic").map((it) => ({
    position: it.rank_absolute ?? it.rank_group ?? null, domain: (it.domain || "").replace(/^www\./, ""), title: it.title || null, url: it.url || null,
  })).filter((x) => x.domain);
  const mine = domain ? items.find((x) => x.domain.replace(/^www\./, "") === domain.replace(/^www\./, "")) : null;
  return { demo: false, keyword, domain, myPosition: mine ? mine.position : null, items };
}
// Résumé du profil de backlinks (domaines référents, liens, autorité).
async function siBacklinksSummary(brand, domainOverride) {
  const domain = domainOverride || siBrandDomain(brand); if (!domain) throw new Error("Aucun site Search Console mappé.");
  const j = await siDfsCall("/v3/backlinks/summary/live", [{ target: domain, internal_list_limit: 10, backlinks_status_type: "live" }]);
  const r = j.tasks?.[0]?.result?.[0] || {};
  return { demo: false, domain, rank: r.rank ?? null, backlinks: r.backlinks ?? null, referringDomains: r.referring_domains ?? null, referringMainDomains: r.referring_main_domains ?? null, brokenBacklinks: r.broken_backlinks ?? null, referringPages: r.referring_pages ?? null, dofollow: r.referring_links_attributes?.dofollow ?? null };
}
// Données MARCHÉ d'une liste de mots-clés (Keywords Data / Google Ads) : volume, CPC moyen, niveau de
// concurrence, fourchette d'enchères haut de page. 1 appel pour toute la liste (batch, ~très bon marché).
async function siKeywordMarket(keywords, locationName) {
  const kws = [...new Set((keywords || []).map((k) => String(k || "").trim().toLowerCase()).filter(Boolean))].slice(0, 200);
  if (!kws.length) return { demo: false, items: [] };
  const loc = (locationName || "").trim() ? { location_name: locationName.trim(), language_code: "fr" } : SI_LOC;
  const j = await siDfsCall("/v3/keywords_data/google_ads/search_volume/live", [{ keywords: kws, ...loc }]);
  const items = (j.tasks?.[0]?.result || []).map((r) => ({
    keyword: r.keyword, volume: r.search_volume ?? null, cpc: r.cpc != null ? +(+r.cpc).toFixed(2) : null,
    competition: r.competition || null, competitionIndex: r.competition_index ?? null,
    lowBid: r.low_top_of_page_bid != null ? +(+r.low_top_of_page_bid).toFixed(2) : null,
    highBid: r.high_top_of_page_bid != null ? +(+r.high_top_of_page_bid).toFixed(2) : null,
  }));
  return { demo: false, items };
}
// Zone la plus « propre » (pays/ville, pas code postal) déduite du géociblage des campagnes actives.
function deriveZoneFromGeo(geo) {
  if (!geo || !geo.campaigns) return "";
  const locs = [];
  for (const c of geo.campaigns) if (c.current) for (const l of (c.locations || [])) locs.push(l);
  const named = locs.filter((l) => !l.proximity && !/^\d/.test(l.name || "")); // exclut "06000,…"
  const pick = named[0] || locs[0]; if (!pick) return "";
  return (pick.name || "").split(",")[0].split(" (")[0].trim(); // "Monaco (country)" → "Monaco"
}
// Terme d'activité déduit des mots-clés de la campagne (à défaut de secteur renseigné).
function deriveSectorFromKeywords(kwR) {
  const kws = ((kwR && kwR.keywords) || []).filter((k) => k.current).map((k) => (k.keyword || "").trim()).filter(Boolean);
  if (!kws.length) return "";
  return kws.slice().sort((a, z) => z.length - a.length)[0]; // le plus spécifique (ex. « cuisine française »)
}
// Distance à vol d'oiseau (km) entre deux points géo (haversine).
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2);
}
// Concurrents LOCAUX réels via Google Maps (DataForSEO) : vrais commerces du secteur dans la zone
// (ex. restaurants de Monaco). Secteur + zone AUTO-DÉDUITS de la campagne si non renseignés.
// `depth` = nombre de résultats (20 pour les cartes, jusqu'à 100 pour la vue Notoriété).
async function siLocalCompetitors(brand, depth) {
  let sector = (brand.secteur || "").trim();
  let zone = (brand.zone || "").trim();
  const auto = [];
  if (!sector || !zone) {
    const [geo, kwR] = await Promise.all([argosAdsGeo(brand).catch(() => null), argosAdsKeywords(brand, { days: 90 }).catch(() => null)]);
    if (!zone) { zone = deriveZoneFromGeo(geo); if (zone) auto.push("zone"); }
    if (!sector) { sector = deriveSectorFromKeywords(kwR); if (sector) auto.push("secteur"); }
  }
  if (!sector && !zone) { const e = new Error("Impossible de déduire secteur/zone : lance une campagne géociblée avec des mots-clés, ou renseigne-les dans les Réglages."); e.noSector = true; throw e; }
  const d = Math.max(20, Math.min(+depth || 20, 100));
  const keyword = zone ? `${sector} ${zone}`.trim() : sector;
  const body = { keyword, language_code: "fr", depth: d };
  if (zone) body.location_name = zone; else body.location_code = 2250;
  const j = await siDfsCall("/v3/serp/google/maps/live/advanced", [{ ...body }]);
  const norm = (x) => (x || "").replace(/^www\./, "").toLowerCase();
  const myDomain = siBrandDomain(brand);
  const items = (j.tasks?.[0]?.result?.[0]?.items || []).map((it) => ({
    title: it.title || null, rating: it.rating?.value ?? null, reviews: it.rating?.votes_count ?? null,
    category: it.category || null, address: it.address || null, domain: norm(it.domain) || null,
    phone: it.phone || null, url: it.url || null, position: it.rank_absolute ?? it.rank_group ?? null,
    latitude: it.latitude ?? null, longitude: it.longitude ?? null,
    place_id: it.place_id || null, cid: it.cid || null,
    mine: !!(myDomain && it.domain && norm(it.domain) === norm(myDomain)),
  })).filter((x) => x.title);
  // Note + coordonnées de l'établissement DU CLIENT (comparaison + calcul de distance) — lookup par nom.
  let me = null;
  try {
    const mj = await siDfsCall("/v3/serp/google/maps/live/advanced", [{ keyword: `${brand.name} ${zone}`.trim(), language_code: "fr", ...(zone ? { location_name: zone } : { location_code: 2250 }), depth: 5 }]);
    const first = (mj.tasks?.[0]?.result?.[0]?.items || [])[0];
    if (first && first.title) me = { title: first.title, rating: first.rating?.value ?? null, reviews: first.rating?.votes_count ?? null, category: first.category || null, latitude: first.latitude ?? null, longitude: first.longitude ?? null, place_id: first.place_id || null, cid: first.cid || null };
  } catch {}
  // Secours : si le lookup nominatif échoue, on prend le client trouvé dans SES PROPRES résultats
  // (mine:true, matché par domaine) — garantit note/avis/coordonnées → distances fiables.
  const mineInResults = items.find((c) => c.mine);
  if (mineInResults) {
    if (!me) me = { title: mineInResults.title, category: mineInResults.category };
    if (me.rating == null) me.rating = mineInResults.rating;
    if (me.reviews == null) me.reviews = mineInResults.reviews;
    if (me.latitude == null) { me.latitude = mineInResults.latitude; me.longitude = mineInResults.longitude; }
    if (!me.place_id) me.place_id = mineInResults.place_id;
  }
  // Distance de chaque concurrent à l'établissement du client (si coordonnées dispo).
  if (me && me.latitude != null && me.longitude != null) {
    for (const c of items) if (c.latitude != null && c.longitude != null) c.distance = haversineKm(me.latitude, me.longitude, c.latitude, c.longitude);
  }
  return { demo: false, keyword, sector, zone, auto, me, competitors: items };
}
// Ancienneté (proxy) = âge du nom de domaine (date d'enregistrement whois de DataForSEO).
// L'endpoint whois/overview facture au FORFAIT par appel et accepte jusqu'à 8 domaines (filtre `in`).
// siDomainAges(domaines) → { ageByDomain: {domaine: mois|null}, calls } (null = domaine absent de la base).
const SI_WHOIS_BATCH = 8;
const domAgeMonths = (created) => { if (!created) return null; const t = Date.parse((created || "").replace(" +00:00", "Z").replace(" ", "T")); return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / (30.44 * 86400000))); };
async function siDomainAges(domains) {
  const uniq = [...new Set((domains || []).map((x) => (x || "").replace(/^www\./, "").trim().toLowerCase()).filter(Boolean))];
  const ageByDomain = {}; let calls = 0;
  for (let i = 0; i < uniq.length; i += SI_WHOIS_BATCH) {
    const batch = uniq.slice(i, i + SI_WHOIS_BATCH);
    calls++;
    const j = await siDfsCall("/v3/domain_analytics/whois/overview/live", [{ limit: SI_WHOIS_BATCH, filters: [["domain", "in", batch]] }]);
    const items = j.tasks?.[0]?.result?.[0]?.items || [];
    const found = {}; for (const it of items) if (it.domain) found[it.domain.replace(/^www\./, "").toLowerCase()] = domAgeMonths(it.created_datetime);
    for (const d of batch) ageByDomain[d] = (d in found) ? found[d] : null; // null = introuvable → « NC »
  }
  return { ageByDomain, calls };
}
// Avis Google d'un établissement (par place_id) — endpoint asynchrone task_post/get.
// Renvoie les 10 meilleurs et 10 pires avis parmi les avis récupérés (tri par note, récence en départage).
async function siPlaceReviews(placeId, depth = 40) {
  if (!placeId) return null;
  // priority 2 (haute) = traitement plus rapide côté DataForSEO (les tâches avis sont lentes en priorité normale).
  const post = await siDfsCall("/v3/business_data/google/reviews/task_post", [{ place_id: placeId, depth, priority: 2, language_code: "fr", location_code: 2250 }]);
  const id = post.tasks?.[0]?.id;
  if (!id) return null;
  const ts = (s) => Date.parse((s || "").replace(" +00:00", "Z").replace(" ", "T")) || 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await new Promise((r) => setTimeout(r, 3000));
    let g; try { g = await siDfsCall(`/v3/business_data/google/reviews/task_get/${id}`, null); } catch (e) { if (/404|40602|40601/i.test(e.message)) continue; throw e; }
    const task = g.tasks?.[0];
    if (task?.status_code === 20000) {
      const raw = (task.result?.[0]?.items || []).filter((it) => it.rating && it.rating.value != null);
      const map = (it) => ({ rating: it.rating.value, text: (it.review_text || "").trim().slice(0, 500), timeAgo: it.time_ago || null, timestamp: it.timestamp || null, author: it.profile_name || null });
      const sorted = raw.slice().sort((a, b) => (b.rating.value - a.rating.value) || (ts(b.timestamp) - ts(a.timestamp)));
      const best = sorted.slice(0, 10).map(map);
      const worst = sorted.slice(10).slice(-10).reverse().map(map); // pires (hors des 10 meilleurs), du pire au moins pire
      return { total: task.result?.[0]?.reviews_count ?? raw.length, fetched: raw.length, best, worst };
    }
    if (task && ![40602, 40601].includes(task.status_code)) break;
  }
  return null; // pas prête à temps
}
// Vue SEA : présence publicitaire (Google Ads) du client + des concurrents détectés — via la
// section "paid" de domain_rank_overview de chaque domaine (qui investit, sur combien de mots-clés).
async function siSeaOverview(brand) {
  const domain = siBrandDomain(brand); if (!domain) throw new Error("Aucun site Search Console mappé.");
  // concurrents (depuis le cache si dispo, sinon on découvre)
  const st = siLoad();
  const norm = (x) => (x || "").replace(/^www\./, "");
  let comps = (st.cache["seocomp:" + domain]?.data?.items || []).map((c) => c.domain);
  if (!comps.length) { const cr = await siSeoCompetitors(brand); comps = (cr.items || []).map((c) => c.domain); }
  comps = comps.filter((c) => norm(c) !== norm(domain)).slice(0, 5); // le client lui-même n'est pas son concurrent
  const domains = [domain, ...comps];
  const rows = [];
  for (const d of domains) {
    try { const ov = await siDomainOverview(brand, d); rows.push({ domain: d, mine: d === domain, paidKeywords: ov.paid.count, paidTraffic: ov.paid.etv, paidCost: ov.paid.value }); }
    catch { rows.push({ domain: d, mine: d === domain, paidKeywords: null }); }
  }
  return { demo: false, domain, rows };
}
// ── Veille SEA MANUELLE : l'utilisateur choisit ses mots-clés (persistés par marque) ; pour chacun
// on lit le SERP « advanced » → la POSITION du client (organique) + s'il annonce, et le paysage
// publicitaire (annonces des concurrents : annonceur, titre, description). Rafraîchi 7 j + à la demande.
function siSeaKwLoad(brandId) { const st = siLoad(); return (st.seaKw && st.seaKw[brandId]) || []; }
function siSeaKwSave(brandId, list) { const st = siLoad(); st.seaKw = st.seaKw || {}; st.seaKw[brandId] = list; return siSave(st); }
async function siSeaKwFetch(brand, kw) {
  const domain = siBrandDomain(brand);
  const norm = (x) => (x || "").replace(/^www\./, "");
  const hostOf = (u) => { try { return norm(new URL(u).hostname); } catch { return null; } };
  const j = await siDfsCall("/v3/serp/google/organic/live/advanced", [{ keyword: kw, ...SI_LOC, depth: 20 }]);
  const items = j.tasks?.[0]?.result?.[0]?.items || [];
  const ads = [], organic = [];
  for (const it of items) {
    const d = norm(it.domain || "") || hostOf(it.url);
    if (!d) continue;
    if (it.type === "paid") ads.push({ domain: d, title: it.title || null, description: it.description || null, url: it.url || null });
    else if (it.type === "organic") organic.push({ position: it.rank_absolute ?? it.rank_group ?? null, domain: d, title: it.title || null, url: it.url || null });
  }
  const mine = domain ? organic.find((o) => norm(o.domain) === norm(domain)) : null;
  const iAdvertise = domain ? ads.some((a) => norm(a.domain) === norm(domain)) : false;
  return { keyword: kw, myPosition: mine ? mine.position : null, iAdvertise, adCount: ads.length, ads, organic: organic.slice(0, 10) };
}
// Exécute + met en cache (7 j, local + cloud) le SERP d'un mot-clé SEA. force=true ignore la fraîcheur.
async function siSeaKwRun(brandId, kw, force) {
  const b = argosState().brands.find((x) => x.id === brandId); if (!b) return { ok: false, error: "Marque inconnue." };
  const key = "seaadv:" + siDom(brandId) + ":" + kw;
  const st0 = siLoad(); const cached = st0.cache[key];
  if (!force && cached && Date.now() - cached.at < 7 * 86400000) return { ok: true, data: cached.data, at: cached.at, cached: true };
  if (!force) { const cloud = await siCloudGet(key); if (cloud != null) { const st = siLoad(); st.cache[key] = { at: Date.now(), data: cloud }; siSave(st); return { ok: true, data: cloud, at: Date.now(), cached: true, source: "cloud" }; } }
  const est = siEstimate("serp", 1);
  if (!st0.sandbox && est && !siBudgetCheck(est.eur)) return { ok: false, budgetBlocked: true, error: "Budget mensuel atteint (blocage). Augmente la limite dans Titan." };
  let data; try { data = await siSeaKwFetch(b, kw); } catch (e) { return { ok: false, error: e.message }; }
  const st = siLoad(); st.cache[key] = { at: Date.now(), data }; siSave(st);
  if (!st0.sandbox) { siCloudSet(key, data); siCharge("serp", est.eur, { key }); }
  return { ok: true, data, at: Date.now(), cost: st0.sandbox ? 0 : est.eur, budget: siBudgetState() };
}
// Exécute une action payante : cache (dédup) → estimation → check budget → appel → facturation.
// En sandbox : gratuit, non facturé, non plafonné. TTL du cache : 7 j (données concurrentielles stables).
async function siPaidAction(brandId, endpoint, cacheKey, runFn, peek, force) {
  const b = argosState().brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  const st0 = siLoad();
  const cached = st0.cache[cacheKey];
  if (!force && cached && Date.now() - cached.at < 7 * 86400000) return { ok: true, data: cached.data, cached: true, sandbox: st0.sandbox };
  // Cache cloud (Supabase) : si la pré-chauffe hebdo a déjà rempli l'entrée, on la lit (gratuit)
  // et on repeuple le cache local → affichage instantané même sur un poste neuf, sans appel payant.
  if (!force) {
    const cloud = await siCloudGet(cacheKey);
    if (cloud != null) { const st = siLoad(); st.cache[cacheKey] = { at: Date.now(), data: cloud }; siSave(st); return { ok: true, data: cloud, cached: true, source: "cloud", sandbox: st0.sandbox }; }
  }
  if (peek) return { ok: true, data: null, peeked: true, sandbox: st0.sandbox }; // lecture cache seule : pas d'appel payant
  const est = siEstimate(endpoint, 1);
  if (!st0.sandbox && est && !siBudgetCheck(est.eur)) return { ok: false, error: "Budget mensuel atteint (blocage). Augmente la limite dans Titan.", budgetBlocked: true };
  let data;
  try { data = await runFn(b); }
  catch (e) { return { ok: false, error: e.message }; }
  const st = siLoad(); st.cache[cacheKey] = { at: Date.now(), data }; siSave(st);
  if (!st0.sandbox) siCloudSet(cacheKey, data); // réplique dans Supabase (best-effort, silencieux si absent)
  if (!st0.sandbox && est) siCharge(endpoint, est.eur, { key: cacheKey });
  return { ok: true, data, cost: st0.sandbox ? 0 : (est ? est.eur : 0), sandbox: st0.sandbox, budget: siBudgetState() };
}
ipcMain.handle("si:seoCompetitors", (_e, brandId, peek) => {
  const b = argosState().brands.find((x) => x.id === brandId);
  return siPaidAction(brandId, "seo_competitors", "seocomp:" + (b ? siBrandDomain(b) : brandId), (bb) => siSeoCompetitors(bb), peek);
});
ipcMain.handle("si:contentGap", (_e, brandId, competitor, peek) => {
  const b = argosState().brands.find((x) => x.id === brandId);
  return siPaidAction(brandId, "content_gap", "gap:" + (b ? siBrandDomain(b) : brandId) + ":" + competitor, (bb) => siContentGap(bb, competitor), peek);
});
const siDom = (brandId) => { const b = argosState().brands.find((x) => x.id === brandId); return b ? siBrandDomain(b) : brandId; };
// `domain` optionnel = override pour analyser le poids SEO d'un CONCURRENT (clé de cache par ce domaine).
ipcMain.handle("si:domainOverview", (_e, brandId, peek, domain) => {
  const dom = (domain || "").replace(/^www\./, "").trim().toLowerCase() || siDom(brandId);
  return siPaidAction(brandId, "domain_overview", "domov:" + dom, (bb) => siDomainOverview(bb, domain || null), peek);
});
ipcMain.handle("si:rankedKw", (_e, brandId, peek) => siPaidAction(brandId, "ranked_kw", "rankkw:" + siDom(brandId), (bb) => siRankedKeywords(bb), peek));
// Estimation SEA d'un domaine CONCURRENT : mots-clés payants + dépense estimée + ses mots-clés visibles.
ipcMain.handle("si:competitorSea", async (_e, brandId, domain, peek) => {
  const b = argosState().brands.find((x) => x.id === brandId); if (!b) return { ok: false, error: "Marque inconnue." };
  domain = (domain || "").replace(/^www\./, "").trim().toLowerCase(); if (!domain) return { ok: false, error: "Domaine manquant." };
  const key = "compsea:" + domain;
  const st0 = siLoad(); const cached = st0.cache[key];
  if (cached && Date.now() - cached.at < 7 * 86400000) return { ok: true, data: cached.data, cached: true, sandbox: st0.sandbox };
  const cloud = await siCloudGet(key);
  if (cloud != null) { const st = siLoad(); st.cache[key] = { at: Date.now(), data: cloud }; siSave(st); return { ok: true, data: cloud, cached: true, source: "cloud", sandbox: st0.sandbox }; }
  if (peek) return { ok: true, data: null, peeked: true, sandbox: st0.sandbox };
  const e1 = siEstimate("domain_overview", 1), e2 = siEstimate("ranked_kw", 1);
  const totalEur = (e1 ? e1.eur : 0) + (e2 ? e2.eur : 0);
  if (!st0.sandbox && !siBudgetCheck(totalEur)) return { ok: false, budgetBlocked: true, error: "Budget mensuel atteint (blocage). Augmente la limite dans Titan." };
  let ov, rk;
  try { [ov, rk] = await Promise.all([siDomainOverview(b, domain), siRankedKeywords(b, domain)]); } catch (e) { return { ok: false, error: e.message }; }
  const data = { domain, paid: ov.paid, organic: ov.organic, keywords: rk.items };
  const st = siLoad(); st.cache[key] = { at: Date.now(), data }; siSave(st);
  if (!st0.sandbox) { siCloudSet(key, data); siCharge("domain_overview", e1 ? e1.eur : 0, { key }); siCharge("ranked_kw", e2 ? e2.eur : 0, { key }); }
  return { ok: true, data, cost: st0.sandbox ? 0 : totalEur, sandbox: st0.sandbox, budget: siBudgetState() };
});
ipcMain.handle("si:backlinks", (_e, brandId, peek) => siPaidAction(brandId, "backlinks_sum", "bl:" + siDom(brandId), (bb) => siBacklinksSummary(bb), peek));
ipcMain.handle("si:serp", (_e, brandId, keyword, peek) => siPaidAction(brandId, "serp", "serp:" + siDom(brandId) + ":" + (keyword || ""), (bb) => siSerp(bb, keyword), peek));
// Données marché (volume / CPC / concurrence) d'une liste de mots-clés — 1 appel batch, cache 7 j.
ipcMain.handle("si:kwMarket", async (_e, brandId, keywords, peek, location) => {
  const b = argosState().brands.find((x) => x.id === brandId); if (!b) return { ok: false, error: "Marque inconnue." };
  const kws = [...new Set((keywords || []).map((k) => String(k || "").trim().toLowerCase()).filter(Boolean))];
  if (!kws.length) return { ok: true, data: { items: [] } };
  const loc = (location || "").trim();
  const key = "kwmarket:" + siDom(brandId) + ":" + (loc.toLowerCase() || "fr") + ":" + kws.slice().sort().join("|");
  const st0 = siLoad(); const cached = st0.cache[key];
  if (cached && Date.now() - cached.at < 7 * 86400000) return { ok: true, data: cached.data, cached: true, sandbox: st0.sandbox };
  const cloud = await siCloudGet(key);
  if (cloud != null) { const st = siLoad(); st.cache[key] = { at: Date.now(), data: cloud }; siSave(st); return { ok: true, data: cloud, cached: true, source: "cloud", sandbox: st0.sandbox }; }
  if (peek) return { ok: true, data: null, peeked: true, sandbox: st0.sandbox };
  const est = siEstimate("keyword_volume", kws.length);
  if (!st0.sandbox && est && !siBudgetCheck(est.eur)) return { ok: false, error: "Budget mensuel atteint (blocage). Augmente la limite dans Titan.", budgetBlocked: true };
  let data; try { data = await siKeywordMarket(kws, loc || null); } catch (e) { return { ok: false, error: e.message }; }
  const st = siLoad(); st.cache[key] = { at: Date.now(), data }; siSave(st);
  if (!st0.sandbox) { siCloudSet(key, data); siCharge("keyword_volume", est ? est.eur : 0, { key }); }
  return { ok: true, data, cost: st0.sandbox ? 0 : (est ? est.eur : 0), sandbox: st0.sandbox, budget: siBudgetState() };
});
// Concurrents LOCAUX réels (Google Maps) — vrais commerces du secteur+zone du client. Cache 7 j.
ipcMain.handle("si:localCompetitors", async (_e, brandId, peek, depth) => {
  const b = argosState().brands.find((x) => x.id === brandId); if (!b) return { ok: false, error: "Marque inconnue." };
  const d = Math.max(20, Math.min(+depth || 20, 100));
  // depth 20 garde l'ancienne clé (cache existant préservé pour les cartes) ; les profondeurs > 20 ont leur clé.
  // v4 = purge des caches sans distances (fetch client raté figé par le cache-first).
  const key = "localcomp:v4:" + siDom(brandId) + ":" + ((b.secteur || "").trim().toLowerCase() || "auto") + ":" + ((b.zone || "").trim().toLowerCase() || "auto") + (d > 20 ? ":d" + d : "");
  const st0 = siLoad(); const cached = st0.cache[key];
  if (cached && Date.now() - cached.at < 7 * 86400000) return { ok: true, data: cached.data, cached: true, sandbox: st0.sandbox };
  const cloud = await siCloudGet(key);
  if (cloud != null) { const st = siLoad(); st.cache[key] = { at: Date.now(), data: cloud }; siSave(st); return { ok: true, data: cloud, cached: true, source: "cloud", sandbox: st0.sandbox }; }
  if (peek) return { ok: true, data: null, peeked: true, sandbox: st0.sandbox };
  const est = siEstimate("serp", 1);
  if (!st0.sandbox && est && !siBudgetCheck(est.eur)) return { ok: false, error: "Budget mensuel atteint (blocage). Augmente la limite dans Titan.", budgetBlocked: true };
  let data; try { data = await siLocalCompetitors(b, d); } catch (e) { return { ok: false, error: e.message, noSector: !!e.noSector }; }
  const st = siLoad(); st.cache[key] = { at: Date.now(), data }; siSave(st);
  if (!st0.sandbox) { siCloudSet(key, data); siCharge("serp", est ? est.eur : 0, { key }); }
  return { ok: true, data, cost: st0.sandbox ? 0 : (est ? est.eur : 0), sandbox: st0.sandbox, budget: siBudgetState() };
});
// Ancienneté (âge de domaine whois) pour l'établissement du client + ses concurrents locaux.
// domains = domaines des concurrents (le domaine du client est ajouté côté serveur). Cache 30 j par domaine
// (la date de création d'un domaine ne change jamais). peek = ne renvoie que le cache, aucun appel payant.
ipcMain.handle("si:localAges", async (_e, brandId, domains, peek) => {
  const b = argosState().brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  const meDomain = (siBrandDomain(b) || "").replace(/^www\./, "").toLowerCase() || null;
  const wanted = [...new Set([...(domains || []), meDomain].map((x) => (x || "").replace(/^www\./, "").trim().toLowerCase()).filter(Boolean))];
  const st0 = siLoad();
  const FRESH = 30 * 86400000;
  const ages = {}; const uncached = [];
  for (const d of wanted) {
    const c = st0.cache["domage:" + d];
    if (c && Date.now() - c.at < FRESH) ages[d] = c.data.m; else uncached.push(d);
  }
  if (peek) return { ok: true, ages, meDomain, needFetch: uncached.length, sandbox: st0.sandbox };
  if (!uncached.length) return { ok: true, ages, meDomain, cost: 0, sandbox: st0.sandbox };
  const batches = Math.ceil(uncached.length / SI_WHOIS_BATCH);
  const est = siEstimate("whois", batches);
  if (!st0.sandbox && est && !siBudgetCheck(est.eur)) return { ok: false, error: "Budget mensuel atteint (blocage). Augmente la limite dans Titan.", budgetBlocked: true };
  let res; try { res = await siDomainAges(uncached); } catch (e) { return { ok: false, error: e.message }; }
  const st = siLoad();
  for (const d of uncached) { const m = (d in res.ageByDomain) ? res.ageByDomain[d] : null; ages[d] = m; st.cache["domage:" + d] = { at: Date.now(), data: { m } }; }
  siSave(st);
  if (!st0.sandbox) siCharge("whois", est ? est.eur : 0, { calls: res.calls });
  return { ok: true, ages, meDomain, cost: st0.sandbox ? 0 : (est ? est.eur : 0), calls: res.calls, sandbox: st0.sandbox, budget: siBudgetState() };
});
// Avis Google d'un établissement (par place_id) : 10 meilleurs + 10 pires avis récents. Cache 14 j.
ipcMain.handle("si:placeReviews", async (_e, brandId, placeId, peek) => {
  const b = argosState().brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  if (!placeId) return { ok: false, error: "Établissement sans identifiant Google Maps." };
  const key = "reviews:" + placeId;
  const st0 = siLoad(); const cached = st0.cache[key];
  if (cached && Date.now() - cached.at < 14 * 86400000) return { ok: true, data: cached.data, cached: true, sandbox: st0.sandbox };
  if (peek) return { ok: true, data: null, peeked: true, sandbox: st0.sandbox };
  const est = siEstimate("reviews", 1);
  if (!st0.sandbox && est && !siBudgetCheck(est.eur)) return { ok: false, error: "Budget mensuel atteint (blocage). Augmente la limite dans Titan.", budgetBlocked: true };
  let data; try { data = await siPlaceReviews(placeId); } catch (e) { return { ok: false, error: e.message }; }
  if (!data) return { ok: false, error: "Avis indisponibles (tâche trop longue ou établissement sans avis)." };
  const st = siLoad(); st.cache[key] = { at: Date.now(), data }; siSave(st);
  if (!st0.sandbox) siCharge("reviews", est ? est.eur : 0, { key });
  return { ok: true, data, cost: st0.sandbox ? 0 : (est ? est.eur : 0), sandbox: st0.sandbox, budget: siBudgetState() };
});
// Mots-clés avec position live vérifiée (ranked_keywords + SERP live de chacun) — coût = 1 ranked + N serp.
ipcMain.handle("si:keywords", async (_e, brandId, peek) => {
  const b = argosState().brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  const key = "kwlive:" + siDom(brandId);
  const st0 = siLoad();
  const cached = st0.cache[key];
  if (cached && Date.now() - cached.at < 7 * 86400000) return { ok: true, data: cached.data, cached: true, sandbox: st0.sandbox };
  if (peek) return { ok: true, data: null, sandbox: st0.sandbox };
  const est = (siEstimate("ranked_kw", 1)?.eur || 0) + (siEstimate("serp", 10)?.eur || 0);
  if (!st0.sandbox && !siBudgetCheck(est)) return { ok: false, budgetBlocked: true, error: "Budget mensuel atteint (blocage). Augmente la limite dans Titan." };
  let data; try { data = await siKeywordsVerified(b); } catch (e) { return { ok: false, error: e.message }; }
  const st = siLoad(); st.cache[key] = { at: Date.now(), data }; siSave(st);
  if (!st0.sandbox) siCharge("ranked_kw", (siEstimate("ranked_kw", 1)?.eur || 0) + (siEstimate("serp", data.serpCalls || 0)?.eur || 0), { key });
  return { ok: true, data, sandbox: st0.sandbox, budget: siBudgetState() };
});
// SEA : appel multi-domaines (client + jusqu'à 5 concurrents) → coût = 0,02 € par domaine.
ipcMain.handle("si:sea", async (_e, brandId, peek) => {
  const b = argosState().brands.find((x) => x.id === brandId);
  if (!b) return { ok: false, error: "Marque inconnue." };
  const key = "sea:" + siDom(brandId);
  const st0 = siLoad();
  const cached = st0.cache[key];
  if (cached && Date.now() - cached.at < 7 * 86400000) return { ok: true, data: cached.data, cached: true, sandbox: st0.sandbox };
  if (peek) return { ok: true, data: null, peeked: true, sandbox: st0.sandbox };
  const est = siEstimate("sea_overview", 6);
  if (!st0.sandbox && !siBudgetCheck(est.eur)) return { ok: false, error: "Budget mensuel atteint (blocage). Augmente la limite dans Titan.", budgetBlocked: true };
  let data; try { data = await siSeaOverview(b); } catch (e) { return { ok: false, error: e.message }; }
  const st = siLoad(); st.cache[key] = { at: Date.now(), data }; siSave(st);
  const realEst = siEstimate("sea_overview", (data.rows || []).length || 1);
  if (!st0.sandbox) { siCloudSet(key, data); siCharge("sea_overview", realEst.eur, { key }); }
  return { ok: true, data, cost: st0.sandbox ? 0 : realEst.eur, sandbox: st0.sandbox, budget: siBudgetState() };
});
// Veille SEA manuelle : liste des mots-clés surveillés + leur dernier résultat en cache (peek, gratuit).
ipcMain.handle("si:seaKwList", (_e, brandId) => {
  const b = argosState().brands.find((x) => x.id === brandId); if (!b) return { ok: false, error: "Marque inconnue." };
  const domain = siDom(brandId); const st = siLoad();
  const keywords = siSeaKwLoad(brandId).map((kw) => { const c = st.cache["seaadv:" + domain + ":" + kw]; return { keyword: kw, data: c ? c.data : null, at: c ? c.at : null }; });
  return { ok: true, keywords, sandbox: st.sandbox };
});
// Ajoute un mot-clé (persisté) et l'analyse aussitôt (payant : 1 SERP).
ipcMain.handle("si:seaKwAdd", async (_e, brandId, kw) => {
  const b = argosState().brands.find((x) => x.id === brandId); if (!b) return { ok: false, error: "Marque inconnue." };
  kw = String(kw || "").trim().toLowerCase().replace(/\s+/g, " "); if (!kw) return { ok: false, error: "Mot-clé vide." };
  if (kw.length > 80) return { ok: false, error: "Mot-clé trop long." };
  const list = siSeaKwLoad(brandId); if (!list.includes(kw)) { list.push(kw); siSeaKwSave(brandId, list); }
  const r = await siSeaKwRun(brandId, kw, true);
  return { ...r, keyword: kw };
});
// Supprime un mot-clé (et son résultat en cache).
ipcMain.handle("si:seaKwRemove", (_e, brandId, kw) => {
  kw = String(kw || "").trim().toLowerCase();
  const list = siSeaKwLoad(brandId).filter((k) => k !== kw); siSeaKwSave(brandId, list);
  const st = siLoad(); delete st.cache["seaadv:" + siDom(brandId) + ":" + kw]; siSave(st);
  return { ok: true, keywords: list };
});
// Rafraîchissement instantané : réanalyse tous les mots-clés surveillés (payant : 1 SERP par mot-clé).
ipcMain.handle("si:seaKwRefresh", async (_e, brandId, kw) => {
  const list = kw ? [String(kw).trim().toLowerCase()] : siSeaKwLoad(brandId);
  const results = [];
  for (const k of list) { const r = await siSeaKwRun(brandId, k, true); results.push({ keyword: k, data: r.data || null, at: r.at || null, error: r.ok ? null : r.error, budgetBlocked: !!r.budgetBlocked }); if (r.budgetBlocked) break; }
  return { ok: true, results, budget: siBudgetState() };
});

// ══════════ Cache cloud (Supabase) + pré-chauffe hebdomadaire ══════════
// But : le lundi 01:00, on récupère et met en cache (7 j) toutes les données payantes de chaque
// client — vue d'ensemble, backlinks, concurrents, et le classement (SERP) de chaque mot-clé
// Search Console — pour que la loupe et les vues s'affichent INSTANTANÉMENT toute la semaine, sans
// nouvel appel payant. Le cache est répliqué dans Supabase (table argos_si_cache) pour survivre à
// un réinstall et être partagé entre postes ; si la table/session est absente, on reste en local.
const SI_CLOUD_TABLE = "argos_si_cache";
function siCloudEnabled() { return !!loadSession()?.access_token; }
async function siCloudReq(method, path, body, extraHeaders) {
  if (!loadSession()?.access_token) return null;
  const doFetch = () => fetch(`${AUTH_BASE}/rest/v1/${path}`, {
    method,
    headers: { apikey: AUTH_ANON, Authorization: `Bearer ${loadSession()?.access_token}`, "Content-Type": "application/json", ...(extraHeaders || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let r = await doFetch();
  if ((r.status === 401 || r.status === 403) && (await refreshToken())) r = await doFetch();
  return r;
}
// Lecture cache cloud : renvoie le payload si l'entrée existe et n'est pas expirée, sinon null.
async function siCloudGet(cacheKey) {
  try {
    const r = await siCloudReq("GET", `${SI_CLOUD_TABLE}?cache_key=eq.${encodeURIComponent(cacheKey)}&select=payload,expires_at&limit=1`);
    if (!r || !r.ok) return null;
    const rows = await r.json().catch(() => []);
    const row = rows && rows[0];
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    return row.payload ?? null;
  } catch { return null; }
}
// Écriture cache cloud (upsert). Best-effort : silencieuse si la table n'existe pas / hors ligne.
async function siCloudSet(cacheKey, data, ttlMs = 7 * 86400000) {
  try {
    const now = Date.now();
    await siCloudReq("POST", SI_CLOUD_TABLE, [{ cache_key: cacheKey, payload: data, fetched_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMs).toISOString() }], { Prefer: "resolution=merge-duplicates,return=minimal" });
  } catch {}
}

// Semaine ISO (ex. "2026-W30") — clé de déduplication de la pré-chauffe hebdomadaire.
function isoWeek(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}
// Mots-clés Search Console d'une marque (gratuit) — la liste à pré-chauffer pour la loupe.
async function siGscKeywordsFor(brand, limit = 12) {
  try { const real = await argosRealSeo(brand, 30); return (real?.topQueries || []).map((x) => x.label).filter(Boolean).slice(0, limit); }
  catch { return []; }
}
// Pré-chauffe une marque : rafraîchit + met en cache 7 j (local + cloud) toutes ses données payantes.
// Respecte le budget (s'arrête proprement si le plafond est atteint).
async function argosPrewarmBrand(brand) {
  const domain = siBrandDomain(brand);
  if (!domain) return { brand: brand.name, skipped: "aucun site Search Console mappé" };
  const done = { brand: brand.name, domain, calls: 0, errors: 0 };
  const run = async (endpoint, cacheKey, fn) => {
    if (done.budgetBlocked) return;
    const est = siEstimate(endpoint, 1);
    if (!siLoad().sandbox && est && !siBudgetCheck(est.eur)) { done.budgetBlocked = true; return; }
    try {
      const data = await fn();
      const st = siLoad(); st.cache[cacheKey] = { at: Date.now(), data }; siSave(st);
      if (!siLoad().sandbox) { siCloudSet(cacheKey, data); if (est) siCharge(endpoint, est.eur, { key: cacheKey, prewarm: true }); }
      done.calls++;
    } catch { done.errors++; }
  };
  await run("domain_overview", "domov:" + domain, () => siDomainOverview(brand));
  await run("backlinks_sum", "bl:" + domain, () => siBacklinksSummary(brand));
  await run("seo_competitors", "seocomp:" + domain, () => siSeoCompetitors(brand));
  const kws = await siGscKeywordsFor(brand);
  for (const kw of kws) await run("serp", "serp:" + domain + ":" + kw, () => siSerp(brand, kw));
  // Mots-clés SEA surveillés manuellement par l'utilisateur (rafraîchis 7 j avec le reste).
  for (const kw of siSeaKwLoad(brand.id)) await run("serp", "seaadv:" + domain + ":" + kw, () => siSeaKwFetch(brand, kw));
  return done;
}
// Pré-chauffe tous les clients (marques visibles avec un site mappé). Séquentiel (limite de débit).
async function argosPrewarmAll() {
  const st = siLoad();
  if (st.sandbox) return { ok: false, error: "Mode sandbox actif — pré-chauffe désactivée." };
  if (!st.creds?.login || !st.creds?.password) return { ok: false, error: "Fournisseur non connecté." };
  const brands = argosState().brands.filter((b) => !b.hidden && siBrandDomain(b));
  const results = [];
  for (const b of brands) { const r = await argosPrewarmBrand(b); results.push(r); if (r.budgetBlocked) break; }
  const si = siLoad();
  si.prewarm = { lastWeek: isoWeek(new Date()), lastAt: new Date().toISOString(), results };
  siSave(si);
  return { ok: true, brands: results.length, results, budget: siBudgetState() };
}

// ── Planification : lundi 01:00 (heure locale) ──
// Sur poste, l'app n'est pas toujours ouverte à 01:00 : on combine un minuteur précis (si l'app
// tourne à ce moment) + un rattrapage au lancement et toutes les 6 h (si la semaine ISO courante
// n'a pas encore été rafraîchie). Résultat : au pire, la pré-chauffe se fait au prochain lancement.
function nextMonday1am(from = new Date()) {
  const d = new Date(from); d.setHours(1, 0, 0, 0);
  let add = (1 - d.getDay() + 7) % 7;
  if (add === 0 && from.getTime() >= d.getTime()) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}
function prewarmDue() {
  const st = siLoad();
  if (st.sandbox || st.prewarmAuto === false || !st.creds?.login || !st.creds?.password) return false;
  if (st.prewarm?.lastWeek === isoWeek(new Date())) return false; // déjà rafraîchi cette semaine
  const now = new Date();
  const mondayThisWeek = nextMonday1am(new Date(now.getTime() - 7 * 86400000)); // lundi 01:00 de cette semaine
  return now.getTime() >= mondayThisWeek.getTime();
}
let _prewarmRunning = false;
async function argosPrewarmMaybe(reason) {
  if (_prewarmRunning || !prewarmDue()) return;
  _prewarmRunning = true;
  try { console.log("[prewarm]", reason, "→ démarrage"); const r = await argosPrewarmAll(); console.log("[prewarm] terminé :", JSON.stringify((r.results || []).map((x) => ({ b: x.brand, calls: x.calls, err: x.errors })))); }
  catch (e) { console.log("[prewarm] échec :", e.message); }
  finally { _prewarmRunning = false; }
}
function scheduleWeeklyPrewarm() {
  const ms = Math.max(60000, Math.min(nextMonday1am().getTime() - Date.now(), 2 ** 31 - 1));
  setTimeout(() => { argosPrewarmMaybe("minuteur lundi 01:00"); scheduleWeeklyPrewarm(); }, ms);
}

ipcMain.handle("si:prewarmNow", async (_e, brandId) => {
  try {
    if (siLoad().sandbox) return { ok: false, error: "Mode sandbox actif — pré-chauffe désactivée." };
    if (brandId) { const b = argosState().brands.find((x) => x.id === brandId); if (!b) return { ok: false, error: "Marque inconnue." }; const r = await argosPrewarmBrand(b); const si = siLoad(); si.prewarm = { lastWeek: isoWeek(new Date()), lastAt: new Date().toISOString(), results: [r] }; siSave(si); return { ok: true, results: [r], budget: siBudgetState() }; }
    return await argosPrewarmAll();
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("si:prewarmStatus", () => ({ ok: true, prewarm: siLoad().prewarm || null, auto: siLoad().prewarmAuto !== false, cloud: siCloudEnabled(), nextRun: nextMonday1am().toISOString() }));
ipcMain.handle("si:setPrewarmAuto", (_e, on) => { const st = siLoad(); st.prewarmAuto = !!on; return { ok: siSave(st), auto: st.prewarmAuto }; });
// SQL de création de la table de cache cloud (à exécuter une fois dans le SQL Editor Supabase).
ipcMain.handle("si:cloudSql", () => {
  let editor = null; try { editor = `https://supabase.com/dashboard/project/${new URL(AUTH_BASE).hostname.split(".")[0]}/sql/new`; } catch {}
  const sql = `-- Cache Search Intelligence (Olympus) — pré-chauffe hebdomadaire, TTL 7 j.
create table if not exists public.${SI_CLOUD_TABLE} (
  cache_key   text primary key,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
alter table public.${SI_CLOUD_TABLE} enable row level security;
create policy "auth read"   on public.${SI_CLOUD_TABLE} for select to authenticated using (true);
create policy "auth insert" on public.${SI_CLOUD_TABLE} for insert to authenticated with check (true);
create policy "auth update" on public.${SI_CLOUD_TABLE} for update to authenticated using (true) with check (true);
create policy "auth delete" on public.${SI_CLOUD_TABLE} for delete to authenticated using (true);
create index if not exists ${SI_CLOUD_TABLE}_expires_idx on public.${SI_CLOUD_TABLE} (expires_at);`;
  return { ok: true, sql, editor };
});
ipcMain.handle("pegasus:analyticsStatus", () => {
  const s = loadSettings();
  return { ok: true, creds: existsSync(PEG_GOOGLE_OAUTH), connected: !!s.googleOAuth?.refresh_token, email: s.googleOAuth?.email || null };
});
ipcMain.handle("pegasus:googleConnect", async () => {
  try {
    const cr = pegOAuthCreds();
    const { code, redirect } = await pegGoogleAuthCode(cr.client_id);
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cr.client_id, client_secret: cr.client_secret, code, redirect_uri: redirect, grant_type: "authorization_code" }) });
    const j = await r.json();
    if (!j.refresh_token) throw new Error("Pas de refresh_token reçu : " + (j.error_description || j.error || "réessaie"));
    let email = null;
    try { const ui = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${j.access_token}` } })).json(); email = ui.email || null; } catch {}
    const s = loadSettings(); s.googleOAuth = { refresh_token: j.refresh_token, email }; saveSettings(s);
    _gAccess = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return { ok: true, email };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:googleDisconnect", () => {
  const s = loadSettings(); delete s.googleOAuth; saveSettings(s); _gAccess = null;
  return { ok: true };
});
ipcMain.handle("pegasus:analyticsConfigGet", async (_e, key) => {
  try { const { cfg } = await pegAnalyticsCfg(key); return { ok: true, config: cfg }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:analyticsConfigSet", async (_e, key, cfg) => {
  try { const { path } = await pegAnalyticsCfg(key); writeFileSync(path, JSON.stringify(cfg || {}, null, 2)); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Récupère l'audience du site : GA4 (visites, sources, pays, pages) + Search Console (requêtes)
ipcMain.handle("pegasus:analyticsFetch", async (_e, key, days) => {
  try {
    const { cfg } = await pegAnalyticsCfg(key);
    days = Math.max(1, Math.min(365, days || 30));
    if (!cfg.ga4Property && !cfg.scUrl) return { ok: false, error: "non-configuré" };
    const out = { ga4: !!cfg.ga4Property, sc: !!cfg.scUrl, days };
    const tok = await pegGoogleAccessToken();
    if (cfg.ga4Property) {
      const dr = [{ startDate: `${days}daysAgo`, endDate: "today" }];
      const body = { requests: [
        { dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }], dateRanges: dr, orderBys: [{ dimension: { dimensionName: "date" } }] },
        { dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], dateRanges: dr, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: "8" },
        { dimensions: [{ name: "country" }], metrics: [{ name: "sessions" }], dateRanges: dr, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: "8" },
        { dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }], dateRanges: dr, orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: "8" },
      ] };
      const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(cfg.ga4Property)}:batchRunReports`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.error) throw new Error("GA4 : " + (j.error.message || "erreur"));
      const rows = (i) => (j.reports?.[i]?.rows || []);
      out.visits = rows(0).map((x) => ({ date: x.dimensionValues[0].value, sessions: +x.metricValues[0].value, users: +x.metricValues[1].value }));
      out.sources = rows(1).map((x) => ({ label: x.dimensionValues[0].value, value: +x.metricValues[0].value }));
      out.countries = rows(2).map((x) => ({ label: x.dimensionValues[0].value, value: +x.metricValues[0].value }));
      out.pages = rows(3).map((x) => ({ label: x.dimensionValues[0].value, value: +x.metricValues[0].value }));
      out.totalSessions = out.visits.reduce((n, v) => n + v.sessions, 0);
      out.totalUsers = out.visits.reduce((n, v) => n + v.users, 0);
    }
    if (cfg.scUrl) {
      const iso = (d) => d.toISOString().slice(0, 10);
      const q = async (dims) => (await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.scUrl)}/searchAnalytics/query`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: iso(new Date(Date.now() - days * 86400000)), endDate: iso(new Date()), dimensions: dims, rowLimit: 10 }) })).json();
      const totals = await q([]);
      if (totals.error) throw new Error("Search Console : " + (totals.error.message || "erreur"));
      const t = (totals.rows && totals.rows[0]) || {};
      out.scTotals = { clicks: t.clicks || 0, impressions: t.impressions || 0, ctr: t.ctr || 0, position: t.position || 0 };
      const qr = await q(["query"]);
      out.queries = (qr.rows || []).map((x) => ({ query: x.keys[0], clicks: x.clicks, impressions: x.impressions, position: x.position }));
    }
    return { ok: true, data: out };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Export d'un rapport HTML en PDF (fenêtre hors-écran → printToPDF → boîte de sauvegarde)
ipcMain.handle("pegasus:exportPdf", async (_e, html, filename) => {
  let win;
  try {
    const tmp = join(tmpdir(), `pegasus-report-${Date.now()}.html`);
    writeFileSync(tmp, String(html || ""));
    win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false } });
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({ printBackground: true, margins: { marginType: "custom", top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
    win.destroy(); win = null;
    try { rmSync(tmp); } catch {}
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: filename || "rapport-pegasus.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (canceled || !filePath) return { ok: false, error: "Export annulé." };
    writeFileSync(filePath, pdf);
    return { ok: true, path: filePath };
  } catch (e) { if (win) try { win.destroy(); } catch {} ; return { ok: false, error: e.message }; }
});
// Contenus du site (pages réelles) — sert à générer l'arborescence
ipcMain.handle("pegasus:siteContent", async (_e, key) => {
  try { return { ok: true, content: await pegCall(key, "GET", "/content") }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Scan du site EN LIGNE : pages + liens réels entre elles → arborescence auto-connectée.
// Chaque lien interne trouvé dans une page devient une section (dot coloré) câblée vers sa cible.
const AB_PALETTE = ["#e8c268", "#8fd6a6", "#7fb2e8", "#e0868f", "#c9a2e8", "#8fd6cf"];
ipcMain.handle("pegasus:arboScan", async (_e, key, homeWp) => {
  try {
    const content = await pegCall(key, "GET", "/content");
    const items = (Array.isArray(content) ? content : []);
    if (!items.length) throw new Error("Aucune page renvoyée par le site.");
    const abs = (href, base) => { try { return new URL(href, base); } catch { return null; } };
    const norm = (u) => (u.pathname.replace(/\/+$/, "") || "/");
    const byPath = new Map();
    // Les permaliens « ?p=42 » (brouillons) ont un pathname "/" trompeur → exclus du matching
    for (const c of items) { const u = abs(c.url); if (u && !(norm(u) === "/" && u.search)) byPath.set(norm(u), c); }
    const mkId = () => "n" + Math.random().toString(36).slice(2, 8);
    const pages = items.map((c) => {
      const u = abs(c.url);
      return { id: mkId(), wp_id: c.id, titre: String(c.title || c.slug || "Sans titre"), url: c.url, home: u ? (norm(u) === "/" && !u.search) : false, sections: [] };
    });
    const idByWp = new Map(pages.map((p) => [p.wp_id, p.id]));
    let ci = 0;
    const nextColor = () => AB_PALETTE[ci++ % AB_PALETTE.length];
    const fetchHtml = async (url) => {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch(url, { headers: { "User-Agent": "Olympus-Pegasus/1.0" }, signal: ctl.signal });
        clearTimeout(t);
        return r.ok ? await r.text() : "";
      } catch { return ""; }
    };
    // Liens internes d'un fragment HTML (dédupliqués par page cible)
    const linksIn = (html, baseUrl, selfWp) => {
      const out = []; const seen = new Set();
      const base = abs(baseUrl);
      if (!html || !base) return out;
      const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html))) {
        const raw = m[1].split("#")[0];
        if (!raw) continue;
        const u = abs(raw, baseUrl);
        if (!u || u.search || u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
        const target = byPath.get(norm(u));
        if (!target || target.id === selfWp || seen.has(target.id)) continue;
        seen.add(target.id);
        let label = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!label || label.length > 42) label = String(target.title || "Lien");
        out.push({ wp: target.id, label });
      }
      return out;
    };
    // Header / Footer = artefacts à part : leurs liens sont retirés du contenu des pages
    const splitRegions = (html) => {
      let header = "", footer = "";
      const hm = html.match(/<header[^>]*>[\s\S]*?<\/header>/i);
      if (hm) { header = hm[0]; html = html.replace(hm[0], ""); }
      const nvs = html.match(/<nav[^>]*>[\s\S]*?<\/nav>/gi) || [];
      for (const nv of nvs) { header += nv; html = html.replace(nv, ""); }
      const fms = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/gi);
      if (fms && fms.length) { footer = fms[fms.length - 1]; html = html.replace(footer, ""); }
      return { header, footer, content: html };
    };
    // Sections top-level du HTML rendu (comptage de profondeur, <section> imbriquées gérées)
    const topSections = (html) => {
      const out = [];
      const re2 = /<section\b[^>]*>|<\/section>/gi;
      let depth = 0, st = -1, mm, stTag = "";
      while ((mm = re2.exec(html))) {
        if (mm[0][1] !== "/") { if (depth === 0) { st = re2.lastIndex; stTag = mm[0]; } depth++; }
        else { depth = Math.max(0, depth - 1); if (depth === 0 && st >= 0) { out.push({ tag: stTag, inner: html.slice(st, mm.index) }); st = -1; } }
      }
      return out;
    };
    const secTitle = (tag, inner, i) => {
      const h = inner.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
      let t = h ? h[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
      if (!t) { const idm = tag.match(/id=["']([^"']+)["']/); if (idm) t = idm[1].replace(/[-_]+/g, " "); }
      if (!t) { const cm = tag.match(/class=["']([^"']+)["']/); if (cm) t = cm[1].split(/\s+/)[0].replace(/[-_]+/g, " "); }
      return (t || "Section " + (i + 1)).slice(0, 40);
    };
    const headerLinks = new Map(), footerLinks = new Map();
    const subRels = new Map(); // parentWp -> Map(childWp -> label) : hiérarchie des sous-menus
    // Le menu porte la hiérarchie : un lien dans un <ul> imbriqué (sous-menu) est un
    // ENFANT de l'entrée parente → il deviendra une section de la page parente.
    const parseMenu = (headerHtml, baseUrl) => {
      const base = abs(baseUrl);
      if (!headerHtml || !base) return;
      // Conteneurs de sous-menu : <ul> imbriqué (WordPress) OU div/ul de classe
      // dropdown/sub-menu (thèmes custom). Un lien dans un tel conteneur est
      // l'ENFANT du dernier lien vu hors conteneur.
      const tok = /<(ul|div)\b[^>]*>|<\/(ul|div)>|<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const stack = []; let ulOpen = 0; let lastTop = null;
      const dropDepth = () => stack.reduce((n, f) => n + (f.drop ? 1 : 0), 0);
      let m;
      while ((m = tok.exec(headerHtml))) {
        if (m[1]) { // balise ouvrante ul/div
          // Classe EXACTE « dropdown »/« sub-menu » (pas « has-dropdown », qui est
          // le wrapper de l'item parent, pas le conteneur des enfants)
          const clsm = m[0].match(/class=["']([^"']*)["']/i);
          const isDropClass = clsm ? clsm[1].toLowerCase().split(/\s+/).some((c) => c === "dropdown" || c === "sub-menu" || c === "submenu") : false;
          const drop = m[1] === "ul" ? (isDropClass || ulOpen >= 1) : isDropClass;
          if (m[1] === "ul") ulOpen++;
          stack.push({ tag: m[1], drop });
          continue;
        }
        if (m[2]) { // balise fermante
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].tag === m[2]) { if (m[2] === "ul") ulOpen = Math.max(0, ulOpen - 1); stack.splice(i, 1); break; }
          }
          continue;
        }
        const raw = m[3].split("#")[0];
        if (!raw) continue; // ancre pure (#section)
        const u = abs(raw, baseUrl);
        if (!u || u.search || u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
        const target = byPath.get(norm(u));
        if (!target) continue;
        let label = m[4].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!label || label.length > 42) label = String(target.title || "Lien");
        if (dropDepth() >= 1 && lastTop && lastTop !== target.id) {
          if (!subRels.has(lastTop)) subRels.set(lastTop, new Map());
          if (!subRels.get(lastTop).has(target.id)) subRels.get(lastTop).set(target.id, label);
        } else if (dropDepth() === 0) {
          if (!headerLinks.has(target.id)) headerLinks.set(target.id, label);
          lastTop = target.id;
        }
      }
    };
    const scanPage = async (url, pageNode, selfWp) => {
      const html = await fetchHtml(url);
      if (!html) return;
      const { header, footer, content } = splitRegions(html);
      parseMenu(header, url);
      for (const l of linksIn(footer, url, selfWp)) if (!footerLinks.has(l.wp)) footerLinks.set(l.wp, l.label);
      if (pageNode) {
        const contentLinks = linksIn(content, url, selfWp);
        pageNode._all = contentLinks;
        const secs = topSections(content);
        if (secs.length) {
          // Les vraies sections de la page (avec ou sans destination)
          pageNode._secs = secs.slice(0, 12).map((sc, i) => {
            const links = linksIn(sc.inner, url, selfWp);
            return { titre: secTitle(sc.tag, sc.inner, i), cibleWp: links.length ? links[0].wp : null };
          });
        } else {
          // Markup sans <section> (Elementor conteneurs…) → repli sur les liens
          pageNode._links = contentLinks;
        }
      }
    };
    for (const c of items.filter((x) => x.status === "publish").slice(0, 20)) {
      await scanPage(c.url, pages.find((p) => p.wp_id === c.id), c.id);
    }
    // La vraie page d'accueil (racine, rendue par le thème) → rattachée à l'accueil désigné
    const sites2 = await pegSites();
    const homePage = (homeWp && pages.find((p) => p.wp_id === homeWp)) || pages.find((p) => p.home);
    if (homePage && !homePage.sections.length && sites2[key]) {
      homePage.home = true;
      await scanPage(sites2[key].base_url + "/", homePage, homePage.wp_id);
    }
    // Un lien présent dans le contenu de ≥ 70 % des pages scannées = navigation
    // globale (menu mobile ou autre balisage hors <header>/<nav>) → artefact Header.
    // La fréquence se compte sur TOUTES les pages scannées (_all), pas seulement
    // celles en repli liens — sinon le menu répété passe sous le seuil.
    const scanned = pages.filter((p) => p._all && p._all.length);
    if (scanned.length >= 4) {
      const freq = new Map();
      for (const p of scanned) for (const l of p._all) freq.set(l.wp, (freq.get(l.wp) || 0) + 1);
      for (const [wp, n] of freq) {
        if (n / scanned.length >= 0.7 && !footerLinks.has(wp)) {
          if (!headerLinks.has(wp)) {
            const any = scanned.flatMap((p) => p._all).find((l) => l.wp === wp);
            headerLinks.set(wp, any ? any.label : "Lien");
          }
          for (const p of scanned) { if (p._links) p._links = p._links.filter((l) => l.wp !== wp); }
        }
      }
    }
    for (const p of pages) {
      for (const sc of p._secs || []) p.sections.push({ id: mkId(), titre: sc.titre, cible: sc.cibleWp ? idByWp.get(sc.cibleWp) : "", color: nextColor() });
      for (const l of p._links || []) p.sections.push({ id: mkId(), titre: l.label, cible: idByWp.get(l.wp), color: nextColor() });
      delete p._secs; delete p._links; delete p._all;
    }
    // Hiérarchie des sous-menus : enfants attachés à leur page parente (→ niveau 3)
    for (const [parentWp, children] of subRels) {
      const parentNode = pages.find((p) => p.wp_id === parentWp);
      if (!parentNode) continue;
      for (const [childWp, label] of children) {
        const cid = idByWp.get(childWp);
        if (!cid) continue;
        const existing = parentNode.sections.find((sc) => sc.cible === cid);
        if (existing) { existing.menu = true; continue; }
        parentNode.sections.push({ id: mkId(), titre: label, cible: cid, color: nextColor(), menu: true });
      }
      headerLinks.delete && children.forEach((_, cw) => headerLinks.delete(cw));
    }
    const nodes = [...pages];
    if (headerLinks.size) nodes.push({ id: mkId(), artefact: "header", titre: "Header", sections: [...headerLinks].map(([wp, label]) => ({ id: mkId(), titre: label, cible: idByWp.get(wp), color: nextColor() })) });
    if (footerLinks.size) nodes.push({ id: mkId(), artefact: "footer", titre: "Footer", sections: [...footerLinks].map(([wp, label]) => ({ id: mkId(), titre: label, cible: idByWp.get(wp), color: nextColor() })) });
    return { ok: true, arbo: { pages: nodes } };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Arborescence du site : stockée dans le dossier du site (~/Pegasus/<site>/arborescence.json)
async function pegArboPath(key) {
  const sites = await pegSites(); const s = sites[key];
  if (!s) throw new Error("Site inconnu.");
  return join(pegProjectDir(pegSlug(s.host || key)), "arborescence.json");
}
ipcMain.handle("pegasus:arboGet", async (_e, key) => {
  try {
    const p = await pegArboPath(key);
    if (!existsSync(p)) return { ok: true, arbo: null };
    return { ok: true, arbo: JSON.parse(readFileSync(p, "utf8")) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:arboSave", async (_e, key, arbo) => {
  try {
    const p = await pegArboPath(key);
    writeFileSync(p, JSON.stringify(arbo, null, 2));
    // Version de travail MUTABLE : si le doc est rattaché à une version « en cours de
    // modification » (non déployée), on la met à jour EN PLACE. La copie de l'en-ligne
    // (deployed) reste immuable.
    if (arbo && arbo.versionId) {
      const wdir = join(await pegSiteDir(key), "wireframes");
      const man = pegVerManifest(wdir);
      if (man.deployed !== arbo.versionId && man.versions.some((v) => v.id === arbo.versionId)) {
        const vf = join(wdir, String(arbo.versionId).replace(/[^\w]/g, "") + ".json");
        if (existsSync(vf)) writeFileSync(vf, JSON.stringify(arbo, null, 2));
      }
    }
    return { ok: true, path: p };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Moodboard / charte graphique du site (couleurs, typos, logo, références) ──
async function pegSiteDir(key) {
  // « proj:<slug> » = projet local (Nouveau site, pas encore connecté à Pegasus)
  if (String(key).startsWith("proj:")) return pegProjectDir(String(key).slice(5));
  const sites = await pegSites(); const s = sites[key];
  if (!s) throw new Error("Site inconnu.");
  return pegProjectDir(pegSlug(s.host || key));
}

// ── Pipeline de travail : le fil conducteur d'un site (nouveau / refonte / micro-modifs),
// étapes guidées avec statuts (afaire | fait | passee | ia) — persisté avec le projet ──
ipcMain.handle("pegasus:pipelineGet", async (_e, key) => {
  try {
    const p = join(await pegSiteDir(key), "pipeline.json");
    if (!existsSync(p)) return { ok: true, pipeline: null };
    return { ok: true, pipeline: JSON.parse(readFileSync(p, "utf8")) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:pipelineSave", async (_e, key, pl) => {
  try {
    const p = join(await pegSiteDir(key), "pipeline.json");
    writeFileSync(p, JSON.stringify(pl, null, 2));
    return { ok: true, path: p };
  } catch (e) { return { ok: false, error: e.message }; }
});
// « Discuter avec Claude » sur une étape : session Claude Code dans le dossier du
// site, avec un prompt contextualisé (construit côté renderer). Medusa + les
// fichiers du projet (pipeline.json, moodboard.json, arborescence.json…) donnent
// à Claude tout le contexte.
ipcMain.handle("pegasus:pipelineDiscuss", async (_e, key, prompt) => {
  try {
    const dir = await pegSiteDir(key);
    await pegTerminal(`cd '${dir}' && claude ${JSON.stringify(String(prompt || "").slice(0, 4000))}`);
    return { ok: true, dir };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:moodboardGet", async (_e, key) => {
  try {
    const p = join(await pegSiteDir(key), "moodboard.json");
    if (!existsSync(p)) return { ok: true, moodboard: null };
    return { ok: true, moodboard: JSON.parse(readFileSync(p, "utf8")) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:moodboardSave", async (_e, key, mb) => {
  try {
    const p = join(await pegSiteDir(key), "moodboard.json");
    writeFileSync(p, JSON.stringify(mb, null, 2));
    return { ok: true, path: p };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Magasin de versions générique (wireframes ET moodboards) : snapshots figés
// dans <site>/<sous-dossier>/ + manifest {versions:[{id,ts,label}], deployed} ──
async function pegVerDir(key, sub) {
  const dir = join(await pegSiteDir(key), sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function pegVerManifest(dir) {
  const p = join(dir, "manifest.json");
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch {} }
  return { versions: [], deployed: null };
}
function pegVerRegister(prefix, sub, field) {
  ipcMain.handle(`pegasus:${prefix}List`, async (_e, key) => {
    try { return { ok: true, ...pegVerManifest(await pegVerDir(key, sub)) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  // Fige l'état courant comme nouvelle version. deployAsCurrent → marque « en ligne »
  // (utilisé pour la 1re version, qui reflète le site réel juste après un scan).
  ipcMain.handle(`pegasus:${prefix}Save`, async (_e, key, data, label, deployAsCurrent) => {
    try {
      const dir = await pegVerDir(key, sub);
      const man = pegVerManifest(dir);
      const id = prefix[0] + Date.now().toString(36);
      writeFileSync(join(dir, id + ".json"), JSON.stringify(data, null, 2));
      man.versions.push({ id, ts: new Date().toISOString(), label: String(label || "").slice(0, 60) });
      if (deployAsCurrent || !man.deployed) man.deployed = id;
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(man, null, 2));
      return { ok: true, id, deployed: man.deployed };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle(`pegasus:${prefix}Rename`, async (_e, key, id, label) => {
    try {
      const dir = await pegVerDir(key, sub); const man = pegVerManifest(dir);
      const v = man.versions.find((x) => x.id === id); if (!v) throw new Error("Version introuvable.");
      v.label = String(label || "").slice(0, 60);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(man, null, 2));
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle(`pegasus:${prefix}Load`, async (_e, key, id) => {
    try {
      const p = join(await pegVerDir(key, sub), String(id).replace(/[^\w]/g, "") + ".json");
      if (!existsSync(p)) throw new Error("Version introuvable.");
      return { ok: true, [field]: JSON.parse(readFileSync(p, "utf8")) };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle(`pegasus:${prefix}Delete`, async (_e, key, id) => {
    try {
      const dir = await pegVerDir(key, sub); const man = pegVerManifest(dir);
      man.versions = man.versions.filter((v) => v.id !== id);
      if (man.deployed === id) man.deployed = null;
      const f = join(dir, String(id).replace(/[^\w]/g, "") + ".json");
      if (existsSync(f)) rmSync(f);
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(man, null, 2));
      return { ok: true, deployed: man.deployed };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}
pegVerRegister("wire", "wireframes", "arbo");
pegVerRegister("mb", "moodboards", "moodboard");
pegVerRegister("prj", "pipelines", "pipeline"); // projets enregistrés (snapshots du pipeline)

// ── Scan de la charte graphique du site réel : couleurs (variables CSS du thème),
// typographies et logo, extraits du HTML rendu + feuilles de style du domaine ──
ipcMain.handle("pegasus:moodboardScan", async (_e, key) => {
  try {
    const sites = await pegSites(); const s = sites[key];
    if (!s) throw new Error("Site inconnu.");
    const base = s.base_url.replace(/\/+$/, "");
    const get = async (url) => {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch(url, { headers: { "User-Agent": "Olympus-Pegasus/1.0" }, signal: ctl.signal });
        clearTimeout(t);
        return r.ok ? await r.text() : "";
      } catch { return ""; }
    };
    const html = await get(base + "/");
    if (!html) throw new Error("Site injoignable.");
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
    // CSS : <style> inline + feuilles du même domaine (les 4 premières suffisent)
    const cssUrls = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
      .map((m) => (m[0].match(/href=["']([^"']+)["']/) || [])[1]).filter(Boolean)
      .map((u) => { try { return new URL(u, base).href; } catch { return null; } })
      .filter((u) => u && host(u) === host(base));
    let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
    for (const u of cssUrls.slice(0, 4)) css += "\n" + await get(u);
    // Couleurs : variables CSS du THÈME (hors bruit --wp*), en hex uniquement
    const couleurs = [];
    const seen = new Set();
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) {
      if (/^--wp/i.test(m[1])) continue;
      const hex = m[2].toLowerCase();
      if (seen.has(m[1]) || couleurs.length >= 8) continue;
      seen.add(m[1]);
      couleurs.push({ hex, nom: m[1].replace(/^--/, "").replace(/[-_]+/g, " ") });
    }
    // Repli : hex les plus fréquents du CSS si le thème n'expose pas de variables
    if (couleurs.length < 3) {
      const freq = new Map();
      for (const m of css.matchAll(/#[0-9a-fA-F]{6}\b/g)) { const h = m[0].toLowerCase(); freq.set(h, (freq.get(h) || 0) + 1); }
      for (const [hex] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
        if (!couleurs.some((c) => c.hex === hex)) couleurs.push({ hex, nom: "" });
      }
    }
    // Typographies : font-family réelles (ni génériques ni var()), rôle via --serif/--sans
    const roleOf = {};
    for (const m of css.matchAll(/--(serif|sans)\s*:\s*["']?([^;,"'}]+)/gi)) roleOf[m[2].trim()] = m[1] === "serif" ? "Titres" : "Texte";
    const fset = new Map();
    for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      const f = m[1].split(",")[0].replace(/["']/g, "").trim();
      if (!f || /^(inherit|initial|unset|var\(|sans-serif|serif|monospace|system-ui|-apple-system|ui-)/i.test(f)) continue;
      if (!fset.has(f)) fset.set(f, roleOf[f] || "");
    }
    for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"']*family=([^"'&]+)/gi)) {
      const f = decodeURIComponent(m[1]).split(":")[0].replace(/\+/g, " ").trim();
      if (f && !fset.has(f)) fset.set(f, "");
    }
    const typos = [...fset].slice(0, 5).map(([nom, role]) => ({ nom, role }));
    // Logo : première image « logo » du document (URL absolue)
    let logo = "";
    for (const m of html.matchAll(/<img[^>]+>/gi)) {
      if (!/logo/i.test(m[0])) continue;
      const src = (m[0].match(/src=["']([^"']+)["']/) || [])[1];
      if (src) { try { logo = new URL(src, base).href; } catch {} break; }
    }
    return { ok: true, moodboard: { couleurs, typos, logo, notes: "", refs: [] } };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Scan des SECTIONS d'une page de RÉFÉRENCE (n'importe quelle URL) → liste
// « numéro + nom » pour choisir une animation de référence dans la maquette.
ipcMain.handle("pegasus:pageSections", async (_e, url) => {
  try {
    let u = String(url || "").trim();
    if (!u) throw new Error("Lien vide.");
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    let html = "";
    try { const r = await fetch(u, { headers: { "User-Agent": "Olympus-Pegasus/1.0" }, signal: ctl.signal }); clearTimeout(t); html = r.ok ? await r.text() : ""; }
    catch { clearTimeout(t); }
    if (!html) throw new Error("Page injoignable.");
    // On retire header/nav/footer pour ne garder que le contenu
    let h = html;
    const hm = h.match(/<header[^>]*>[\s\S]*?<\/header>/i); if (hm) h = h.replace(hm[0], "");
    for (const nv of h.match(/<nav[^>]*>[\s\S]*?<\/nav>/gi) || []) h = h.replace(nv, "");
    const fms = h.match(/<footer[^>]*>[\s\S]*?<\/footer>/gi); if (fms && fms.length) h = h.replace(fms[fms.length - 1], "");
    // Sections top-level (<section>), sinon repli sur les blocs (main > div directs)
    const out = []; const re = /<section\b[^>]*>|<\/section>/gi;
    let depth = 0, start = -1, mm, startTag = "";
    while ((mm = re.exec(h))) {
      if (mm[0][1] !== "/") { if (depth === 0) { start = re.lastIndex; startTag = mm[0]; } depth++; }
      else { depth = Math.max(0, depth - 1); if (depth === 0 && start >= 0) { out.push({ tag: startTag, inner: h.slice(start, mm.index) }); start = -1; } }
    }
    const title = (tag, inner, i) => {
      const hh = inner.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
      let s = hh ? hh[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
      if (!s) { const idm = tag.match(/id=["']([^"']+)["']/); if (idm) s = idm[1].replace(/[-_]+/g, " "); }
      if (!s) { const cm = tag.match(/class=["']([^"']+)["']/); if (cm) s = cm[1].split(/\s+/)[0].replace(/[-_]+/g, " "); }
      return (s || "Section " + (i + 1)).slice(0, 60);
    };
    const sections = out.slice(0, 30).map((sc, i) => ({ n: i + 1, titre: title(sc.tag, sc.inner, i) }));
    return { ok: true, url: u, sections };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Génère le BRIEF DE CONSTRUCTION d'une version (pages + boutons + charte) et ouvre
// une session Claude Code pour la bâtir en local. Marque la version comme « à mettre
// en ligne » (deployed). Ne touche PAS au site distant (c'est « Pousser en ligne »).
const PEG_NIVEAUX = { 1: "N1 · Premium", 2: "N2 · Luxe", 3: "N3 · Luxe supérieur", 4: "N4 · Ultra luxe" };
function pegBuildBrief(arbo, mb, siteLabel, pipeline) {
  const pages = (arbo.pages || []).filter((p) => !p.artefact);
  const byId = new Map((arbo.pages || []).map((p) => [p.id, p]));
  const nameOf = (id) => { const n = byId.get(id); return n ? n.titre : "?"; };
  const lvl = (p) => Number.isFinite(p.level) ? p.level : (p.home ? 1 : null);
  let md = `# Brief de construction — ${siteLabel}\n\n`;
  md += `Généré par Pegasus depuis le wireframe validé. Construis les pages ci-dessous en local, avec la charte graphique indiquée. Chaque « section » est un bloc de la page ; une section « → Page » est un bouton/lien menant à cette page. Les lignes « > … » sont le texte/contexte voulu par le dev (la maquette) : c'est la matière, reprends-la.\n\n`;
  if (mb) {
    md += `## Charte graphique\n`;
    if (mb.niveau) md += `- **Niveau du site** : ${PEG_NIVEAUX[mb.niveau] || mb.niveau}\n`;
    if (mb.couleurs?.length) md += `- **Couleurs** : ${mb.couleurs.map((c) => `${c.nom || ""} ${c.hex}`.trim()).join(" · ")}\n`;
    if (mb.typos?.length) md += `- **Typographies** : ${mb.typos.map((t) => `${t.nom}${t.role ? ` (${t.role})` : ""}`).join(" · ")}\n`;
    if (mb.logo) md += `- **Logo** : ${mb.logo}\n`;
    if (mb.notes) md += `- **Notes** : ${mb.notes}\n`;
    if (mb.refs?.length) md += `- **Références** :\n${mb.refs.map((r) => `  - ${r.url}${r.note ? ` — ${r.note}` : ""}`).join("\n")}\n`;
    md += `\n`;
  }
  md += `## Pages (${pages.length})\n\n`;
  const artHeader = (arbo.pages || []).find((p) => p.artefact === "header");
  const artFooter = (arbo.pages || []).find((p) => p.artefact === "footer");
  if (artHeader) md += `### Header (menu global)\n${(artHeader.sections || []).map((sc) => `- ${sc.titre}${sc.cible ? ` → ${nameOf(sc.cible)}` : ""}`).join("\n") || "- (vide)"}\n\n`;
  const ord = (p) => (lvl(p) == null ? 99 : lvl(p));
  for (const p of pages.sort((a, b) => ord(a) - ord(b))) {
    md += `### ${p.titre}${p.home ? " (accueil)" : ""}${lvl(p) != null ? ` — niveau ${lvl(p)}` : ""}\n`;
    if (p.contexte) md += `> ${String(p.contexte).replace(/\n/g, "\n> ")}\n`;
    if (p.refStyle) md += `> [style de page — référence] ${p.refStyle}\n`;
    const secs = p.sections || [];
    if (secs.length) md += secs.map((sc) => {
      const anims = (sc.anims || []).length ? sc.anims.join(" · ") : sc.animation;
      const ar = sc.animRef && sc.animRef.url ? `\n  > [animation référence] ${sc.animRef.url}${sc.animRef.section ? ` — section « ${sc.animRef.section} »` : ""}` : "";
      return `- Section « ${sc.titre} »${sc.cible ? ` — bouton → ${nameOf(sc.cible)}` : ""}${sc.texte ? `\n  > ${String(sc.texte).replace(/\n/g, "\n  > ")}` : ""}${anims ? `\n  > [animations] ${String(anims).replace(/\n/g, "\n  > ")}` : ""}${ar}`;
    }).join("\n") + "\n";
    else md += `- (aucune section détaillée)\n`;
    for (const lk of p.links || []) md += `- Lien → ${nameOf(lk.to)}\n`;
    md += `\n`;
  }
  if (artFooter) md += `### Footer\n${(artFooter.sections || []).map((sc) => `- ${sc.titre}${sc.cible ? ` → ${nameOf(sc.cible)}` : ""}`).join("\n") || "- (vide)"}\n\n`;
  if (pipeline) {
    const et = pipeline.etapes || {};
    if (et.storytelling?.texte) md += `## Scène 3D / Storytelling (niveau 3-4)\n${et.storytelling.texte}\n\n`;
    if (et.assets?.liste?.length) md += `## Assets\n${et.assets.liste.map((a) => `- [${a.fourni ? "x" : " "}] ${a.nom}${a.note ? ` — ${a.note}` : ""}`).join("\n")}\n\n`;
    const ia = Object.entries(et).filter(([, v]) => v && v.statut === "ia").map(([k]) => k);
    const passees = Object.entries(et).filter(([, v]) => v && v.statut === "passee").map(([k]) => k);
    if (ia.length || passees.length) {
      md += `## Latitude laissée à l'IA\n`;
      if (ia.length) md += `- Étapes explicitement laissées à ta discrétion : ${ia.join(", ")}. Décide en suivant la doctrine orphic-web-design et le contexte du site.\n`;
      if (passees.length) md += `- Étapes passées sans être renseignées : ${passees.join(", ")}. Fais au mieux — le dev sait que le résultat peut s'éloigner de ses attentes sur ces points.\n`;
      md += `\n`;
    }
  }
  return md;
}
// « Travailler sur le site depuis ce wireframe » : ouvre la version locale (copie si
// besoin + lance le local) et une session Claude Code. mode "auto" = génère le brief
// depuis la version ciblée + moodboard et lance le prompt de construction ; mode
// "manual" = session vierge, l'humain construit. Ne touche PAS au site en ligne.
ipcMain.handle("pegasus:wireWork", async (_e, key, id, mode, moodId) => {
  try {
    const sites = await pegSites(); const s = sites[key];
    if (!s) throw new Error("Site inconnu.");
    const slug = pegSlug(s.host || key);
    const dir = join(PEG_WORKSPACE, slug);
    // 1. Copie locale du site si elle n'existe pas encore (marqueur : site.json ou wordpress/)
    let copied = false;
    if (!existsSync(join(dir, "site.json")) && !existsSync(join(dir, "wordpress"))) {
      const snap = await pegSnapshot(key);
      mkdirSync(dir, { recursive: true });
      pegWriteSnapshot(dir, snap);
      copied = true;
    }
    // 2. Lancer la version locale + ouvrir le navigateur
    const hasWP = existsSync(join(dir, "wordpress"));
    const indexFile = existsSync(join(dir, "index.html")) ? "index.html" : existsSync(join(dir, "home.html")) ? "home.html" : null;
    let launched = "vide";
    if (hasWP) { await pegTerminal(`cd '${dir}' && npx @wp-now/wp-now start --path wordpress`); launched = "wordpress"; }
    else if (indexFile) { await shell.openExternal("file://" + join(dir, indexFile)); launched = "static"; }
    // 3. Session Claude Code
    if (mode === "auto") {
      const wdir = join(dir, "wireframes");
      const vf = join(wdir, String(id).replace(/[^\w]/g, "") + ".json");
      if (!existsSync(vf)) throw new Error("Version introuvable.");
      const arbo = JSON.parse(readFileSync(vf, "utf8"));
      // Moodboard connecté au pipeline (moodId) sinon le moodboard de travail
      const mvf = moodId ? join(dir, "moodboards", String(moodId).replace(/[^\w]/g, "") + ".json") : null;
      const mbf = mvf && existsSync(mvf) ? mvf : join(dir, "moodboard.json");
      const mb = existsSync(mbf) ? JSON.parse(readFileSync(mbf, "utf8")) : null;
      const plf = join(dir, "pipeline.json");
      const pl = existsSync(plf) ? JSON.parse(readFileSync(plf, "utf8")) : null;
      const brief = pegBuildBrief(arbo, mb, s.label || s.host || key, pl);
      const bdir = join(wdir, "build-" + id);
      mkdirSync(bdir, { recursive: true });
      const briefPath = join(bdir, "BRIEF.md");
      writeFileSync(briefPath, brief);
      writeFileSync(join(bdir, "wireframe.json"), JSON.stringify(arbo, null, 2));
      const prompt = `Mets à jour ce site en local pour qu'il corresponde au wireframe décrit dans ${briefPath}. Crée ou adapte les pages, sections, boutons et connexions entre pages, en respectant la charte du moodboard indiquée dans le brief.`;
      await pegTerminal(`cd '${dir}' && claude ${JSON.stringify(prompt)}`);
      return { ok: true, mode, dir, briefPath, launched, copied };
    }
    await pegTerminal(`cd '${dir}' && claude`);
    return { ok: true, mode, dir, launched, copied };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:siteSeo", async (_e, key, limit) => {
  try { return { ok: true, seo: await pegCall(key, "GET", `/seo-audit${limit ? `?limit=${Number(limit)}` : ""}`, 60000) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Rapport de performance via PageSpeed Insights (budgets Orphic : LCP<2,5s, CLS<0,1)
ipcMain.handle("pegasus:sitePerf", async (_e, key, strategy) => {
  try {
    const sites = await pegSites();
    const s = sites[key];
    if (!s) throw new Error("Site inconnu.");
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(s.base_url)}&strategy=${strategy === "desktop" ? "desktop" : "mobile"}&category=performance`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 90000);
    let data;
    try {
      const r = await fetch(api, { signal: ctl.signal });
      if (!r.ok) throw new Error(r.status === 429 ? "Quota Google PageSpeed atteint — réessaie dans une minute." : `PageSpeed a répondu ${r.status}.`);
      data = await r.json();
    } finally { clearTimeout(t); }
    const lh = data.lighthouseResult || {};
    const au = lh.audits || {};
    const dv = (id) => au[id]?.displayValue || null;
    const nv = (id) => (typeof au[id]?.numericValue === "number" ? au[id].numericValue : null);
    return { ok: true, perf: {
      strategy: strategy === "desktop" ? "desktop" : "mobile",
      score: Math.round((lh.categories?.performance?.score ?? 0) * 100),
      lcp: dv("largest-contentful-paint"), lcp_ms: nv("largest-contentful-paint"),
      cls: dv("cumulative-layout-shift"), cls_val: nv("cumulative-layout-shift"),
      fcp: dv("first-contentful-paint"),
      tbt: dv("total-blocking-time"),
      si: dv("speed-index"),
    } };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Bibliothèque Orphic (table references_library — « méthode stable / données vivantes »)
const PEG_REF_FIELDS = ["kind", "titre", "url", "niveau", "technique", "intention", "registre", "business", "ingredients", "notes", "auteur"];
const pegRefsMissing = (e) => e.status === 404 || /references_library|42P01|PGRST205/.test(String(e.body || e.message));
ipcMain.handle("pegasus:refs", async (_e, f = {}) => {
  try {
    const p = new URLSearchParams();
    p.set("select", "*"); p.set("order", "created_at.desc"); p.set("limit", String(f.limit || 60));
    for (const k of ["kind", "niveau", "registre", "intention"]) if (f[k]) p.set(k, `eq.${f[k]}`);
    if (f.business) p.set("business", `ilike.*${f.business}*`);
    const statut = f.statut || "tous";
    if (statut !== "tous") p.set("statut", `eq.${statut}`);
    if (f.q) p.set("or", `(titre.ilike.*${f.q}*,ingredients.ilike.*${f.q}*,technique.ilike.*${f.q}*,notes.ilike.*${f.q}*,business.ilike.*${f.q}*)`);
    return { ok: true, refs: await pegSupa(`/references_library?${p.toString()}`) };
  } catch (e) { return { ok: false, error: e.message, missing_table: pegRefsMissing(e) }; }
});
ipcMain.handle("pegasus:refAdd", async (_e, row = {}) => {
  try {
    if (!row.titre || !String(row.titre).trim()) return { ok: false, error: "Le titre est obligatoire." };
    const clean = { statut: row.statut === "valide" ? "valide" : "candidat" };
    for (const k of PEG_REF_FIELDS) if (row[k] !== undefined && row[k] !== "") clean[k] = String(row[k]);
    const r = await pegSupa("/references_library", { method: "POST", body: JSON.stringify(clean), headers: { Prefer: "return=representation" } });
    return { ok: true, ref: r && r[0] };
  } catch (e) { return { ok: false, error: e.message, missing_table: pegRefsMissing(e) }; }
});
ipcMain.handle("pegasus:refSet", async (_e, id, statut) => {
  try {
    if (!id) return { ok: false, error: "id manquant." };
    const st = ["valide", "candidat", "rejete"].includes(statut) ? statut : "valide";
    const r = await pegSupa(`/references_library?id=eq.${Number(id)}`, { method: "PATCH", body: JSON.stringify({ statut: st }), headers: { Prefer: "return=representation" } });
    return { ok: true, ref: r && r[0] };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("pegasus:refDelete", async (_e, id) => {
  try {
    if (!id) return { ok: false, error: "id manquant." };
    await pegSupa(`/references_library?id=eq.${Number(id)}`, { method: "DELETE" });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Révèle le zip du plugin WordPress Pegasus dans le Finder (à installer sur le site client)
ipcMain.handle("pegasus:revealPlugin", async () => {
  const candidates = [
    join(homedir(), "Projet de développement", "Orphic-Dev", "pegasus", "pegasus", "wordpress-plugin", "pegasus.zip"),
    join(homedir(), "Projet de développement", "Pegasus", "pegasus", "wordpress-plugin", "pegasus.zip"),
    join(homedir(), "Projet de développement", "Pegasus", "wordpress-plugin", "pegasus.zip"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return { ok: false, error: "Plugin introuvable sur ce Mac (dépôt Pegasus manquant)." };
  shell.showItemInFolder(path);
  return { ok: true, path };
});

// SQL d'installation de la table (copié depuis le dépôt local si présent) + lien SQL Editor
ipcMain.handle("pegasus:refsSetup", async () => {
  const d = pegTeam();
  let editor = null;
  try { editor = `https://supabase.com/dashboard/project/${new URL(d.supabase_url).hostname.split(".")[0]}/sql/new`; } catch {}
  let sql = null;
  try { sql = readFileSync(join(homedir(), "Projet de développement", "Orphic-Dev", "pegasus", "supabase", "references-library.sql"), "utf8"); } catch {}
  return { ok: true, editor, sql };
});

// ══════════ CHRONOS — upload moodboard / références ══════════
ipcMain.handle("chronos:upload", async (_e, folder) => {
  const dlg = await dialog.showOpenDialog(win, {
    title: "Ajouter des références / moodboard",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images & documents", extensions: ["jpg", "jpeg", "png", "gif", "webp", "heic", "pdf", "mp4", "mov"] }],
  });
  if (dlg.canceled || !dlg.filePaths.length) return { ok: true, files: [] };
  const upload = (token, path, bytes) => fetch(`${AUTH_BASE}/storage/v1/object/moodboards/${path}`, {
    method: "POST", headers: { apikey: AUTH_ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "x-upsert": "true" }, body: bytes,
  });
  const out = [];
  for (const fp of dlg.filePaths) {
    const name = fp.split("/").pop();
    const path = encodeURI(`${folder || "misc"}/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    const bytes = readFileSync(fp);
    let s = loadSession();
    let up = await upload(s?.access_token, path, bytes);
    if (up.status === 401 && (await refreshToken())) up = await upload(loadSession().access_token, path, bytes);
    if (up.ok) out.push({ name, url: `${AUTH_BASE}/storage/v1/object/public/moodboards/${path}` });
  }
  return { ok: true, files: out };
});

app.whenReady().then(() => {
  if (existsSync(KEY_FILE)) pegEnsureWorkspace(); // ~/Pegasus/ dès que Pegasus est installé
  createWindow();
  medusaEnsure(); // Medusa (MCP Pegasus pour Claude) s'installe/se met à jour avec Olympus
  // Pré-chauffe hebdo Search Intelligence : rattrapage au lancement (si lundi 01:00 déjà passé et
  // pas encore fait cette semaine), minuteur précis vers le prochain lundi 01:00, + re-vérif 6 h.
  setTimeout(() => argosPrewarmMaybe("lancement"), 45000);
  scheduleWeeklyPrewarm();
  setInterval(() => argosPrewarmMaybe("re-vérif 6 h"), 6 * 3600 * 1000);
});
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
