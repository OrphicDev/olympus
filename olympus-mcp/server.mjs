#!/usr/bin/env node
/**
 * Serveur MCP « Olympus » — donne à Claude Code le contrôle d'Olympus.
 * Sans aucune dépendance. Il réutilise la SESSION Olympus déjà connectée
 * (lit le jeton dans le fichier de session local) — aucun nouvel identifiant.
 *
 * Outils : whoami, team, chat (lire/écrire), calendrier (lire/ajouter),
 * CRM (mails envoyés), membres (lister/créer — super admin).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Config publique Olympus (clés anon = publiques)
const OLY_URL = "https://ntpudyibkwluulbbokrd.supabase.co";
const OLY_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50cHVkeWlia3dsdXVsYmJva3JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMDY4NDQsImV4cCI6MjA5OTg4Mjg0NH0.Al-COzdg5zDsPCOSAC1dZAXgm5RVToXEpSPaCJR_49M";
const ADMIN_FN = OLY_URL + "/functions/v1/admin";
const SESSION_FILE = join(homedir(), "Library", "Application Support", "Olympus", "olympus-session.json");

function loadSession() { try { return JSON.parse(readFileSync(SESSION_FILE, "utf8")); } catch { return null; } }
function saveSession(s) { try { writeFileSync(SESSION_FILE, JSON.stringify(s)); } catch {} }

async function refreshToken() {
  const s = loadSession();
  if (!s?.refresh_token) return false;
  const r = await fetch(`${OLY_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: { apikey: OLY_ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!r.ok) return false;
  const j = await r.json();
  if (!j.access_token) return false;
  s.access_token = j.access_token; if (j.refresh_token) s.refresh_token = j.refresh_token; saveSession(s);
  return true;
}
// Appel REST authentifié (jeton du membre) avec refresh sur 401.
async function api(path, opts = {}) {
  const call = () => {
    const s = loadSession();
    return fetch(`${OLY_URL}${path}`, { ...opts, headers: { apikey: OLY_ANON, Authorization: `Bearer ${s?.access_token || OLY_ANON}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
  };
  let r = await call();
  if (r.status === 401 && (await refreshToken())) r = await call();
  return r;
}
async function adminCall(action, params = {}) {
  const call = () => {
    const s = loadSession();
    return fetch(ADMIN_FN, { method: "POST", headers: { apikey: OLY_ANON, Authorization: `Bearer ${s?.access_token || OLY_ANON}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
  };
  let r = await call();
  if (r.status === 403 && (await refreshToken())) r = await call();
  return r.json().catch(() => ({ error: "réponse invalide" }));
}
function requireSession() { const s = loadSession(); if (!s?.user) throw new Error("Olympus non connecté (ouvre Olympus et connecte-toi)."); return s; }
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const TOOLS = [
  { name: "olympus_whoami", description: "Qui est connecté à Olympus (nom, email, rôle).", inputSchema: { type: "object", properties: {} } },
  { name: "olympus_team", description: "L'équipe et qui est en ligne (présence).", inputSchema: { type: "object", properties: {} } },
  { name: "hermes_recent", description: "Derniers messages du chat d'équipe Hermès.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "hermes_send", description: "Poster un message dans le chat d'équipe Hermès.", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } },
  { name: "chronos_today", description: "Les événements/tâches du jour (Chronos).", inputSchema: { type: "object", properties: {} } },
  { name: "chronos_upcoming", description: "Les prochains événements (Chronos).", inputSchema: { type: "object", properties: { days: { type: "number" } } } },
  { name: "chronos_add", description: "Ajouter un événement/tâche au calendrier Chronos.", inputSchema: { type: "object", properties: { title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" }, time: { type: "string" }, category: { type: "string", enum: ["general", "client", "interne", "deadline", "perso"] }, assignee: { type: "string" } }, required: ["title", "date"] } },
  { name: "crm_recent", description: "Derniers mails envoyés (Iris CRM) avec statut d'ouverture.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "members_list", description: "Lister les membres Olympus (super admin).", inputSchema: { type: "object", properties: {} } },
  { name: "member_create", description: "Créer un membre Olympus (super admin). Mot de passe temporaire à changer.", inputSchema: { type: "object", properties: { email: { type: "string" }, password: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" }, role: { type: "string", enum: ["classic", "super_admin"] } }, required: ["email", "password", "first_name", "last_name"] } },
];

async function callTool(name, a = {}) {
  if (name === "olympus_whoami") { const s = requireSession(); return s.user; }
  if (name === "olympus_team") {
    const r = await api(`/rest/v1/presence?select=name,last_seen&order=name.asc`);
    const users = await r.json();
    const now = Date.now();
    return users.map((u) => ({ name: u.name, online: now - new Date(u.last_seen).getTime() < 120000 }));
  }
  if (name === "hermes_recent") {
    const r = await api(`/rest/v1/messages?select=author_name,body,created_at&order=id.desc&limit=${a.limit || 20}`);
    return (await r.json()).reverse();
  }
  if (name === "hermes_send") {
    const s = requireSession();
    const author = ((s.user.first_name || "") + " " + (s.user.last_name || "")).trim() || s.user.email;
    const r = await api(`/rest/v1/messages`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: s.user.id, author_name: author, body: a.message }) });
    if (!r.ok) throw new Error("envoi impossible"); return { ok: true };
  }
  if (name === "chronos_today") { const r = await api(`/rest/v1/events?select=*&date=eq.${todayISO()}&order=time.asc.nullsfirst`); return await r.json(); }
  if (name === "chronos_upcoming") {
    const d = new Date(); const to = new Date(d.getTime() + (a.days || 14) * 864e5);
    const toISO = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, "0")}-${String(to.getDate()).padStart(2, "0")}`;
    const r = await api(`/rest/v1/events?select=*&date=gte.${todayISO()}&date=lte.${toISO}&order=date.asc,time.asc.nullsfirst`);
    return await r.json();
  }
  if (name === "chronos_add") {
    const s = requireSession();
    const r = await api(`/rest/v1/events`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ title: a.title, date: a.date, time: a.time || null, category: a.category || "general", assignee: a.assignee || null, created_by: s.user.id }) });
    if (!r.ok) throw new Error("création impossible"); return { ok: true };
  }
  if (name === "crm_recent") {
    const r = await api(`/rest/v1/emails?select=to_email,to_name,subject,sent_at,open_count,first_opened_at&order=sent_at.desc&limit=${a.limit || 20}`);
    return await r.json();
  }
  if (name === "members_list") { const r = await adminCall("list"); return r.members || r; }
  if (name === "member_create") { return await adminCall("create", a); }
  throw new Error("outil inconnu: " + name);
}

// ── Transport JSON-RPC (stdio, lignes)
const PROTO = "2024-11-05";
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: PROTO, capabilities: { tools: {} }, serverInfo: { name: "olympus", version: "0.1.0" } } });
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
  while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { try { handle(JSON.parse(line)); } catch {} } }
});
process.stdin.resume();
