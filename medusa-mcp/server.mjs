#!/usr/bin/env node
/**
 * MEDUSA — serveur MCP qui donne à Claude Code le contrôle de Pegasus.
 * Installé et mis à jour automatiquement par Olympus (~/.olympus/medusa-mcp.mjs).
 * Sans aucune dépendance.
 *
 * Il réutilise la clé d'équipe Pegasus (~/.pegasus/team-key) : registre des
 * sites (Supabase), mots de passe déchiffrés localement (jamais exposés dans
 * les réponses), API pegasus/v1 des sites WordPress, espace de travail
 * ~/Pegasus, sauvegardes site_backups et bibliothèque references_library.
 *
 * Sécurité : pas de FTP, pas d'écriture de fichiers PHP à distance —
 * uniquement les capacités officielles de Pegasus. Le déploiement exige
 * confirm=true et prend une sauvegarde AVANT (bloquante) et APRÈS.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { privateDecrypt, constants as cryptoConstants } from "node:crypto";
import { execFile } from "node:child_process";

const KEY_FILE = join(homedir(), ".pegasus", "team-key");
const WORKSPACE = join(homedir(), "Pegasus");

/* ── Clé d'équipe + Supabase ── */
let _team;
function team() {
  if (_team !== undefined) return _team;
  try { _team = JSON.parse(Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "base64").toString("utf8")); }
  catch { _team = null; }
  return _team;
}
async function supa(path, opts = {}) {
  const t = team();
  if (!t?.supabase_url || !t?.supabase_service_key) throw new Error("Clé d'équipe Pegasus absente (~/.pegasus/team-key). Installe Pegasus via Olympus.");
  const r = await fetch(`${t.supabase_url.replace(/\/$/, "")}/rest/v1${path}`, {
    ...opts,
    headers: { apikey: t.supabase_service_key, Authorization: `Bearer ${t.supabase_service_key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`Supabase ${r.status} : ${text.slice(0, 180)}`); e.status = r.status; throw e; }
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/* ── Parc : registre + mots de passe déchiffrés (cache 30 s, jamais exposés) ── */
let _sites = { at: 0, map: {} };
async function sites() {
  if (Date.now() - _sites.at < 30000) return _sites.map;
  const t = team();
  if (!t?.private_key) throw new Error("Clé d'équipe Pegasus absente.");
  const rows = await supa("/sites?select=*&order=id.desc");
  const map = {};
  for (const row of rows) {
    const host = new URL(row.site_url).hostname.replace(/^www\./, "");
    const key = host.split(".")[0].toLowerCase();
    if (map[key]) continue;
    let pass;
    try {
      pass = privateDecrypt({ key: t.private_key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(row.app_password_enc, "base64")).toString("utf8");
    } catch { continue; }
    map[key] = { key, label: row.label || host, host, base_url: row.site_url.replace(/\/$/, ""), username: row.username, created_at: row.created_at, pass };
  }
  _sites = { at: Date.now(), map };
  return map;
}
async function site(key) {
  const s = (await sites())[key];
  if (!s) throw new Error(`Site inconnu : "${key}". Utilise medusa_sites pour la liste.`);
  return s;
}
async function pegCall(key, method, path, timeoutMs = 20000, body) {
  const s = await site(key);
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

/* ── Espace de travail ~/Pegasus ── */
const slugify = (s) => String(s || "site").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
function projectDir(slug) { mkdirSync(WORKSPACE, { recursive: true }); const d = join(WORKSPACE, slugify(slug)); mkdirSync(d, { recursive: true }); return d; }
const ditto = (args) => new Promise((res, rej) => execFile("/usr/bin/ditto", args, (err, _o, se) => err ? rej(new Error(String(se || err.message))) : res()));

/* ── Snapshot d'un site (structure + contenus + accueil rendu) ── */
async function snapshot(key) {
  const s = await site(key);
  let health = null, inspect = null, content = null, home = null;
  try { health = await pegCall(key, "GET", "/health", 12000); } catch {}
  try { inspect = await pegCall(key, "GET", "/inspect"); } catch {}
  try { content = await pegCall(key, "GET", "/content"); } catch {}
  try { const r = await fetch(s.base_url, { headers: { "User-Agent": "Medusa-MCP/1.0" } }); if (r.ok) home = await r.text(); } catch {}
  return { site: s, structure: { label: s.label, url: s.base_url, username: s.username, health, inspect }, content, home };
}
function writeSnapshot(dir, snap) {
  writeFileSync(join(dir, "site.json"), JSON.stringify({ ...snap.structure, copied: Date.now() }, null, 2));
  if (snap.content) writeFileSync(join(dir, "content.json"), JSON.stringify(snap.content, null, 2));
  if (snap.home) writeFileSync(join(dir, "home.html"), snap.home);
  writeFileSync(join(dir, "README.md"), `# ${snap.structure.label} — copie locale (via Medusa)\n\nSnapshot Pegasus (sans FTP) : site.json (structure), content.json (contenus), home.html (accueil rendu).\n`);
}
async function backupInsert(key, kind, note) {
  const snap = await snapshot(key);
  const row = { site_key: key, label: snap.structure.label, kind, structure: snap.structure, content: snap.content || null, home_html: snap.home || null, note: note || null };
  const r = await supa("/site_backups", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" } });
  return r && r[0];
}
function findTheme(dir) {
  const themesDir = join(dir, "wordpress", "wp-content", "themes");
  if (!existsSync(themesDir)) return null;
  const dirs = readdirSync(themesDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("twenty") && !e.name.startsWith(".")).map((e) => e.name);
  if (dirs.length === 1) return { name: dirs[0], path: join(themesDir, dirs[0]) };
  if (dirs.length > 1) return { multiple: dirs };
  return null;
}
const noPass = ({ pass, ...s }) => s;

/* ── Outils ── */
const T = (name, description, properties = {}, required = []) => ({ name, description, inputSchema: { type: "object", properties, required } });
const TOOLS = [
  T("medusa_sites", "Le parc Pegasus : liste les sites WordPress clients connectés (clé, label, URL). La clé sert d'identifiant pour tous les autres outils."),
  T("medusa_health", "Santé d'un site en ligne : versions WordPress/PHP/Pegasus, nom, utilisateur.", { site: { type: "string", description: "clé du site (ex 'emotions-arts')" } }, ["site"]),
  T("medusa_inspect", "Structure d'un site : thème actif, extensions (versions, actives/inactives), constructeur de page, permaliens, langue, nombre de pages/articles.", { site: { type: "string" } }, ["site"]),
  T("medusa_seo_audit", "Audit SEO du site (HTML rendu de chaque page : title, meta, H1, canonical, OG, alt…). limit optionnel (défaut 12).", { site: { type: "string" }, limit: { type: "number" } }, ["site"]),
  T("medusa_workspace", "L'espace de travail ~/Pegasus : chemin + dossiers de sites/projets présents (avec leur cadrage project.json ou site.json)."),
  T("medusa_copy_site", "Télécharge une copie locale d'un site connecté dans ~/Pegasus/<site>/. mode 'overwrite' écrase (place disque), mode 'version' range une version datée dans versions/.", { site: { type: "string" }, mode: { type: "string", description: "'overwrite' (défaut) ou 'version'" } }, ["site"]),
  T("medusa_scaffold", "Crée un nouveau projet dans ~/Pegasus/<nom>/ : type 'wordpress' télécharge et extrait WordPress dans ./wordpress/ ; type 'custom' pose un scaffolding index.html/styles.css/main.js. Métadonnées de cadrage optionnelles (secteur, niveau N1-N4, registre, intention, notes, url).", { nom: { type: "string" }, type: { type: "string", description: "'wordpress' ou 'custom'" }, secteur: { type: "string" }, niveau: { type: "string" }, registre: { type: "string" }, intention: { type: "string" }, notes: { type: "string" }, url: { type: "string" } }, ["nom", "type"]),
  T("medusa_backup", "Filet de sécurité : enregistre un point de restauration du site EN LIGNE sur Supabase (structure + contenus + accueil rendu).", { site: { type: "string" }, note: { type: "string" } }, ["site"]),
  T("medusa_backups", "Liste les points de restauration d'un site (id, type manual/pre-push/post-push, note, date).", { site: { type: "string" } }, ["site"]),
  T("medusa_restore", "Restaure une sauvegarde EN LOCAL (~/Pegasus/<site>/restaurations/) — ne touche pas au site en ligne ; prête à re-déployer.", { site: { type: "string" }, backup_id: { type: "number" } }, ["site", "backup_id"]),
  T("medusa_push", "DÉPLOIE le thème custom du WordPress local (~/Pegasus/<site>/wordpress/) vers le site EN LIGNE. Séquence : sauvegarde pre-push BLOQUANTE (échec → rien n'est déployé) → zip + installation + activation via l'installeur WordPress natif → sauvegarde post-push. Exige confirm=true — ne JAMAIS l'appeler sans demande explicite de l'utilisateur.", { site: { type: "string" }, confirm: { type: "boolean", description: "true = l'utilisateur a explicitement confirmé le déploiement en production" } }, ["site", "confirm"]),
  T("medusa_refs_search", "Bibliothèque Orphic (références de design vivantes) : recherche par kind (site|animation|matiere|secteur|autre), niveau (N1-N4), registre, business (secteur client), intention, q (texte libre). Par défaut, validées uniquement.", { q: { type: "string" }, kind: { type: "string" }, niveau: { type: "string" }, registre: { type: "string" }, business: { type: "string" }, intention: { type: "string" }, statut: { type: "string", description: "'valide' (défaut), 'candidat' ou 'tous'" }, limit: { type: "number" } }),
  T("medusa_refs_add", "Propose une référence dans la bibliothèque Orphic — toujours en statut candidat (la validation est humaine, dans Olympus). Une référence = des ingrédients à recombiner, jamais un modèle.", { titre: { type: "string" }, kind: { type: "string" }, url: { type: "string" }, niveau: { type: "string" }, technique: { type: "string" }, intention: { type: "string" }, registre: { type: "string" }, business: { type: "string" }, ingredients: { type: "string" }, notes: { type: "string" }, auteur: { type: "string" } }, ["titre"]),
];

async function callTool(name, a = {}) {
  switch (name) {
    case "medusa_sites":
      return Object.values(await sites()).map(noPass);
    case "medusa_health":
      return await pegCall(a.site, "GET", "/health", 12000);
    case "medusa_inspect":
      return await pegCall(a.site, "GET", "/inspect");
    case "medusa_seo_audit":
      return await pegCall(a.site, "GET", `/seo-audit${a.limit ? `?limit=${Number(a.limit)}` : ""}`, 60000);
    case "medusa_workspace": {
      mkdirSync(WORKSPACE, { recursive: true });
      const dirs = readdirSync(WORKSPACE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
        const d = join(WORKSPACE, e.name);
        let meta = null;
        try { meta = JSON.parse(readFileSync(join(d, "project.json"), "utf8")); } catch {}
        if (!meta) { try { const sj = JSON.parse(readFileSync(join(d, "site.json"), "utf8")); meta = { type: "copie", label: sj.label, url: sj.url }; } catch {} }
        return { dossier: e.name, chemin: d, wordpress_local: existsSync(join(d, "wordpress")), meta };
      });
      return { chemin: WORKSPACE, projets: dirs };
    }
    case "medusa_copy_site": {
      const snap = await snapshot(a.site);
      const base = projectDir(snap.site.host || a.site);
      let dir = base, version = null;
      if (a.mode === "version") {
        version = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        dir = join(base, "versions", version);
        mkdirSync(dir, { recursive: true });
      }
      writeSnapshot(dir, snap);
      return { ok: true, chemin: dir, version };
    }
    case "medusa_scaffold": {
      const slug = slugify(a.nom);
      const dir = projectDir(slug);
      writeFileSync(join(dir, "project.json"), JSON.stringify({ ...a, slug, created: Date.now() }, null, 2));
      if (a.type === "wordpress") {
        const zipPath = join(dir, "_wordpress.zip");
        const res = await fetch("https://wordpress.org/latest.zip");
        if (!res.ok) throw new Error(`Téléchargement WordPress ${res.status}`);
        writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
        await ditto(["-x", "-k", zipPath, dir]);
        try { rmSync(zipPath); } catch {}
        writeFileSync(join(dir, "README.md"), `# ${a.nom}\n\nWordPress local dans ./wordpress/ — lancer : npx @wp-now/wp-now start --path ./wordpress\n`);
        return { ok: true, chemin: dir, kind: "wordpress" };
      }
      writeFileSync(join(dir, "index.html"), `<!doctype html>\n<html lang="fr">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${a.nom}</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <main><h1>${a.nom}</h1></main>\n  <script src="main.js"></script>\n</body>\n</html>\n`);
      writeFileSync(join(dir, "styles.css"), `:root { color-scheme: dark; }\n* { margin: 0; box-sizing: border-box; }\nbody { min-height: 100vh; display: grid; place-items: center; background: #0a0a0c; color: #f2f2f4; font-family: system-ui, sans-serif; }\n`);
      writeFileSync(join(dir, "main.js"), `// ${a.nom} — Orphic\n`);
      return { ok: true, chemin: dir, kind: "custom" };
    }
    case "medusa_backup":
      return { ok: true, sauvegarde: await backupInsert(a.site, "manual", a.note) };
    case "medusa_backups": {
      const p = new URLSearchParams();
      p.set("select", "id,site_key,label,kind,note,created_at");
      p.set("site_key", `eq.${a.site}`);
      p.set("order", "created_at.desc");
      p.set("limit", "50");
      return await supa(`/site_backups?${p.toString()}`);
    }
    case "medusa_restore": {
      const rows = await supa(`/site_backups?id=eq.${Number(a.backup_id)}&select=*`);
      if (!rows?.length) throw new Error("Sauvegarde introuvable.");
      const b = rows[0];
      const s = await site(a.site);
      const stamp = new Date(b.created_at).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dir = join(projectDir(s.host), "restaurations", `${b.kind}-${stamp}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "site.json"), JSON.stringify({ ...(b.structure || {}), restored_from: b.id, backup_date: b.created_at }, null, 2));
      if (b.content) writeFileSync(join(dir, "content.json"), JSON.stringify(b.content, null, 2));
      if (b.home_html) writeFileSync(join(dir, "home.html"), b.home_html);
      return { ok: true, chemin: dir, sauvegarde: { id: b.id, kind: b.kind, date: b.created_at } };
    }
    case "medusa_push": {
      if (a.confirm !== true) throw new Error("Déploiement refusé : confirm=true requis (confirmation explicite de l'utilisateur pour pousser en PRODUCTION).");
      const s = await site(a.site);
      const dir = join(WORKSPACE, slugify(s.host));
      const theme = findTheme(dir);
      if (!theme) throw new Error("Aucun thème custom dans ~/Pegasus/" + slugify(s.host) + "/wordpress/wp-content/themes/ (Pegasus déploie un thème, pas de synchro FTP).");
      if (theme.multiple) throw new Error(`Plusieurs thèmes custom (${theme.multiple.join(", ")}) — garde-en un seul.`);
      let pre;
      try { pre = await backupInsert(a.site, "pre-push", `Avant déploiement du thème « ${theme.name} » (Medusa)`); }
      catch (e) { throw new Error("Sauvegarde de sécurité impossible — déploiement ANNULÉ, site intact : " + e.message); }
      const zipPath = join(dir, `_deploy-${theme.name}.zip`);
      try { rmSync(zipPath); } catch {}
      await ditto(["-c", "-k", "--keepParent", theme.path, zipPath]);
      const zipB64 = readFileSync(zipPath).toString("base64");
      try { rmSync(zipPath); } catch {}
      await pegCall(a.site, "POST", "/theme/install", 90000, { zip_b64: zipB64 });
      await pegCall(a.site, "POST", "/theme/activate", 30000, { stylesheet: theme.name });
      let post = null;
      try { post = await backupInsert(a.site, "post-push", `Après déploiement du thème « ${theme.name} » (Medusa)`); } catch {}
      return { ok: true, theme: theme.name, sauvegarde_avant: pre?.id, sauvegarde_apres: post?.id };
    }
    case "medusa_refs_search": {
      const p = new URLSearchParams();
      p.set("select", "*"); p.set("order", "created_at.desc"); p.set("limit", String(a.limit || 30));
      for (const k of ["kind", "niveau", "registre", "intention"]) if (a[k]) p.set(k, `eq.${a[k]}`);
      if (a.business) p.set("business", `ilike.*${a.business}*`);
      const statut = a.statut || "valide";
      if (statut !== "tous") p.set("statut", `eq.${statut}`);
      if (a.q) p.set("or", `(titre.ilike.*${a.q}*,ingredients.ilike.*${a.q}*,technique.ilike.*${a.q}*,notes.ilike.*${a.q}*)`);
      return await supa(`/references_library?${p.toString()}`);
    }
    case "medusa_refs_add": {
      if (!a.titre) throw new Error("titre obligatoire.");
      const row = { statut: "candidat" };
      for (const k of ["kind", "titre", "url", "niveau", "technique", "intention", "registre", "business", "ingredients", "notes", "auteur"]) if (a[k] !== undefined) row[k] = a[k];
      const r = await supa("/references_library", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" } });
      return { ok: true, ref: r && r[0], rappel: "Statut candidat — validation humaine dans Olympus (Bibliothèque)." };
    }
    default:
      throw new Error("outil inconnu : " + name);
  }
}

/* ── Transport JSON-RPC (stdio, lignes) ── */
const PROTO = "2024-11-05";
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: (params && params.protocolVersion) || PROTO, capabilities: { tools: {} }, serverInfo: { name: "medusa", version: "0.1.0" } } });
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    try {
      const out = await callTool(params.name, params.arguments || {});
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] } });
    } catch (e) {
      return send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "Erreur : " + e.message }] } });
    }
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } });
}
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.trim()) { try { handle(JSON.parse(line)); } catch {} }
  }
});
process.stdin.resume();
console.error("Medusa MCP prêt (contrôle de Pegasus, sans dépendance).");
