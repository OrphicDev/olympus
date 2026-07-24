#!/usr/bin/env node
/*
 * Harnais de vérification (smoke-test) d'Olympus.
 * ------------------------------------------------
 * Se branche sur l'app Electron déjà lancée via son port de debug CDP,
 * recharge le renderer (pour prendre le dernier code), parcourt les vues
 * Argos clés et vérifie qu'elles s'affichent SANS erreur JS — et que la
 * loupe SEO montre bien la marque dans le classement.
 *
 * Usage :
 *   1. Lancer l'app avec le port debug :   npm run start:debug
 *   2. Dans un autre terminal :            npm run smoke
 *
 * Zéro dépendance : Node 21+ (fetch + WebSocket natifs). Sortie 0 = tout vert.
 */

const PORT = process.env.OLYMPUS_CDP_PORT || 9223;
const HOST = process.env.OLYMPUS_CDP_HOST || "localhost";

// ── petit client CDP ──────────────────────────────────────────────
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.errors = []; // {type, text}
    this.ws.addEventListener("message", (ev) => {
      const o = JSON.parse(ev.data);
      if (o.id && this.pending.has(o.id)) {
        this.pending.get(o.id)(o);
        this.pending.delete(o.id);
      } else if (o.method === "Runtime.exceptionThrown") {
        const d = o.params?.exceptionDetails;
        this.errors.push({ type: "exception", text: d?.exception?.description || d?.text || "exception" });
      } else if (o.method === "Runtime.consoleAPICalled" && o.params?.type === "error") {
        const txt = (o.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
        this.errors.push({ type: "console.error", text: txt });
      }
    });
  }
  open() { return new Promise((res, rej) => { this.ws.addEventListener("open", res); this.ws.addEventListener("error", () => rej(new Error("ws error"))); }); }
  send(method, params = {}) {
    const i = ++this.id;
    return new Promise((res) => { this.pending.set(i, res); this.ws.send(JSON.stringify({ id: i, method, params })); });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(d.exception?.description || d.text || "evaluate exception");
    }
    return r.result?.result?.value;
  }
  clearErrors() { this.errors.length = 0; }
  close() { try { this.ws.close(); } catch {} }
}

// ── découverte de la cible ────────────────────────────────────────
async function findTarget() {
  let list;
  try {
    const r = await fetch(`http://${HOST}:${PORT}/json`);
    list = await r.json();
  } catch {
    return null;
  }
  return list.find((p) => p.type === "page" && /index\.html/.test(p.url)) || list.find((p) => p.type === "page");
}

// ── snippets injectés dans le renderer ────────────────────────────
const J = (v) => JSON.stringify(v);

