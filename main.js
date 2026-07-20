"use strict";
const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require("electron");
const { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync, rmSync, statSync } = require("node:fs");
const { join, basename } = require("node:path");
const { homedir, tmpdir } = require("node:os");
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
ipcMain.handle("env:check", async () => {
  const node = await sh("node -v");
  const claude = await sh("command -v claude || (test -d ~/.claude && echo ok)");
  const wpNow = await sh("command -v wp-now");
  return {
    node: { ok: !!node, detail: node || "non détecté" },
    claude: { ok: !!claude, detail: claude ? "installé" : "non détecté" },
    wp: { ok: !!wpNow, detail: wpNow ? "wp-now installé" : "non installé (optionnel)" },
  };
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

// Réglages persistants d'Olympus (emplacement du workspace, etc.)
function settingsPath() { return join(app.getPath("userData"), "olympus-settings.json"); }
function loadSettings() { try { return JSON.parse(readFileSync(settingsPath(), "utf8")); } catch { return {}; } }
function saveSettings(s) { try { writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch {} }

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
  if (r.status === 403 && useAuth && (await refreshToken())) r = await send();
  return r.json().catch(() => ({ error: "Réponse invalide." }));
}

// Session persistante (jeton) — fichier local protégé.
function sessionPath() { return join(app.getPath("userData"), "olympus-session.json"); }
function loadSession() { try { return JSON.parse(readFileSync(sessionPath(), "utf8")); } catch { return null; } }
function saveSession(s) { try { writeFileSync(sessionPath(), JSON.stringify(s), { mode: 0o600 }); } catch {} }
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
  const r = await authedFetch(`/rest/v1/events?select=*&date=lte.${to}&or=(date.gte.${from},end_date.gte.${from})&order=date.asc,time.asc.nullsfirst`);
  const internal = r.ok ? await r.json() : [];
  let apple = [];
  try { if (loadSettings().appleEmail) apple = await getAppleEvents(from, to); } catch {}
  if (!r.ok && !apple.length) return { ok: false, error: "Chronos indisponible." };
  return { ok: true, events: [...internal, ...apple] };
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
  for (const cal of cals) {
    let objs;
    try { objs = await client.fetchCalendarObjects({ calendar: { url: cal.url }, timeRange: { start: start.toISOString(), end: end.toISOString() } }); }
    catch { continue; }
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
            end_date: allDay ? isoLocalD(new Date(ed.getTime() - 86400000)) : isoLocalD(ed),
            time: allDay ? null : hmD(sd),
            end: allDay ? null : hmD(ed),
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
          for (const d of dates.slice(0, 80)) push(d, new Date(d.getTime() + durMs));
        } else {
          push(ev.start, ev.end || ev.start);
        }
      }
    }
  }
  return out;
}
let appleEvCache = { events: [], from: null, to: null, at: 0 };
function appleInvalidateCache() { appleEvCache = { events: [], from: null, to: null, at: 0 }; }
async function getAppleEvents(fromISO, toISO) {
  const now = Date.now();
  const covered = appleEvCache.from && appleEvCache.from <= fromISO && appleEvCache.to >= toISO && (now - appleEvCache.at) < 180000;
  if (!covered) {
    const wFrom = shiftISO(fromISO, -31), wTo = shiftISO(toISO, 62);
    try { appleEvCache = { events: await fetchAppleRange(wFrom, wTo), from: wFrom, to: wTo, at: now }; }
    catch { return []; }
  }
  return appleEvCache.events.filter((e) => e.date <= toISO && (e.end_date || e.date) >= fromISO);
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
async function waConnect() {
  if (waSock) return;
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
});
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
