"use strict";
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { homedir, tmpdir } = require("node:os");
const { execFile } = require("node:child_process");
const { randomUUID, privateDecrypt, constants: cryptoConstants } = require("node:crypto");
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
ipcMain.handle("pegasus:workOn", async (_e, key) => {
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
    // 3. Ouvrir une session Claude Code dans le dossier du projet
    await pegTerminal(`cd '${dir}' && claude`);
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
  if (!r.ok) return { ok: false, error: "Chronos indisponible." };
  return { ok: true, events: await r.json() };
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
      if (!r.ok) throw new Error(`PageSpeed ${r.status}`);
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
