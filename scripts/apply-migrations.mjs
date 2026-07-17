#!/usr/bin/env node
/**
 * Applique les migrations SQL de supabase/migrations/ au projet Supabase Olympus,
 * via l'API Management (token dans config/supabase-admin.json — gitignoré).
 *
 * Migrations idempotentes (create ... if not exists, drop policy if exists) → rejouables sans risque.
 *
 * Usage : node scripts/apply-migrations.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(root, "config", "supabase-admin.json"), "utf8"));
const token = cfg.access_token;
const ref = cfg.olympus_project?.ref;
if (!token || !ref) { console.error("❌ token ou ref Olympus manquant dans config/supabase-admin.json"); process.exit(1); }

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

async function run(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`${r.status} — ${(await r.text()).slice(0, 300)}`);
}

for (const f of files) {
  process.stdout.write(`→ ${f} … `);
  try { await run(readFileSync(join(dir, f), "utf8")); console.log("✅"); }
  catch (e) { console.log("❌ " + e.message); process.exit(1); }
}
console.log(`\n${files.length} migration(s) appliquée(s) sur Olympus (${ref}).`);
