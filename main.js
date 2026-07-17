"use strict";
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { homedir, tmpdir } = require("node:os");
const { execFile } = require("node:child_process");

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
  return { ok: true };
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

// ══════════ AUTHENTIFICATION + MEMBRES (Supabase Auth) ══════════
const AUTH_BASE = PEG.supabase_url.replace(/\/$/, "");
const AUTH_ANON = PEG.supabase_anon_key;

// Clé service (opérations admin) — lue depuis la clé d'équipe Pegasus locale, jamais embarquée.
function serviceKey() {
  try {
    const tk = readFileSync(join(homedir(), ".pegasus", "team-key"), "utf8").trim();
    return JSON.parse(Buffer.from(tk, "base64").toString("utf8")).supabase_service_key || null;
  } catch { return null; }
}
const svcHeaders = () => { const k = serviceKey(); return k ? { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" } : null; };

// Session persistante (jeton) — fichier local protégé.
function sessionPath() { return join(app.getPath("userData"), "olympus-session.json"); }
function loadSession() { try { return JSON.parse(readFileSync(sessionPath(), "utf8")); } catch { return null; } }
function saveSession(s) { try { writeFileSync(sessionPath(), JSON.stringify(s), { mode: 0o600 }); } catch {} }
function clearSession() { try { writeFileSync(sessionPath(), "{}", { mode: 0o600 }); } catch {} }

async function listUsers() {
  const h = svcHeaders(); if (!h) return null;
  const r = await fetch(`${AUTH_BASE}/auth/v1/admin/users?per_page=200`, { headers: h });
  if (!r.ok) return null;
  return (await r.json()).users || [];
}

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

// Bootstrap possible ? (aucun super admin encore)
ipcMain.handle("auth:needsBootstrap", async () => {
  const users = await listUsers();
  if (users === null) return { possible: false, reason: "no-key" };
  return { possible: !users.some((u) => u.user_metadata?.role === "super_admin") };
});

// Créer le premier super admin (uniquement si aucun n'existe)
ipcMain.handle("auth:bootstrap", async (_e, d) => {
  const h = svcHeaders();
  if (!h) return { ok: false, error: "Clé admin absente. Installe d'abord Pegasus (clé d'équipe)." };
  const users = await listUsers();
  if (users && users.some((u) => u.user_metadata?.role === "super_admin")) return { ok: false, error: "Un super admin existe déjà. Demande-lui de créer ton compte." };
  const { email, password, first_name, last_name } = d || {};
  if (!email || !password || !first_name || !last_name) return { ok: false, error: "Tous les champs sont requis." };
  if (String(password).length < 8) return { ok: false, error: "Mot de passe : 8 caractères minimum." };
  const r = await fetch(`${AUTH_BASE}/auth/v1/admin/users`, {
    method: "POST", headers: h,
    body: JSON.stringify({ email: String(email).trim().toLowerCase(), password, email_confirm: true, user_metadata: { first_name, last_name, role: "super_admin", must_reset_password: false } }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) return { ok: false, error: j.msg || j.error_description || "Création échouée." };
  return { ok: true };
});

// ── Membres (super admin)
ipcMain.handle("members:list", async () => {
  const users = await listUsers();
  if (users === null) return { ok: false, error: "Clé admin absente (installe Pegasus)." };
  const members = users.map((u) => ({
    id: u.id, email: u.email,
    first_name: u.user_metadata?.first_name || "", last_name: u.user_metadata?.last_name || "",
    role: u.user_metadata?.role || "classic", last_sign_in: u.last_sign_in_at || null,
  }));
  return { ok: true, members };
});

ipcMain.handle("members:create", async (_e, d) => {
  const h = svcHeaders();
  if (!h) return { ok: false, error: "Clé admin absente (installe Pegasus)." };
  const { email, password, first_name, last_name, role } = d || {};
  if (!email || !password || !first_name || !last_name) return { ok: false, error: "Tous les champs sont requis." };
  if (String(password).length < 8) return { ok: false, error: "Mot de passe temporaire : 8 caractères minimum." };
  const r = await fetch(`${AUTH_BASE}/auth/v1/admin/users`, {
    method: "POST", headers: h,
    body: JSON.stringify({ email: String(email).trim().toLowerCase(), password, email_confirm: true, user_metadata: { first_name, last_name, role: role === "super_admin" ? "super_admin" : "classic", must_reset_password: true } }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) return { ok: false, error: j.msg || j.error_description || "Création échouée (email déjà utilisé ?)." };
  return { ok: true };
});

async function getUserMeta(id) {
  const h = svcHeaders(); if (!h) return null;
  const r = await fetch(`${AUTH_BASE}/auth/v1/admin/users/${id}`, { headers: h });
  if (!r.ok) return null;
  return (await r.json()).user_metadata || {};
}

ipcMain.handle("members:delete", async (_e, id) => {
  const h = svcHeaders(); if (!h) return { ok: false, error: "Clé admin absente." };
  const r = await fetch(`${AUTH_BASE}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: h });
  if (!r.ok) return { ok: false, error: "Suppression échouée." };
  return { ok: true };
});

ipcMain.handle("members:resetPassword", async (_e, id) => {
  const h = svcHeaders(); if (!h) return { ok: false, error: "Clé admin absente." };
  const meta = await getUserMeta(id); if (!meta) return { ok: false, error: "Membre introuvable." };
  const temp = "Orphic-" + Math.random().toString(36).slice(2, 8).toUpperCase() + "!";
  const r = await fetch(`${AUTH_BASE}/auth/v1/admin/users/${id}`, {
    method: "PUT", headers: h,
    body: JSON.stringify({ password: temp, user_metadata: { ...meta, must_reset_password: true } }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return { ok: false, error: j.msg || "Échec." }; }
  return { ok: true, tempPassword: temp };
});

ipcMain.handle("members:setRole", async (_e, id, role) => {
  const h = svcHeaders(); if (!h) return { ok: false, error: "Clé admin absente." };
  const meta = await getUserMeta(id); if (!meta) return { ok: false, error: "Membre introuvable." };
  const r = await fetch(`${AUTH_BASE}/auth/v1/admin/users/${id}`, {
    method: "PUT", headers: h,
    body: JSON.stringify({ user_metadata: { ...meta, role: role === "super_admin" ? "super_admin" : "classic" } }),
  });
  if (!r.ok) return { ok: false, error: "Échec." };
  return { ok: true };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