const bootSnippet = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  if(typeof window.olympus!=='object') return {hasOlympus:false};
  if(!arState){ const r=await window.olympus.argosState(); if(r&&r.ok) arState=r; }
  const brands=((arState&&arState.brands)||[]).filter(b=>!b.hidden);
  return { hasOlympus:true, brandCount:brands.length,
    brands:brands.map(b=>({id:b.id,name:b.name,demo:b.demo===true})) };
})()`;

const viewSnippet = (brandId, view) => `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  arBrand=${J(brandId)}; arGoView(${J(view)});
  const stage=document.getElementById('arStage'); let txt='';
  for(let i=0;i<40;i++){ await sleep(400); txt=stage?stage.textContent.trim():''; if(txt && !/^Chargement…?$/.test(txt)) break; }
  return { rendered: !!txt && !/^Chargement…?$/.test(txt), chars: stage?stage.innerHTML.length:0, snippet: txt.slice(0,90) };
})()`;

const loupeSnippet = (brandId) => `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  arBrand=${J(brandId)}; arGoView('seo');
  let rows=[];
  for(let i=0;i<45;i++){ await sleep(400); rows=[...document.querySelectorAll('#arSeoKwList .si-kwrow')]; if(rows.length) break; }
  const btn=document.querySelector('#arSeoKwList .si-serpbtn');
  if(!btn) return { ok:false, reason:'aucun mot-clé Search Console / bouton loupe', kwRows:rows.length };
  btn.click();
  // On attend spécifiquement le CLASSEMENT SERP (pas n'importe quelle modal : un template calendrier
  // caché dans le DOM porte aussi .modal-overlay/.modal-body et fausserait le sélecteur).
  let total=0, mine=null;
  for(let i=0;i<40;i++){ await sleep(400); const srows=document.querySelectorAll('.modal-overlay.show .si-serprow'); if(srows.length){ total=srows.length; mine=document.querySelector('.modal-overlay.show .si-serprow.mine'); break; } }
  const x=document.querySelector('.modal-overlay.show [data-x]'); if(x) x.click();
  if(!total) return { ok:false, reason:'classement SERP non chargé', kwRows:rows.length };
  return { ok: !!mine && total>0, kwRows:rows.length, serpRows:total, mineShown:!!mine,
    mineText: mine? mine.textContent.replace(/\\s+/g,' ').trim():null };
})()`;

// ── exécution ─────────────────────────────────────────────────────
const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };
const results = [];
function record(name, ok, detail, errs) {
  results.push({ name, ok, detail, errs });
  const mark = ok ? `${C.g}✓${C.x}` : `${C.r}✗${C.x}`;
  console.log(`  ${mark} ${name}${detail ? `  ${C.d}${detail}${C.x}` : ""}`);
  if (errs && errs.length) errs.forEach((e) => console.log(`      ${C.r}${e.type}:${C.x} ${e.text}`));
}

async function main() {
  console.log(`${C.b}Olympus — smoke-test${C.x} ${C.d}(CDP ${HOST}:${PORT})${C.x}\n`);
  const target = await findTarget();
  if (!target) {
    console.log(`${C.r}✗ Olympus injoignable sur le port debug ${PORT}.${C.x}`);
    console.log(`  Lance l'app avec :  ${C.b}npm run start:debug${C.x}\n`);
    process.exit(2);
  }
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");

  // recharger pour prendre le dernier renderer.js
  await cdp.eval("location.reload()");
  await new Promise((r) => setTimeout(r, 4000));
  await cdp.send("Runtime.enable");
  cdp.clearErrors();

  // 1) boot
  let boot;
  try {
    boot = await cdp.eval(bootSnippet);
  } catch (e) { boot = null; record("Démarrage (état Argos)", false, e.message); }
  if (boot) {
    const ok = boot.hasOlympus && boot.brandCount > 0;
    record("Démarrage (état Argos)", ok, ok ? `${boot.brandCount} marque(s)` : "aucune marque / API absente", cdp.errors.slice());
  }
  if (!boot || !boot.brandCount) { finish(); return cdp.close(); }

  // marque cible : une vraie (demo:false) de préférence, sinon la première
  const brand = boot.brands.find((b) => !b.demo) || boot.brands[0];
  console.log(`  ${C.d}marque testée : ${brand.name}${brand.demo ? " (démo)" : ""}${C.x}\n`);

  // 2) vues clés
  const views = [
    ["apercu", "Aperçu (social)"],
    ["web", "Site web (GA4)"],
    ["seo", "SEO (Search Console)"],
    ["veille_meta", "Veille Meta"],
    ["tendance", "Tendance"],
    ["notoriete", "Notoriété"],
  ];
  for (const [v, label] of views) {
    cdp.clearErrors();
    try {
      const r = await cdp.eval(viewSnippet(brand.id, v));
      record(`Vue « ${label} »`, r.rendered && cdp.errors.length === 0, r.rendered ? `${r.chars} car.` : `pas de rendu — « ${r.snippet} »`, cdp.errors.slice());
    } catch (e) {
      record(`Vue « ${label} »`, false, e.message, cdp.errors.slice());
    }
  }

  // 3) loupe SEO (le cas qui nous a coûté des allers-retours)
  cdp.clearErrors();
  try {
    const r = await cdp.eval(loupeSnippet(brand.id));
    const detail = r.ok ? `${r.serpRows} lignes · marque : ${r.mineText}` : (r.reason || "marque absente du classement");
    record("Loupe SEO — marque présente dans le classement", r.ok && cdp.errors.length === 0, detail, cdp.errors.slice());
  } catch (e) {
    record("Loupe SEO — marque présente dans le classement", false, e.message, cdp.errors.slice());
  }

  finish();
  cdp.close();
}

function finish() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n${C.b}Bilan :${C.x} ${C.g}${pass} OK${C.x}${fail ? ` · ${C.r}${fail} KO${C.x}` : ""}  (${results.length} vérifications)`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error(`${C.r}Erreur harnais :${C.x} ${e.message}`); process.exit(2); });
