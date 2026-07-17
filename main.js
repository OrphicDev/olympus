"use strict";
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { homedir, tmpdir } = require("node:os");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
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
  const r = await authedFetch(`/rest/v1/events?select=*&date=gte.${from}&date=lte.${to}&order=date.asc,time.asc.nullsfirst`);
  if (!r.ok) return { ok: false, error: "Chronos indisponible." };
  return { ok: true, events: await r.json() };
});
ipcMain.handle("chronos:create", async (_e, ev) => {
  const s = loadSession();
  const body = {
    title: ev.title, date: ev.date, time: ev.time || null,
    category: ev.category || "general", assignee: ev.assignee || null,
    notes: ev.notes || null, created_by: s?.user?.id || null,
  };
  const r = await authedFetch(`/rest/v1/events`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: "Création impossible." };
  const arr = await r.json();
  return { ok: true, event: Array.isArray(arr) ? arr[0] : arr };
});
ipcMain.handle("chronos:update", async (_e, id, patch) => {
  const r = await authedFetch(`/rest/v1/events?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  return r.ok ? { ok: true } : { ok: false, error: "Mise à jour impossible." };
});
ipcMain.handle("chronos:delete", async (_e, id) => {
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

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
