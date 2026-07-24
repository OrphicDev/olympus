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
let atVideoInit = false;
function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); localStorage.setItem("olympusTheme", t); if (appShader) appShader.setTheme(t); if (atVideoInit) atVideoSetTheme(t); }
// ══════════ Shader d'ambiance global (WebGL) — fond vivant, discret, visible à travers le verre ══════════
const AT_SHADER_PAL = {
  dark:  { c1: [0.035, 0.035, 0.046], c2: [0.105, 0.100, 0.125], acc: [0.56, 0.40, 1.0], acc2: [0.24, 0.52, 0.98], int: 0.30 },
  light: { c1: [0.945, 0.920, 0.878], c2: [0.989, 0.981, 0.968], acc: [0.95, 0.83, 0.58], acc2: [0.97, 0.86, 0.78], int: 0.52 },
};
let appShader = null;
function initAppShader() {
  const cv = document.getElementById("glShader"); if (!cv) return null;
  let gl; try { gl = cv.getContext("webgl", { antialias: false, depth: false, alpha: false, powerPreference: "low-power" }) || cv.getContext("experimental-webgl"); } catch { gl = null; }
  if (!gl) { cv.style.display = "none"; return null; }
  const fs = `precision highp float;
uniform vec2 uRes;uniform float uTime;uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uAcc;uniform vec3 uAcc2;uniform float uInt;
float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));vec2 u=f*f*(3.0-2.0*f);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*noise(p);p*=2.0;a*=0.5;}return v;}
void main(){vec2 uv=gl_FragCoord.xy/uRes.xy;vec2 p=uv*vec2(uRes.x/uRes.y,1.0);float t=uTime*0.03;
vec2 q=vec2(fbm(p*0.9+t*0.6),fbm(p*0.9+vec2(3.1)-t*0.5));
vec2 r=vec2(fbm(p*1.2+q*1.7+t*0.4),fbm(p*1.2+q*1.7+vec2(1.7)-t*0.35));
float n=fbm(p*1.3+r*1.2);
vec3 base=mix(uC2,uC1,smoothstep(-0.1,1.1,uv.y+(n-0.5)*0.35));
float g1=smoothstep(0.42,0.96,fbm(p*1.05+r*1.3+t*0.5));
float g2=smoothstep(0.5,1.0,fbm(p*1.15+q*1.5-t*0.4+vec2(5.0)));
vec3 col=base;
col=mix(col,uAcc,g1*uInt);
col=mix(col,uAcc2,g2*uInt*0.85);
float vig=smoothstep(1.35,0.12,length(uv-0.5));col*=mix(0.86,1.0,vig);
gl_FragColor=vec4(col,1.0);}`;
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = mk(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}"), fss = mk(gl.FRAGMENT_SHADER, fs);
  if (!vs || !fss) { cv.style.display = "none"; return null; }
  const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fss); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.style.display = "none"; return null; }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uRes = U("uRes"), uTime = U("uTime"), uC1 = U("uC1"), uC2 = U("uC2"), uAcc = U("uAcc"), uAcc2 = U("uAcc2"), uInt = U("uInt");
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function resize() { const dpr = Math.min(1.0, window.devicePixelRatio || 1); const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } gl.viewport(0, 0, cv.width, cv.height); gl.uniform2f(uRes, cv.width, cv.height); if (reduce) draw(12000); }
  function setTheme(t) { const p = AT_SHADER_PAL[t] || AT_SHADER_PAL.dark; gl.uniform3fv(uC1, p.c1); gl.uniform3fv(uC2, p.c2); gl.uniform3fv(uAcc, p.acc); gl.uniform3fv(uAcc2, p.acc2); gl.uniform1f(uInt, p.int); if (reduce) draw(12000); }
  function draw(ms) { gl.uniform1f(uTime, ms * 0.001); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  window.addEventListener("resize", resize); resize();
  setTheme(document.documentElement.getAttribute("data-theme") || "dark");
  // Rendu plafonné à ~30 fps : le fond dérive lentement, pas besoin de 60 fps — et ça divise par 2 le coût GPU + la recomposition des panneaux en verre.
  if (!reduce) { let lastDraw = -1e9; const loop = (ms) => { if (ms - lastDraw >= 33) { draw(ms); lastDraw = ms; } requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
  return { setTheme };
}
appShader = initAppShader();
applyTheme(localStorage.getItem("olympusTheme") || "dark");
$("themeToggle").onclick = () => applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
// Joue/met en pause la vidéo d'ambiance selon qu'on est sur Athéna (économie CPU/batterie ailleurs).
function atVideoToggle(on) {
  const v = document.getElementById("atVideo"); if (!v || !v.src) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (on && !reduce) v.play().catch(() => {}); else v.pause();
}
// Vidéo d'ambiance d'Athéna : une vidéo par thème (sombre / clair), chargée en blob (file:// bloqué
// pour les <video> par Chromium). Blobs mis en cache → le changement de thème est instantané.
const AT_VIDEO_FOR = { dark: "athena-bg.m4v", light: "athena-bg.m4v" }; // light = même vidéo, couleurs inversées via CSS
const atVideoBlobs = {};
async function atVideoLoad(file) {
  if (atVideoBlobs[file]) return atVideoBlobs[file];
  const r = await window.olympus.mediaRead(file).catch(() => null);
  if (!r || !r.ok || !r.data) return null;
  return (atVideoBlobs[file] = URL.createObjectURL(new Blob([r.data], { type: "video/mp4" })));
}
async function atVideoSetTheme(theme) {
  const v = document.getElementById("atVideo"); if (!v) return;
  const file = AT_VIDEO_FOR[theme] || AT_VIDEO_FOR.dark;
  if (v.dataset.file === file) return;                       // déjà la bonne vidéo
  const url = await atVideoLoad(file); if (!url) return;
  if (v.dataset.file) v.classList.remove("ready");           // fondu de sortie avant de changer de source
  v.dataset.file = file; v.src = url; v.load();
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  v.addEventListener("loadeddata", () => v.classList.add("ready"), { once: true });
  const onHome = $("page-home") && $("page-home").classList.contains("show");
  if (reduce) v.pause(); else if (onHome) v.play().catch(() => v.classList.add("ready"));
}
atVideoInit = true;
atVideoSetTheme(document.documentElement.getAttribute("data-theme") || "dark");
// Orbe d'Athéna FORMÉE de particules : points fins répartis sur une sphère (spirale de Fibonacci),
// en rotation lente ; la profondeur module taille + opacité. Repoussés au survol de la souris, ressort de retour.
// Petit canvas 200px, dessiné UNIQUEMENT quand l'accueil est visible → coût contenu.
(function initOrbFx() {
  const canvas = document.getElementById("atOrbFx"); if (!canvas) return;
  const wrap = canvas.parentElement, root = document.documentElement, ctx = canvas.getContext("2d"); if (!ctx) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0, seeded = false;
  function resize() { W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); seeded = false; }
  const R = 34, GA = Math.PI * (3 - Math.sqrt(5));
  // Sphère : points fins et denses répartis en spirale de Fibonacci.
  const NS = reduce ? 340 : 880;
  const pts = Array.from({ length: NS }, (_, i) => { const sy = 1 - (i / (NS - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - sy * sy)), th = GA * i; return { sx: Math.cos(th) * r, sy, sz: Math.sin(th) * r, x: 0, y: 0, vx: 0, vy: 0 }; });
  // Nuage chaotique autour : particules très fines, mouvement turbulent (champ de flux + jitter).
  const NC = reduce ? 500 : 2800;
  const cld = Array.from({ length: NC }, () => ({ x: 0, y: 0, vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5, size: .3 + Math.random() * .6, tw: Math.random() * 6.2832, pr: 44 + Math.random() * 52, spin: (0.015 + Math.random() * 0.05) * (Math.random() < .5 ? 1 : -1) }));
  const mouse = { x: 0, y: 0, on: false };
  wrap.addEventListener("mousemove", (e) => { const b = canvas.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; mouse.on = true; });
  wrap.addEventListener("mouseleave", () => { mouse.on = false; });
  const visible = () => { const ph = document.getElementById("page-home"); return ph && ph.classList.contains("show") && !document.getElementById("atWrap").classList.contains("chatting") && !document.hidden; };
  const tilt = 0.42, cX = Math.cos(tilt), sX = Math.sin(tilt);
  const bolts = [];   // éclairs actifs (tempête)
  let ang = 0, tick = 0;
  function frame() {
    requestAnimationFrame(frame);
    if (!visible() || !canvas.clientWidth) return;
    if (canvas.width !== Math.round(canvas.clientWidth * dpr)) resize();
    if (!reduce) { ang += 0.0045; tick++; }
    const CX = W / 2, CY = H / 2 + (reduce ? 0 : Math.sin(ang * 1.7) * 3), cY = Math.cos(ang), sY = Math.sin(ang), T = tick * 0.03;
    ctx.clearRect(0, 0, W, H);
    const light = root.getAttribute("data-theme") === "light";
    const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, R * 1.8); // halo doux
    g.addColorStop(0, light ? "rgba(150,112,42,.1)" : "rgba(220,225,245,.12)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, CY, R * 1.8, 0, 6.2832); ctx.fill();
    // Couleur commune → on module l'opacité par globalAlpha (pas d'allocation de chaîne rgba par particule).
    // Light = doré (raccord shader crème & or) ; Dark = blanc glacé.
    const common = light ? "rgb(158,116,42)" : "rgb(233,236,248)", flashCol = light ? "rgb(230,184,80)" : "rgb(206,224,255)";
    ctx.fillStyle = common;
    const lm = light ? 0.8 : 1;
    // Sphère dense (points fins)
    for (const p of pts) {
      const x = p.sx * cY + p.sz * sY, z = -p.sx * sY + p.sz * cY;
      const y2 = p.sy * cX - z * sX, z2 = p.sy * sX + z * cX;   // profondeur
      const hx = CX + x * R, hy = CY + y2 * R;
      if (!seeded) { p.x = hx; p.y = hy; }
      p.vx += (hx - p.x) * 0.06; p.vy += (hy - p.y) * 0.06;
      if (!reduce && mouse.on) { const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy, RR = 50; if (d2 < RR * RR) { const d = Math.sqrt(d2) || 1, f = (1 - d / RR) * 3.0; p.vx += (dx / d) * f; p.vy += (dy / d) * f; } }
      p.vx *= 0.8; p.vy *= 0.8; p.x += p.vx; p.y += p.vy;
      const depth = (z2 + 1) / 2, fla = p.flash || 0;
      ctx.globalAlpha = lm * (0.1 + depth * 0.62);
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.26 + depth * 0.7, 0, 6.2832); ctx.fill();
      if (fla > 0.03) {                                                 // extrémité d'éclair sur la sphère → léger flash discret
        ctx.fillStyle = flashCol;
        ctx.globalAlpha = fla * 0.26; ctx.beginPath(); ctx.arc(p.x, p.y, 1 + fla * 2, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = Math.min(0.8, fla * 0.75); ctx.beginPath(); ctx.arc(p.x, p.y, 0.5 + fla * 1, 0, 6.2832); ctx.fill();
        ctx.fillStyle = common;
      }
      p.flash = fla * 0.9;
    }
    // Nuage chaotique
    for (const p of cld) {
      if (!seeded) { const a = Math.random() * 6.2832; p.x = CX + Math.cos(a) * p.pr; p.y = CY + Math.sin(a) * p.pr; }
      const dx0 = p.x - CX, dy0 = p.y - CY, dist = Math.hypot(dx0, dy0) || 1;
      if (!reduce) {
        const tx = -dy0 / dist, ty = dx0 / dist;             // tangente → chaque particule orbite (répartition tout autour)
        p.vx += tx * p.spin; p.vy += ty * p.spin;
        const rerr = dist - p.pr;                            // rappel vers son rayon préféré → halo autour de la sphère
        p.vx -= (dx0 / dist) * rerr * 0.03; p.vy -= (dy0 / dist) * rerr * 0.03;
        p.vx += (Math.random() - .5) * 0.2; p.vy += (Math.random() - .5) * 0.2;   // turbulence chaotique
        if (mouse.on) { const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy, RR = 56; if (d2 < RR * RR) { const d = Math.sqrt(d2) || 1, f = (1 - d / RR) * 2.6; p.vx += (dx / d) * f; p.vy += (dy / d) * f; } }
        p.vx *= 0.9; p.vy *= 0.9; p.x += p.vx; p.y += p.vy; p.tw += 0.05;
      }
      const fade = Math.max(0.15, Math.min(1, 1 - (dist - 48) / 92)), fla = p.flash || 0;
      // 1 seule passe (perf à haute densité) : le glow naît du recouvrement des particules.
      ctx.globalAlpha = lm * (0.2 + 0.2 * (Math.sin(p.tw) * 0.5 + 0.5)) * fade;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.7, 0, 6.2832); ctx.fill();
      if (fla > 0.03) {                                                 // touchée par un éclair → léger surcroît de brillance (discret)
        ctx.fillStyle = flashCol;
        ctx.globalAlpha = fla * 0.3; ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 + fla * 3, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = Math.min(0.85, fla * 0.8); ctx.beginPath(); ctx.arc(p.x, p.y, p.size + fla * 1.3, 0, 6.2832); ctx.fill();
        ctx.fillStyle = common;
      }
      p.flash = fla * 0.9;
    }
    // Éclairs / tempête : trait jagged reliant une particule de la sphère à une du nuage, flash bref + glow.
    let mainN = 0; for (const bb of bolts) if ((bb.mag || 1) >= 1) mainN++;   // ne compter que les éclairs principaux
    if (!reduce && mainN < 3 && Math.random() < 0.14 && pts.length && cld.length) {
      const b = cld[(Math.random() * cld.length) | 0];
      // particule de la sphère la PLUS PROCHE du point du nuage → l'éclair part du bord face au nuage, sans traverser la sphère
      let a = pts[0], best = Infinity;
      for (const q of pts) { const dx = q.x - b.x, dy = q.y - b.y, d2 = dx * dx + dy * dy; if (d2 < best) { best = d2; a = q; } }
      const ns = 3 + (Math.random() * 3 | 0), segs = [];
      for (let k = 1; k <= ns; k++) segs.push({ t: k / (ns + 1), off: (Math.random() - .5) * 0.16 });  // offset en fraction de la longueur (jaggedness tangentielle → reste hors de la sphère)
      bolts.push({ a, b, segs, life: 1, mag: 1 });
      // Ramifications : la particule touchée arque vers 5-10 voisines proches du nuage (petits éclairs, moins lumineux).
      const nb = [];
      for (const q of cld) { if (q === b) continue; const dx = q.x - b.x, dy = q.y - b.y; if (dx * dx + dy * dy < 42 * 42) nb.push(q); }
      const k2 = 5 + (Math.random() * 6 | 0);
      for (let j = 0; j < k2 && nb.length; j++) {
        const q = nb.splice((Math.random() * nb.length) | 0, 1)[0];
        const ns2 = 2 + (Math.random() * 2 | 0), sg = [];
        for (let m = 1; m <= ns2; m++) sg.push({ t: m / (ns2 + 1), off: (Math.random() - .5) * 0.24 });
        bolts.push({ a: b, b: q, segs: sg, life: 0.7, mag: 0.5 });
      }
    }
    if (bolts.length) {
      ctx.globalAlpha = 1; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const col = light ? "202,152,48" : "162,192,255";               // éclair : doré en light, bleu glacé en dark
      for (let i = bolts.length - 1; i >= 0; i--) {
        const bo = bolts[i]; bo.life -= 0.025;
        if (bo.life <= 0) { bolts.splice(i, 1); continue; }
        const mg = bo.mag || 1;                                       // magnitude : 1 = éclair principal, <1 = ramification
        bo.a.flash = Math.max(bo.a.flash || 0, bo.life * mg); bo.b.flash = Math.max(bo.b.flash || 0, bo.life * mg);   // extrémités s'illuminent (secondaires un peu moins)
        const ax = bo.a.x, ay = bo.a.y, bx = bo.b.x, by = bo.b.y, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        const fl = bo.life * mg * (0.55 + Math.random() * 0.45);      // flicker (ramifications plus faibles)
        ctx.beginPath(); ctx.moveTo(ax, ay);
        for (const s of bo.segs) ctx.lineTo(ax + dx * s.t + nx * s.off * len, ay + dy * s.t + ny * s.off * len);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = "rgba(" + col + "," + (fl * 0.24).toFixed(3) + ")"; ctx.lineWidth = 2.6 * mg; ctx.stroke();  // glow (large + faible)
        ctx.strokeStyle = "rgba(" + col + "," + fl.toFixed(3) + ")"; ctx.lineWidth = Math.max(0.5, 0.8 * mg); ctx.stroke();  // cœur fin et vif
      }
    }
    ctx.globalAlpha = 1;
    seeded = true;
  }
  resize(); requestAnimationFrame(frame);
})();

// ══════════ NAVIGATION ══════════
document.querySelectorAll(".nav-item").forEach((it) => {
  it.onclick = () => {
    if (it.classList.contains("locked")) return;
    document.querySelectorAll(".nav-item").forEach((x) => x.classList.remove("active"));
    it.classList.add("active");
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("show"));
    const pg = $("page-" + it.dataset.page);
    pg.classList.add("show");
    if (typeof atVideoToggle === "function") atVideoToggle(it.dataset.page === "home"); // vidéo d'ambiance : jouée sur Athéna, en pause ailleurs
    mArrive(pg);
    setTimeout(() => mCountUp(pg, ".ir-kpi .n, .ag-kpi .n, .ir-stat .n"), 80); // les KPIs se comptent à l'arrivée
    $("hub").classList.toggle("with-rail", it.dataset.page === "chronos"); // roue + agenda : Chronos uniquement
    if (it.dataset.page === "settings") setNavRender();
  };
});
// ── Réglages : colonne de tri (par type / app) ──
const SET_GROUPS = [
  { id: "account", ic: "◎", label: "Compte & équipe" },
  { id: "argos", ic: "📣", label: "Argos" },
  { id: "claude", ic: "✦", label: "Claude Code" },
  { id: "medusa", ic: "🪼", label: "Medusa" },
];
let setGroup = "account";
function setApplyGroup() {
  document.querySelectorAll("#setMain [data-setgroup]").forEach((s) => {
    let show = s.dataset.setgroup === setGroup;
    if (s.id === "membersSection" && currentRole !== "super_admin") show = false; // section réservée super admin
    s.style.display = show ? "" : "none";
  });
}
function setNavRender() {
  const nav = $("setNav"); if (!nav) return;
  nav.innerHTML = SET_GROUPS.map((g) => `<div class="ir-folder${setGroup === g.id ? " active" : ""}" data-setgroup="${g.id}"><span class="fic">${g.ic}</span><span class="lname">${escapeHtml(g.label)}</span></div>`).join("");
  nav.querySelectorAll("[data-setgroup]").forEach((el) => el.onclick = () => { setGroup = el.dataset.setgroup; setNavRender(); });
  setApplyGroup();
}
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
const pgHealth = {}, pgInspect = {}, pgSeo = {}, pgPerf = {}, pgDiag = {};
let pgSiteTab = "general"; // onglet du détail site : general | seo | perf | secu | rapport
let pgSecAction = null; // panneau des 3 gros boutons : copy | push | rollback | null

// ══ Graphiques SVG maison (aucune dépendance, CSP-safe ; couleur passée en argument
// pour marcher à la fois dans l'app (var(--…)) et dans le PDF (hex)) ══
function pgGauge(value, max, color, label) {
  const pct = Math.max(0, Math.min(1, (value || 0) / (max || 1)));
  const circ = Math.PI * 52; // demi-cercle r=52
  return `<svg viewBox="0 0 120 72" class="pg-gauge" preserveAspectRatio="xMidYMid meet">
    <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke="var(--line,#e6e6e6)" stroke-width="9" stroke-linecap="round"/>
    <path d="M8 62 A52 52 0 0 1 112 62" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(circ * pct).toFixed(1)} ${circ.toFixed(1)}"/>
    <text x="60" y="56" text-anchor="middle" style="fill:${color};font-size:26px;font-weight:700;">${label != null ? label : value}</text>
  </svg>`;
}
function pgSparkline(vals, color, w, h) {
  vals = (vals || []).filter((v) => v != null && !isNaN(v));
  w = w || 260; h = h || 54; const pad = 4;
  if (vals.length < 2) return `<div class="pg-nospark">Historique insuffisant — reviens après quelques analyses pour voir la tendance.</div>`;
  const min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1;
  const X = (i) => pad + (i / (vals.length - 1)) * (w - 2 * pad);
  const Y = (v) => h - pad - ((v - min) / rng) * (h - 2 * pad);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${X(vals.length - 1).toFixed(1)} ${(h - pad).toFixed(1)} L${X(0).toFixed(1)} ${(h - pad).toFixed(1)} Z`;
  const last = vals[vals.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" class="pg-spark" preserveAspectRatio="none">
    <path d="${area}" fill="${color}" opacity=".13"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(vals.length - 1).toFixed(1)}" cy="${Y(last).toFixed(1)}" r="2.6" fill="${color}"/>
  </svg>`;
}
function pgBars(series) {
  const max = Math.max(1, ...series.map((s) => s.value || 0));
  return `<div class="pg-bars">${series.map((s) => `
    <div class="pg-bar-row"><span class="pg-bar-l">${escapeHtml(s.label)}</span>
      <span class="pg-bar-track"><span class="pg-bar-fill" style="width:${((s.value || 0) / max * 100).toFixed(0)}%;background:${s.color || "var(--accent2)"}"></span></span>
      <span class="pg-bar-v">${s.value}</span></div>`).join("")}</div>`;
}
// ══ Kit « console analytics » (esprit Google Analytics, adapté au thème Olympus) ══
// Puce d'évolution vs période précédente : ▲/▼ %.
function pgDelta(cur, prev, goodDown) {
  cur = +cur || 0;
  if (prev == null || isNaN(prev)) return "";
  prev = +prev || 0;
  if (prev === 0) return cur > 0 ? `<span class="ga-delta up">● nouveau</span>` : "";
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return `<span class="ga-delta flat">— stable</span>`;
  const up = pct > 0, good = goodDown ? !up : up;
  return `<span class="ga-delta ${good ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)} %</span>`;
}
// Carte-score : libellé, grand chiffre, évolution.
function pgScore(label, value, delta, sub) {
  return `<div class="ga-card">
    <div class="ga-card-l">${escapeHtml(label)}</div>
    <div class="ga-card-v">${value}</div>
    <div class="ga-card-f">${delta || ""}${sub ? `<span class="ga-card-sub">${escapeHtml(sub)}</span>` : ""}</div>
  </div>`;
}
// Grande courbe en aire avec grille + repères d'axes (échelle uniforme, nette).
function pgAreaChart(points, opts = {}) {
  const vals = (points || []).map((p) => +p.value || 0);
  const color = opts.color || "var(--accent2)";
  const gid = "gaGrad" + (opts.gid || Math.round((vals[0] || 0) + vals.length * 7));
  if (vals.length < 2) return `<div class="ga-chart-empty">${vals.length ? `<b>${pgFmtN(vals[0])}</b> — une seule journée mesurée pour l'instant` : "Pas encore assez de données pour tracer une courbe : elle apparaît dès que le trafic s'étale sur plusieurs jours."}</div>`;
  const w = 1000, h = 210, padX = 40, padT = 14, padB = 26;
  const max = Math.max(1, ...vals);
  const X = (i) => padX + (i / (vals.length - 1)) * (w - padX - 10);
  const Y = (v) => padT + (1 - v / max) * (h - padT - padB);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${X(vals.length - 1).toFixed(1)} ${(h - padB).toFixed(1)} L${X(0).toFixed(1)} ${(h - padB).toFixed(1)} Z`;
  const grid = [0, 0.5, 1].map((f) => { const y = padT + f * (h - padT - padB); const v = Math.round(max * (1 - f)); return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${w - 10}" y2="${y.toFixed(1)}" class="ga-grid"/><text x="${padX - 6}" y="${(y + 3).toFixed(1)}" class="ga-axis" text-anchor="end">${pgFmtN(v)}</text>`; }).join("");
  const last = vals.length - 1;
  const first = points[0]?.label || "", lastL = points[last]?.label || "";
  return `<svg viewBox="0 0 ${w} ${h}" class="ga-chart" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".26"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(last).toFixed(1)}" cy="${Y(vals[last]).toFixed(1)}" r="3.4" fill="${color}"/>
    <text x="${padX}" y="${h - 6}" class="ga-axis">${escapeHtml(first)}</text>
    <text x="${w - 10}" y="${h - 6}" class="ga-axis" text-anchor="end">${escapeHtml(lastL)}</text>
  </svg>`;
}
// Tableau de répartition : libellé · barre de proportion · valeur + %.
function pgBreak(rows, opts = {}) {
  rows = rows || [];
  const total = opts.total || rows.reduce((n, r) => n + (+r.value || 0), 0) || 1;
  const max = Math.max(1, ...rows.map((r) => +r.value || 0));
  const color = opts.color || "var(--accent2)";
  return `<div class="ga-tbl">${rows.map((r) => {
    const v = +r.value || 0, pct = (v / total) * 100;
    return `<div class="ga-tr">
      <span class="ga-tl">${r.icon ? r.icon + " " : ""}${escapeHtml(r.label || "—")}</span>
      <span class="ga-tbar"><span class="ga-tbar-f" style="width:${(v / max * 100).toFixed(0)}%;background:${color}"></span></span>
      <span class="ga-tv">${pgFmtN(v)}<span class="ga-tpct">${pct.toFixed(0)} %</span></span>
    </div>`;
  }).join("")}</div>`;
}
// Panneau titré (contient une courbe ou un tableau).
const pgPanel = (title, inner, extra) => `<div class="ga-panel"><div class="ga-panel-h">${escapeHtml(title)}${extra ? `<span class="ga-panel-x">${extra}</span>` : ""}</div>${inner}</div>`;
// En-tête console : titre + sous-titre + bouton relancer (id repris par pgRenderDetail).
const pgGaHead = (title, s, btnId) => `<div class="ga-head">
    <div class="ga-head-t"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(s.label)} · mesuré par Pegasus</span></div>
    <div class="ga-controls">${btnId ? `<button class="ga-ic" id="${btnId}" title="Relancer l'analyse">↻</button>` : ""}</div>
  </div>`;
// Tableau clé/valeur simple (statuts, métriques détaillées).
const pgKV = (rows) => `<div class="ga-kv">${rows.map((r) => `<div class="ga-kv-r"><span>${escapeHtml(r[0])}</span><b>${r[2] ? r[1] : escapeHtml(r[1])}</b></div>`).join("")}</div>`;
const pgDayLabel = (ds) => { try { return new Date(ds + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }); } catch { return ds; } };
const PG_PALETTE = ["var(--accent2)", "#f6b26b", "#e0868f", "#7fb2e8", "#8fd6a6", "#c9a2e8", "#e8c268", "#9aa0a6"];
// Donut (anneau) + légende — répartition d'un total.
function pgDonut(rows, opts = {}) {
  rows = (rows || []).filter((r) => (+r.value || 0) > 0);
  if (!rows.length) return `<div class="ga-chart-empty">Aucune donnée.</div>`;
  const total = rows.reduce((n, r) => n + (+r.value || 0), 0) || 1;
  const C = 2 * Math.PI * 52;
  let off = 0;
  const segs = rows.map((row, i) => {
    const frac = (+row.value || 0) / total;
    const seg = `<circle cx="70" cy="70" r="52" fill="none" stroke="${PG_PALETTE[i % PG_PALETTE.length]}" stroke-width="18" stroke-dasharray="${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}" stroke-dashoffset="${(-off * C).toFixed(2)}" transform="rotate(-90 70 70)"/>`;
    off += frac; return seg;
  }).join("");
  const legend = rows.map((row, i) => `<div class="ga-leg-r"><span class="ga-leg-d" style="background:${PG_PALETTE[i % PG_PALETTE.length]}"></span><span class="ga-leg-l">${row.icon ? row.icon + " " : ""}${escapeHtml(row.label || "—")}</span><span class="ga-leg-v">${pgFmtN(+row.value || 0)}</span></div>`).join("");
  return `<div class="ga-donut"><svg viewBox="0 0 140 140" class="ga-donut-svg">${segs}<text x="70" y="66" text-anchor="middle" class="ga-donut-c">${pgFmtN(total)}</text><text x="70" y="83" text-anchor="middle" class="ga-donut-s">${escapeHtml(opts.centerLabel || "total")}</text></svg><div class="ga-leg">${legend}</div></div>`;
}
// Entonnoir — barres décroissantes centrées + taux de passage.
function pgFunnel(stages) {
  stages = (stages || []).filter(Boolean);
  const max = Math.max(1, ...stages.map((s) => +s.value || 0));
  return `<div class="ga-funnel">${stages.map((s, i) => {
    const v = +s.value || 0, w = Math.max(8, (v / max) * 100);
    const prev = i > 0 ? (+stages[i - 1].value || 0) : null;
    const conv = prev != null && prev > 0 ? Math.round(v / prev * 100) : null;
    return `<div class="ga-fn-row"><div class="ga-fn-bar" style="width:${w.toFixed(0)}%"><b>${pgFmtN(v)}</b></div><div class="ga-fn-lbl">${escapeHtml(s.label)}${conv != null ? ` <span class="ga-fn-conv">${conv} %</span>` : ""}</div></div>`;
  }).join("")}</div>`;
}
// Heatmap heure (0-23) × jour de la semaine (lun-dim).
function pgHeatmap(cells, opts = {}) {
  const days = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const grid = {}; let max = 0;
  (cells || []).forEach((c) => { grid[c.wd + "-" + c.hr] = c.c; if (c.c > max) max = c.c; });
  if (!max) return `<div class="ga-chart-empty">Pas encore assez de données pour la répartition horaire — elle se remplit au fil du trafic.</div>`;
  const color = opts.color || "var(--accent2)";
  const head = `<div class="ga-hm-row"><span class="ga-hm-h"></span>${days.map((d) => `<span class="ga-hm-d">${d}</span>`).join("")}</div>`;
  let rows = "";
  for (let hr = 0; hr < 24; hr++) {
    let cs = "";
    for (let wd = 0; wd < 7; wd++) {
      const c = grid[wd + "-" + hr] || 0;
      const op = c ? (0.14 + 0.86 * (c / max)).toFixed(2) : "1";
      cs += `<span class="ga-hm-c" title="${days[wd]} ${String(hr).padStart(2, "0")}h — ${c} visite(s)" style="background:${c ? color : "var(--card2)"};opacity:${op}"></span>`;
    }
    rows += `<div class="ga-hm-row"><span class="ga-hm-h">${hr % 6 === 0 ? String(hr).padStart(2, "0") + "h" : ""}</span>${cs}</div>`;
  }
  return `<div class="ga-hm">${head}${rows}</div>`;
}

// Tendance entre le 1er et le dernier point d'une série (goodDown = une baisse est bonne)
function pgTrend(vals, goodDown) {
  vals = (vals || []).filter((v) => v != null && !isNaN(v));
  if (vals.length < 2) return null;
  const d = vals[vals.length - 1] - vals[0];
  if (d === 0) return { dir: "stable", txt: "stable", good: null };
  const up = d > 0;
  const good = goodDown ? !up : up;
  return { dir: up ? "up" : "down", delta: d, good, txt: `${up ? "▲" : "▼"} ${Math.abs(d).toFixed(goodDown && Math.abs(d) < 3 ? 2 : 0)}` };
}

// ── Historique des métriques (SEO/Perf/Sécurité) : cache + capture ──
const pgMetrics = {};
const pgMetricsLoading = new Set();
async function pgLoadMetrics(key) {
  if (pgMetrics[key]) return pgMetrics[key];
  if (pgMetricsLoading.has(key)) return null;
  pgMetricsLoading.add(key);
  const r = await window.olympus.pegasusMetricsGet(key);
  pgMetrics[key] = r.ok ? r.metrics : { seo: [], perf: [], secu: [] };
  pgMetricsLoading.delete(key);
  return pgMetrics[key];
}
async function pgCaptureMetric(key, kind, point) {
  try { await window.olympus.pegasusMetricsAppend(key, kind, point); delete pgMetrics[key]; } catch {}
}
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
  box.querySelectorAll(".pg-tabfold").forEach((el) => { el.onclick = () => {
    pgSiteTab = el.dataset.tab;
    // Audience = suivi « en direct » : on rafraîchit à chaque ouverture de l'onglet (pas de cache figé)
    if (el.dataset.tab === "audience") Object.keys(pgAudCache).forEach((k) => k.startsWith(pgSel + ":") && delete pgAudCache[k]);
    pgRenderSide(); pgRenderDetail();
  }; });
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
  { id: "fiche", label: "Fiche technique" },
  { id: "pipeline", label: "Pipeline" },
  { id: "arbo", label: "Arborescence" },
  { id: "mood", label: "Moodboard" },
  { id: "audience", label: "Audience" },
  { id: "seo", label: "SEO" },
  { id: "perf", label: "Performance" },
  { id: "secu", label: "Sécurité" },
  { id: "rapport", label: "Rapport" },
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
  const scb = box.querySelector("#pgSecuBtn"); if (scb) scb.onclick = () => pgLoadDiag(s.key);
  // Chaque vue s'analyse toute seule à la 1re ouverture (puis en cache — bouton « Relancer » pour rafraîchir)
  if (pgSiteTab === "seo" && pgSeo[s.key] === undefined) pgRunSeo(s.key);
  if (pgSiteTab === "perf" && pgPerf[s.key] === undefined) pgRunPerf(s.key);
  if (pgSiteTab === "secu" && pgDiag[s.key] === undefined) pgLoadDiag(s.key);
  // Historique des métriques pour les sparklines des tableaux de bord
  if (["seo", "perf", "secu", "rapport"].includes(pgSiteTab) && !pgMetrics[s.key]) pgLoadMetrics(s.key).then((m) => { if (m && pgSel === s.key) pgRenderDetail(); });
  if (pgSiteTab === "general") pgGeneralRender(s);
  if (pgSiteTab === "rapport") pgRapportRender(s);
  if (pgSiteTab === "audience") pgAudienceRender(s);
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
  if (tab === "general") return `<div id="pgGeneral"><div class="rb-empty">Chargement de l'aperçu…</div></div>`;
  if (tab === "fiche") return pgTabFiche(s);
  if (tab === "pipeline") return `<div id="pgPipeline"><div class="rb-empty">Chargement du pipeline…</div></div>`;
  if (tab === "arbo") return `<div id="pgArbo"><div class="rb-empty">Chargement de l'arborescence…</div></div>`;
  if (tab === "mood") return `<div id="pgMood"><div class="rb-empty">Chargement du moodboard…</div></div>`;
  if (tab === "seo") return pgTabSeo(s);
  if (tab === "perf") return pgTabPerf(s);
  if (tab === "secu") return pgTabSecu(s);
  if (tab === "rapport") return `<div id="pgRapport"><div class="rb-empty">Chargement du rapport…</div></div>`;
  if (tab === "audience") return `<div id="pgAudience"><div class="rb-empty">Chargement de l'audience…</div></div>`;
  return "";
}

// ══ Arborescence : canvas de nodes — pages flottantes, câbles = où chaque section emmène ══
const pgArboCache = {};                       // par site : l'arborescence en cours d'édition
// Un timer de debounce PAR SITE — avant, un timer global : programmer la sauvegarde du site B
// annulait celle, encore en attente, du site A → modifications d'arborescence perdues.
const pgArboSaveT = {};
function pgArboSave(key) {
  clearTimeout(pgArboSaveT[key]);
  pgArboSaveT[key] = setTimeout(() => window.olympus.pegasusArboSave(key, pgArboCache[key]), 400);
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
      // Maquette conservée : contexte + style de page + contenus/animations/réf. de sections (matchés par titre)
      if (old.contexte) np.contexte = old.contexte;
      if (old.refStyle) np.refStyle = old.refStyle;
      const oldTxt = new Map((old.sections || []).filter((x) => x.texte || x.animation || (x.anims || []).length || x.animRef).map((x) => [x.titre, x]));
      for (const sc of np.sections) {
        const o = oldTxt.get(sc.titre);
        if (!o) continue;
        if (!sc.texte && o.texte) sc.texte = o.texte;
        if (!sc.animation && o.animation) sc.animation = o.animation;
        if (!(sc.anims || []).length && (o.anims || []).length) sc.anims = o.anims;
        if (!sc.animRef && o.animRef) sc.animRef = o.animRef;
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
  let arbo = pgArboCache[s.key];

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
  // en place. pgWirePrep garantit une copie de l'en-ligne + un wireframe de travail,
  // et fait atterrir directement sur le wireframe de travail (éditable).
  const man = await pgWirePrep(s);
  arbo = pgArboCache[s.key]; // pgWirePrep a pu basculer sur la version de travail
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
      <span class="ab-lock">🔒 Version actuelle du site — lecture seule. Pour la modifier, crée un nouveau wireframe dans la colonne de droite →</span>
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
              ${p.artefact ? "" : `<button class="ab-mini${p.contexte || p.refStyle || (p.sections || []).some((sc) => sc.texte || sc.animation || (sc.anims || []).length || sc.animRef?.url) ? " has" : ""}" data-act="maquette" title="Maquette : contexte, contenu, destinations, animations, références">📝</button>`}
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
  let versions = (r.ok && r.versions) || [];
  let deployed = r.ok ? r.deployed : null;
  const arbo = pgArboCache[s.key];
  if (arbo && arbo.pages && !pgWireBaselining) {
    pgWireBaselining = true;
    // 1. La copie de la version en ligne (socle, immuable, deployed)
    if (!versions.length) {
      await window.olympus.pegasusWireSave(s.key, arbo, "Site en ligne", true);
      r = await window.olympus.pegasusWireList(s.key);
      versions = (r.ok && r.versions) || []; deployed = r.ok ? r.deployed : null;
    }
    // 2. Toujours au moins UN wireframe de travail (dupliqué du socle)
    let drafts = versions.filter((v) => v.id !== deployed);
    if (deployed && !drafts.length) {
      const base = await window.olympus.pegasusWireLoad(s.key, deployed);
      if (base.ok) await window.olympus.pegasusWireSave(s.key, base.arbo, "Wireframe 1", false);
      r = await window.olympus.pegasusWireList(s.key);
      versions = (r.ok && r.versions) || []; deployed = r.ok ? r.deployed : null;
      drafts = versions.filter((v) => v.id !== deployed);
    }
    // 3. On atterrit DIRECTEMENT sur le wireframe de travail (éditable). On respecte
    //    un choix explicite : si le doc pointe déjà une version valide (y compris la
    //    version en ligne consultée via « Voir cette version »), on n'y touche pas.
    const validIds = new Set(versions.map((v) => v.id));
    if (!arbo.versionId || !validIds.has(arbo.versionId)) {
      const latest = drafts.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];
      if (latest) {
        const ld = await window.olympus.pegasusWireLoad(s.key, latest.id);
        if (ld.ok) { ld.arbo.versionId = latest.id; pgArboCache[s.key] = ld.arbo; await window.olympus.pegasusArboSave(s.key, ld.arbo); }
      }
    }
    pgWireBaselining = false;
    r = await window.olympus.pegasusWireList(s.key);
  }
  return pgWireCache[s.key] = r.ok ? { versions: r.versions || [], deployed: r.deployed || null } : { versions: [], deployed: null };
}
// Crée un nouveau wireframe (version de travail) et l'ouvre dans l'éditeur.
// from = "site" → duplique la version actuelle du site ; "blank" → part de zéro.
async function pgWireNew(s, from) {
  const r = await window.olympus.pegasusWireList(s.key);
  const versions = (r.ok && r.versions) || [];
  const deployed = r.ok ? r.deployed : null;
  const n = versions.filter((v) => v.id !== deployed).length + 1;
  let arbo;
  if (from === "site" && deployed) {
    const base = await window.olympus.pegasusWireLoad(s.key, deployed);
    arbo = base.ok ? base.arbo : { pages: [] };
  } else {
    arbo = { pages: [{ id: pgArboId(), titre: "Accueil", home: true, sections: [] }] };
  }
  const sr = await window.olympus.pegasusWireSave(s.key, arbo, "Wireframe " + n, false);
  if (sr.ok) { arbo.versionId = sr.id; pgArboCache[s.key] = arbo; await window.olympus.pegasusArboSave(s.key, arbo); }
  delete pgWireCache[s.key];
  pgArboRender(s);
}
async function pgWireRenderCol(s) {
  const box = $("abVersions"); if (!box) return;
  const r = await window.olympus.pegasusWireList(s.key);
  const man = pgWireCache[s.key] = r.ok ? { versions: r.versions || [], deployed: r.deployed || null } : { versions: [], deployed: null };
  const fmt = (ts) => { try { return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ts; } };
  const cur = pgArboCache[s.key]?.versionId;
  const enligne = man.versions.find((v) => v.id === man.deployed);
  const drafts = man.versions.filter((v) => v.id !== man.deployed).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  box.innerHTML = `
    <div class="abv-h">Wireframes</div>
    <button class="abv-new primary" data-new="site">＋ Nouveau wireframe<small>à partir de la version actuelle du site</small></button>
    <button class="abv-new" data-new="blank">＋ Nouveau wireframe<small>de zéro</small></button>
    ${enligne ? `<div class="abv-sub">Référence</div>
      <div class="abv-item deployed${cur === enligne.id ? " current" : ""}" data-id="${enligne.id}">
        <div class="abv-top"><span class="abv-name">Version actuelle du site</span>${cur === enligne.id ? '<span class="abv-tag last">ouverte</span>' : ""}</div>
        <div class="abv-live">● telle qu'en ligne — lecture seule</div>
        <div class="abv-acts"><button class="abv-open" data-act="view">Voir cette version →</button></div>
      </div>` : ""}
    <div class="abv-sub">Mes wireframes</div>
    ${drafts.length ? drafts.map((v) => `
      <div class="abv-item${cur === v.id ? " current" : ""}" data-id="${v.id}">
        <div class="abv-top"><span class="abv-name" data-f="vname" title="Double-clic pour renommer">${escapeHtml(v.label || "Sans nom")}</span>${cur === v.id ? '<span class="abv-tag last">ouvert</span>' : ""}</div>
        <div class="abv-date">${fmt(v.ts)}</div>
        <button class="abv-work" data-act="work" title="Ouvre la version locale et travaille d'après ce wireframe">Travailler sur le site depuis ce wireframe</button>
        <div class="abv-acts">
          <button class="abv-open" data-act="load" title="Ouvrir dans l'éditeur (tes modifications s'y enregistrent)">Ouvrir dans l'éditeur ↗</button>
          <button class="abv-b" data-act="del" title="Supprimer">✕</button>
        </div>
      </div>`).join("") : '<div class="abv-empty">Aucun wireframe de travail. Crée-en un avec les boutons ci-dessus.</div>'}`;

  box.querySelector('[data-new="site"]').onclick = () => pgWireNew(s, "site");
  box.querySelector('[data-new="blank"]').onclick = () => pgWireNew(s, "blank");
  box.querySelectorAll(".abv-item").forEach((el) => {
    const id = el.dataset.id;
    const version = man.versions.find((x) => x.id === id) || { id, label: "" };
    const nameEl = el.querySelector('[data-f="vname"]');
    if (nameEl) pgAbEditable(nameEl, async (v) => { await window.olympus.pegasusWireRename(s.key, id, v || "Sans nom"); delete pgWireCache[s.key]; });
    const openIn = async () => {
      const lr = await window.olympus.pegasusWireLoad(s.key, id);
      if (lr.ok) { lr.arbo.versionId = id; pgArboCache[s.key] = lr.arbo; await window.olympus.pegasusArboSave(s.key, lr.arbo); pgArboRender(s); }
      else alert("Échec : " + (lr.error || ""));
    };
    const view = el.querySelector('[data-act="view"]'); if (view) view.onclick = openIn;   // référence → lecture seule
    const load = el.querySelector('[data-act="load"]'); if (load) load.onclick = openIn;   // wireframe de travail → éditable
    const work = el.querySelector('[data-act="work"]'); if (work) work.onclick = () => pgWireWorkModal(s, version);
    // Cliquer N'IMPORTE OÙ sur la carte ouvre la version (sauf boutons / renommage en cours)
    el.style.cursor = "pointer";
    el.addEventListener("click", (ev) => {
      if (ev.target.closest("button") || ev.target.closest('[contenteditable="true"]')) return;
      openIn();
    });
    const delBtn = el.querySelector('[data-act="del"]');
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm("Supprimer ce wireframe ?")) return;
      await window.olympus.pegasusWireDelete(s.key, id);
      delete pgWireCache[s.key]; await pgWireRenderCol(s);
    };
  });
}

// Modale « Travailler sur le site depuis ce wireframe » : ouvre la version locale et,
// au choix, laisse Claude générer automatiquement les pages/sections/boutons/liens
// depuis le wireframe ciblé, ou laisse l'utilisateur construire à la main.
function pgWireWorkModal(s, v, moodId) {
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
    const r = await window.olympus.pegasusWireWork(s.key, v.id, mode, moodId || null);
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

// Modale « Maquette » d'une page du wireframe : le contexte de la page + pour
// chaque section, son contenu, sa destination et ses animations (puces guidées
// du vocabulaire motion Orphic). C'est la matière que le brief transmet.
const AB_ANIMS = ["Fondu à l'arrivée", "Montée au scroll", "Parallaxe", "Texte révélé mot à mot", "Zoom lent des images", "Survol lumineux", "Épinglée au scroll", "Aucune animation"];
// Type dérivé d'une référence de la bibliothèque : animation / page (URL profonde) / site (racine)
function pgRefType(ref) {
  if (ref.kind === "animation") return "animation";
  try {
    const u = new URL(/^https?:\/\//i.test(ref.url || "") ? ref.url : "https://" + (ref.url || ""));
    const path = (u.pathname || "").replace(/\/+$/, "");
    return path ? "page" : "site";
  } catch { return "site"; }
}
// Sélecteur : piocher une référence (site / page / animation) dans la bibliothèque Orphic
async function pgRefLibPicker(opts) {
  const { title = "Piocher dans la bibliothèque", filter = "tous", onPick } = opts || {};
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  ov.innerHTML = `<div class="modal-panel" style="width:720px;max-width:94vw;">
      <div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-x" data-x aria-label="Fermer">✕</button></div>
      <div class="modal-body" style="max-height:74vh;overflow:auto;">
        <div class="rlp-bar">
          <input class="mood-in rlp-q" placeholder="Rechercher — titre, technique, secteur…">
          <div class="rlp-tabs">${[["tous", "Tous"], ["site", "Sites"], ["page", "Pages"], ["animation", "Animations"]].map(([k, l]) => `<button class="rlp-tab${filter === k ? " on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
        </div>
        <div class="rlp-list"><div class="rb-empty">Lecture de la bibliothèque…</div></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const listBox = ov.querySelector(".rlp-list");
  const r = await window.olympus.pegasusRefs({ statut: "tous", limit: 500 });
  if (!r.ok && r.missing_table) { listBox.innerHTML = `<div class="rb-empty">La bibliothèque n'est pas encore initialisée. Ouvre l'onglet <b>Bibliothèque</b> pour la configurer, puis ajoute des références.</div>`; return; }
  if (!r.ok) { listBox.innerHTML = `<div class="rb-empty">${escapeHtml(r.error || "Bibliothèque indisponible.")}</div>`; return; }
  // On ne pioche que des références réellement liables (avec une URL)
  const all = (r.refs || []).filter((x) => x.url && String(x.url).trim()).map((x) => ({ ...x, _t: pgRefType(x) }));
  const badge = { site: "Site", page: "Page", animation: "Animation" };
  let curF = filter, curQ = "";
  const render = () => {
    const q = curQ.toLowerCase();
    const rows = all.filter((x) => (curF === "tous" || x._t === curF) && (!q || [x.titre, x.technique, x.business, x.notes, x.ingredients, x.url].some((v) => (v || "").toLowerCase().includes(q))));
    if (!rows.length) { listBox.innerHTML = `<div class="rb-empty">Aucune référence ${curF !== "tous" ? "de ce type " : ""}dans la bibliothèque${curQ ? " pour cette recherche" : ""}. On en ajoute depuis l'onglet Bibliothèque.</div>`; return; }
    listBox.innerHTML = `<div class="rlp-grid">${rows.map((x, i) => {
      let host = x.url || "";
      const full = /^https?:\/\//i.test(x.url) ? x.url : "https://" + x.url;
      if (x.url) { try { const u = new URL(full); host = u.host.replace(/^www\./, "") + (x._t === "page" ? (u.pathname || "").replace(/\/+$/, "") : ""); } catch {} }
      return `<div class="rlp-card" data-i="${i}" role="button" tabindex="0" title="Choisir cette référence">
          <div class="rlp-top"><span class="rlp-badge rlp-${x._t}">${badge[x._t]}</span>${x.niveau ? `<span class="rlp-niv">${escapeHtml(x.niveau)}</span>` : ""}${x.statut === "valide" ? '<span class="rlp-ok" title="Validée">✓</span>' : ""}<button class="rlp-open" data-open="${escapeHtml(full)}" title="Voir dans le navigateur">↗</button></div>
          <div class="rlp-title">${escapeHtml(x.titre || "—")}</div>
          <div class="rlp-host">${escapeHtml(host)}</div>
          ${x.technique ? `<div class="rlp-tech">${escapeHtml(x.technique)}</div>` : ""}
        </div>`;
    }).join("")}</div>`;
    listBox.querySelectorAll(".rlp-open").forEach((b) => b.onclick = (e) => { e.stopPropagation(); window.olympus.openExternal(b.dataset.open); });
    listBox.querySelectorAll(".rlp-card").forEach((c) => c.onclick = () => { if (onPick) onPick(rows[+c.dataset.i]); close(); });
  };
  ov.querySelectorAll(".rlp-tab").forEach((t) => t.onclick = () => { curF = t.dataset.f; ov.querySelectorAll(".rlp-tab").forEach((x) => x.classList.toggle("on", x === t)); render(); });
  const qEl = ov.querySelector(".rlp-q"); qEl.oninput = () => { curQ = qEl.value.trim(); render(); };
  render();
}
function pgAbMaquetteModal(s, p, ro) {
  // Migration : l'ancien champ libre `animation` devient une puce personnalisée
  for (const sec of p.sections || []) {
    if (sec.animation && !sec.anims) { sec.anims = [sec.animation]; delete sec.animation; }
  }
  const ov = document.createElement("div");
  ov.className = "modal-overlay show";
  const chips = (sec, i) => {
    const on = sec.anims || [];
    const custom = on.filter((a) => !AB_ANIMS.includes(a));
    return `<div class="mq-chips" data-ci="${i}">
      ${AB_ANIMS.map((a) => `<button class="mq-chip${on.includes(a) ? " on" : ""}${a === "Aucune animation" ? " calm" : ""}" data-a="${escapeHtml(a)}" ${ro ? "disabled" : ""}>${a}</button>`).join("")}
      ${custom.map((a) => `<button class="mq-chip on custom" data-a="${escapeHtml(a)}" title="${ro ? "" : "Cliquer pour retirer"}" ${ro ? "disabled" : ""}>${escapeHtml(a)} ✕</button>`).join("")}
      ${ro ? "" : `<button class="mq-chip add" data-addanim>＋ préciser…</button>`}
    </div>`;
  };
  ov.innerHTML = `
    <div class="modal-panel" style="width:660px;">
      <div class="modal-head"><h2>Maquette — ${escapeHtml(p.titre)}</h2><button class="modal-x" data-x aria-label="Fermer">✕</button></div>
      <div class="modal-body">
        ${ro ? `<div class="pg-alert" style="border:0;color:var(--dim);margin-bottom:10px;">🔒 Version en ligne — lecture seule. Duplique la version en ligne (barre du haut) pour modifier la maquette.</div>` : ""}
        <div class="mq-label">Rôle de la page</div>
        <textarea class="mood-in mood-ta" data-mq="ctx" placeholder="À quoi sert cette page, à qui elle parle, ce qu'elle doit provoquer…" ${ro ? "disabled" : ""}>${escapeHtml(p.contexte || "")}</textarea>
        <div class="mq-label">Style de page — référence</div>
        <div class="mq-refline">
          <input class="mood-in" data-refstyle placeholder="Lien d'une page dont le style te plaît (https://…)" value="${escapeHtml(p.refStyle || "")}" ${ro ? "disabled" : ""}>
          ${ro ? "" : `<button class="mq-lib" data-libstyle title="Piocher un site ou une page dans la bibliothèque">📚</button>`}
          <button class="mq-open" data-openref="page" title="Ouvrir" ${p.refStyle ? "" : 'style="display:none"'}>↗</button>
        </div>
        ${(p.sections || []).map((sec, i) => {
          const cible = sec.cible && (pgArboCache[s.key]?.pages || []).find((x) => x.id === sec.cible);
          const ar = sec.animRef || {};
          return `
          <div class="mq-sec">
            <div class="mq-t">
              <span class="ab-secdot" style="background:${sec.color || "var(--line2)"};"></span>${escapeHtml(sec.titre)}
              <span class="mq-dest${cible ? " on" : ""}">${cible ? `⇢ emmène vers <b>${escapeHtml(cible.titre)}</b>` : "⇢ n'emmène nulle part"}</span>
            </div>
            <div class="mq-label">Contenu — ce que la section raconte</div>
            <textarea class="mood-in mood-ta mini" data-mq="${i}" placeholder="Son rôle, son message, son texte…" ${ro ? "disabled" : ""}>${escapeHtml(sec.texte || "")}</textarea>
            <div class="mq-label">Animations</div>
            ${chips(sec, i)}
            <div class="mq-label">Animation référence — une animation qui te plaît ailleurs</div>
            <div class="mq-animref" data-ari="${i}">
              <div class="mq-refline">
                <input class="mood-in mq-ari-url" placeholder="Lien de la page où se trouve l'animation" value="${escapeHtml(ar.url || "")}" ${ro ? "disabled" : ""}>
                ${ro ? (ar.url ? `<button class="mq-open" data-openref="ari-${i}" title="Ouvrir">↗</button>` : "") : `<button class="mq-lib mq-ari-lib" title="Piocher une animation dans la bibliothèque">📚</button><button class="mq-chip mq-ari-scan">Scanner les sections</button>`}
              </div>
              <select class="pl-select mq-ari-sec" ${ro ? "disabled" : ""} ${!ar.section ? 'style="display:none"' : ""}>
                ${ar.section ? `<option value="${escapeHtml(ar.section)}" selected>${escapeHtml(ar.section)}</option>` : '<option value="">— section —</option>'}
              </select>
            </div>
          </div>`;
        }).join("")}
      </div>
      <div class="modal-foot"><span class="ab-hint" style="flex:1;">${ro ? "Consultation seule." : "Enregistré automatiquement — repris dans le brief de construction."}</span><button class="btn" data-x>Fermer</button></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelectorAll("[data-x]").forEach((b) => b.onclick = close);
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const syncBadge = () => {
    const btn = document.querySelector(`.ab-node[data-p="${p.id}"] [data-act="maquette"]`);
    if (btn) btn.classList.toggle("has", !!(p.contexte || p.refStyle || (p.sections || []).some((sc) => sc.texte || (sc.anims || []).length || sc.animRef?.url)));
  };
  ov.querySelectorAll("[data-mq]").forEach((t) => t.oninput = () => {
    if (t.dataset.mq === "ctx") p.contexte = t.value;
    else p.sections[+t.dataset.mq].texte = t.value;
    pgArboSave(s.key); syncBadge();
  });
  // Ouvrir un lien de référence (dispo en lecture seule aussi)
  ov.querySelectorAll("[data-openref]").forEach((b) => b.onclick = () => {
    const k = b.dataset.openref;
    const url = k === "page" ? p.refStyle : (p.sections[+k.split("-")[1]]?.animRef || {}).url;
    if (url) window.olympus.openExternal(/^https?:\/\//i.test(url) ? url : "https://" + url);
  });
  if (ro) return;
  // Style de page (référence) — saisie libre OU piochée dans la bibliothèque
  const rs = ov.querySelector("[data-refstyle]");
  const rsOpen = ov.querySelector('[data-openref="page"]');
  const setRefStyle = (url) => { p.refStyle = (url || "").trim(); if (rs) rs.value = p.refStyle; if (rsOpen) rsOpen.style.display = p.refStyle ? "" : "none"; pgArboSave(s.key); syncBadge(); };
  if (rs) rs.oninput = () => setRefStyle(rs.value);
  const rsLib = ov.querySelector("[data-libstyle]");
  if (rsLib) rsLib.onclick = () => pgRefLibPicker({ title: "Style de page — piocher dans la bibliothèque", filter: "tous", onPick: (ref) => setRefStyle(ref.url) });
  // Animation référence par section : lien + scan des sections + choix dans la liste
  ov.querySelectorAll(".mq-animref").forEach((box) => {
    const i = +box.dataset.ari;
    const sec = p.sections[i];
    const urlEl = box.querySelector(".mq-ari-url");
    const selEl = box.querySelector(".mq-ari-sec");
    urlEl.oninput = () => { sec.animRef = { ...(sec.animRef || {}), url: urlEl.value.trim() }; pgArboSave(s.key); syncBadge(); };
    selEl.onchange = () => { sec.animRef = { ...(sec.animRef || {}), section: selEl.value || "" }; pgArboSave(s.key); syncBadge(); };
    // Piocher une animation dans la bibliothèque : remplit l'URL + note le nom de l'animation
    const lib = box.querySelector(".mq-ari-lib");
    if (lib) lib.onclick = () => pgRefLibPicker({ title: "Animation — piocher dans la bibliothèque", filter: "animation", onPick: (ref) => {
      sec.animRef = { url: ref.url || "", section: ref.titre || "" };
      urlEl.value = sec.animRef.url;
      selEl.innerHTML = `<option value="${escapeHtml(sec.animRef.section)}" selected>${escapeHtml(sec.animRef.section || "— animation —")}</option>`;
      selEl.style.display = sec.animRef.section ? "" : "none";
      pgArboSave(s.key); syncBadge();
    } });
    const scan = box.querySelector(".mq-ari-scan");
    if (scan) scan.onclick = async () => {
      const url = urlEl.value.trim();
      if (!url) { urlEl.focus(); return; }
      scan.disabled = true; scan.textContent = "Scan…";
      const r = await window.olympus.pegasusPageSections(url);
      scan.disabled = false; scan.textContent = "Scanner les sections";
      if (!r.ok) { alert("Échec du scan : " + (r.error || "")); return; }
      if (!r.sections.length) { alert("Aucune section détectée sur cette page."); return; }
      const keep = sec.animRef?.section || "";
      selEl.innerHTML = '<option value="">— choisir la section —</option>' + r.sections.map((sc) => {
        const label = `${sc.n} · ${sc.titre}`;
        return `<option value="${escapeHtml(label)}" ${keep === label ? "selected" : ""}>${escapeHtml(label)}</option>`;
      }).join("");
      selEl.style.display = "";
    };
  });
  // Les puces d'animation : clic = choisir/retirer ; « Aucune animation » est exclusive
  const rechips = (box, sec, i) => { box.outerHTML = chips(sec, i); wireChips(ov.querySelector(`.mq-chips[data-ci="${i}"]`), sec, i); };
  function wireChips(box, sec, i) {
    box.querySelectorAll(".mq-chip:not(.add)").forEach((c) => c.onclick = () => {
      const a = c.dataset.a;
      sec.anims = sec.anims || [];
      if (sec.anims.includes(a)) sec.anims = sec.anims.filter((x) => x !== a);
      else if (a === "Aucune animation") sec.anims = [a];
      else sec.anims = [...sec.anims.filter((x) => x !== "Aucune animation"), a];
      pgArboSave(s.key); syncBadge(); rechips(box, sec, i);
    });
    const add = box.querySelector("[data-addanim]");
    if (add) add.onclick = () => {
      const inp = document.createElement("input");
      inp.className = "mood-in mini mq-chip-in";
      inp.placeholder = "décris l'animation + Entrée";
      add.replaceWith(inp); inp.focus();
      let done = false;
      const commit = () => {
        if (done) return; done = true;
        const v = inp.value.trim();
        if (v) { sec.anims = [...(sec.anims || []).filter((x) => x !== "Aucune animation"), v]; pgArboSave(s.key); syncBadge(); }
        rechips(box, sec, i);
      };
      inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { inp.value = ""; commit(); } };
      inp.onblur = commit;
    };
  }
  ov.querySelectorAll(".mq-chips").forEach((box) => wireChips(box, p.sections[+box.dataset.ci], +box.dataset.ci));
}

// ══ Pipeline de travail : le fil conducteur d'un site ══
// Nouveau site (9 étapes guidées) / Refonte complète (mêmes étapes, vues
// préremplies) / Micro-modifications (tout prérempli, retouches libres).
// Chaque étape : guidée, passable, « laisser l'IA choisir », discussion Claude.
// Le dev peut générer le site QUAND il veut — étapes vides = résultat plus
// éloigné de ses attentes, et il en est averti.
const pgPlCache = {};
const pgPlSaveT = {};                                        // idem : un debounce par site (pas de perte inter-site)
function pgPlSave(key) {
  clearTimeout(pgPlSaveT[key]);
  pgPlSaveT[key] = setTimeout(() => window.olympus.pegasusPipelineSave(key, pgPlCache[key]), 400);
}
const PL_ETAPES = [
  { id: "wireframe", titre: "Mise en place du wireframe", vue: "arbo", connect: "wire",
    desc: "Structure du site en nodes : pages, sections, connexions. Scanne le site ou pars de zéro, puis enregistre une version.",
    prompt: "On travaille le wireframe du site (arborescence.json : pages, sections, connexions). Regarde l'existant et aide-moi à structurer les pages et les parcours. Quand on décide quelque chose, mets à jour arborescence.json." },
  { id: "maquette", titre: "Maquette — textes & contexte", vue: "arbo",
    desc: "Chaque page du wireframe porte sa maquette : le contexte de la page et le texte de chaque section (bouton 📝 sur les nodes). C'est la matière du site.",
    prompt: "On remplit la maquette : le contexte de chaque page (champ contexte) et le texte de chaque section (champ texte) dans arborescence.json. Propose des textes fidèles au positionnement du site, page par page — je valide ou j'ajuste." },
  { id: "charte", titre: "Charte graphique", vue: "mood", connect: "mood",
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
// Prompt de la conversation « Avancer avec Claude » : tout le contexte du site +
// l'état des étapes + la consigne de guider le dev question par question, avec la
// possibilité de passer une étape ou de la confier à l'IA.
function pgPipelineAdvancePrompt(s, pl, niveau) {
  const et = pl.etapes || {};
  const modeTxt = pl.mode === "nouveau" ? "nouveau site (part de zéro)" : pl.mode === "refonte" ? "refonte complète (le site existe, tout est prérempli à retravailler)" : pl.mode;
  const lignes = PL_ETAPES.map((e, i) => {
    const na = e.n34 && niveau && niveau <= 2;
    const st = na ? "non applicable (site N1-N2)" : (PL_STATUTS[et[e.id]?.statut] || "À faire");
    return `${i + 1}. ${e.titre} — [${st}]\n   Objectif : ${e.desc}\n   Ce qu'on écrit : ${e.prompt}`;
  }).join("\n");
  return [
    `Tu accompagnes le développeur sur le site « ${s.label} » via le pipeline de travail Pegasus. Mode : ${modeTxt}. Niveau visé : ${niveau ? "N" + niveau : "pas encore choisi"}.`,
    ``,
    `TOUT LE CONTEXTE est dans ce dossier : arborescence.json (wireframe : pages, sections, connexions, maquette = contexte de page + textes + animations par section), moodboard.json (charte : couleurs, typos, logo, niveau, références), pipeline.json (l'état des étapes ci-dessous), et si présents wireframes/ (versions figées), site.json/content.json/home.html (snapshot du site réel), wordpress/. Lis-les avant de commencer. Si les outils Medusa (medusa_*) ou Pegasus (pegasus_*) sont disponibles, sers-t'en pour lire le parc et écrire proprement.`,
    ``,
    `LES ÉTAPES (statut actuel entre crochets) :`,
    lignes,
    ``,
    `TA MISSION — fais avancer le pipeline en CONVERSATION :`,
    `1. Commence par la première étape encore « À faire » (ignore celles déjà faites, passées, confiées à l'IA ou non applicables).`,
    `2. Pour chaque étape : explique en une phrase où on en est, puis pose TES questions UNE À LA FOIS (pas de mur de questions). Attends la réponse, reformule, et écris le résultat dans le bon fichier (arborescence.json / moodboard.json / pipeline.json selon l'étape).`,
    `3. À chaque étape, propose toujours explicitement trois sorties au dev : la remplir avec toi, la PASSER (« on passe cette étape »), ou te LAISSER DÉCIDER (tu choisis en suivant la doctrine orphic-web-design). Quand une étape est traitée, mets à jour son statut dans pipeline.json → etapes.<id>.statut (fait | passee | ia).`,
    `4. Enchaîne étape par étape jusqu'au bout, ou arrête-toi quand le dev le demande.`,
    `5. À LA FIN, récapitule ce qui est rempli / passé / laissé à l'IA, puis propose explicitement DEUX issues : (a) LANCER LA CRÉATION DU SITE maintenant — il clique « 🚀 Lancer la création du site » (ou « ⚡ Générer le site ») dans Olympus, ou tu peux construire directement ici si tout le contexte est prêt et qu'il le souhaite ; (b) ENREGISTRER LE PROJET POUR PLUS TARD — tout est déjà sauvegardé dans les fichiers, il reprendra le pipeline où il l'a laissé. Laisse-le choisir, ne force rien.`,
    `Respecte la doctrine du skill orphic-web-design (règle-mère, pas de registre par défaut, offre N1-N4, zones protégées). Ne construis pas le site tant qu'il n'a pas choisi l'issue (a) : cette conversation SERT À REMPLIR le pipeline, la génération est une étape à part.`,
  ].join("\n");
}
// Colonne « Versions du site (local) » de la vue pipeline. Toujours : une copie
// LOCALE de la version en ligne (immuable, référence) + au moins une version « en
// cours de modification » (mutable). On peut en créer plusieurs et les modifier.
let pgSvBusy = false;
async function pgSiteVersionsCol(s) {
  const box = $("plVersions"); if (!box) return;
  let r = await window.olympus.pegasusWireList(s.key);
  let versions = (r.ok && r.versions) || [];
  let deployed = r.ok ? r.deployed : null;
  // Toujours 2 versions en local : si la copie de l'en-ligne existe mais qu'aucune
  // version de travail n'a encore été créée, on la duplique automatiquement.
  const drafts0 = versions.filter((v) => v.id !== deployed);
  if (deployed && !drafts0.length && !pgSvBusy) {
    pgSvBusy = true;
    const base = await window.olympus.pegasusWireLoad(s.key, deployed);
    if (base.ok) await window.olympus.pegasusWireSave(s.key, base.arbo, "En cours de modification 1", false);
    pgSvBusy = false;
    r = await window.olympus.pegasusWireList(s.key);
    versions = (r.ok && r.versions) || []; deployed = r.ok ? r.deployed : null;
  }
  const fmt = (ts) => { try { return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ts; } };
  const enligne = versions.find((v) => v.id === deployed);
  const encours = versions.filter((v) => v.id !== deployed).sort((a, b) => (a.ts < b.ts ? 1 : -1));

  box.innerHTML = `
    <div class="abv-h">Versions du site (local)</div>
    ${enligne ? `<div class="abv-item deployed">
        <div class="abv-top"><span class="abv-name">Copie de la version en ligne</span></div>
        <div class="abv-live">● reflète le site en ligne</div>
        <div class="abv-acts"><button class="abv-open" data-consult="${enligne.id}" title="Consulter la copie (lecture seule)">Consulter →</button></div>
      </div>` : ""}
    <div class="abv-sub">En cours de modification</div>
    ${encours.length ? encours.map((v) => `
      <div class="abv-item" data-id="${v.id}">
        <div class="abv-top"><span class="abv-name" data-f="vname" title="Double-clic pour renommer">${escapeHtml(v.label || "Sans nom")}</span></div>
        <div class="abv-date">${fmt(v.ts)}</div>
        <div class="abv-acts">
          <button class="abv-work" data-act="edit" title="Modifier cette version dans l'arborescence">Modifier</button>
          <button class="abv-b" data-act="del" title="Supprimer">✕</button>
        </div>
      </div>`).join("") : '<div class="abv-empty">Aucune version de travail.</div>'}
    <button class="mood-add" id="svNew" style="margin-top:8px;">＋ Nouvelle version</button>`;

  const openInArbo = async (id, msg) => {
    const lr = await window.olympus.pegasusWireLoad(s.key, id);
    if (!lr.ok) { alert("Échec : " + (lr.error || "")); return; }
    lr.arbo.versionId = id; pgArboCache[s.key] = lr.arbo;
    await window.olympus.pegasusArboSave(s.key, lr.arbo);
    pgSiteTab = "arbo"; pgRenderSide(); pgRenderDetail();
    const m = $("pgWorkMsg"); if (m && msg) { m.className = "msg ok"; m.textContent = msg; }
  };
  const consult = box.querySelector("[data-consult]");
  if (consult) consult.onclick = () => openInArbo(consult.dataset.consult, "Copie de la version en ligne ouverte (lecture seule).");
  box.querySelector("#svNew").onclick = async () => {
    if (!deployed) return;
    const base = await window.olympus.pegasusWireLoad(s.key, deployed);
    if (!base.ok) { alert("Échec : " + (base.error || "")); return; }
    await window.olympus.pegasusWireSave(s.key, base.arbo, "En cours de modification " + (encours.length + 1), false);
    pgSiteVersionsCol(s);
  };
  box.querySelectorAll(".abv-item[data-id]").forEach((el) => {
    const id = el.dataset.id;
    const nameEl = el.querySelector('[data-f="vname"]');
    pgAbEditable(nameEl, async (v) => { await window.olympus.pegasusWireRename(s.key, id, v || "Sans nom"); });
    el.querySelector('[data-act="edit"]').onclick = () => openInArbo(id, "Version ouverte dans l'arborescence — tes modifications s'enregistrent dans cette version.");
    el.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm("Supprimer cette version en cours ?")) return;
      await window.olympus.pegasusWireDelete(s.key, id);
      pgSiteVersionsCol(s);
    };
  });
}
// Prompt de la conversation « micro-modifications » : contexte du site + la version
// de référence choisie (en ligne vs en cours de modification).
function pgMicroPrompt(s, which, draftLabel) {
  const ref = which === "actuelle"
    ? "la VERSION ACTUELLE DU SITE (l'état réellement en ligne) : appuie-toi sur site.json, content.json, home.html (snapshot du site réel) et le wireframe déployé (wireframes/ → la version marquée deployed dans manifest.json)."
    : `la VERSION EN COURS DE MODIFICATION du wireframe : la dernière version de travail « ${draftLabel || ""} » dans wireframes/ (la plus récente non déployée du manifest.json), et le moodboard de travail.`;
  return [
    `Micro-modifications sur le site « ${s.label} ». Le projet est ouvert en local dans ce dossier.`,
    `Référence de travail : ${ref}`,
    ``,
    `Lis les fichiers du projet pour avoir le contexte (arborescence.json, moodboard.json, pipeline.json, et le site local — wordpress/ ou les .html). Utilise les outils Medusa/Pegasus s'ils sont disponibles.`,
    `Je vais te donner des retouches ponctuelles à faire. Applique-les EN LOCAL uniquement, une par une, en respectant la charte (moodboard) et la doctrine orphic-web-design (zones protégées : ne touche pas à ce qui est validé au-delà de la retouche demandée).`,
    `Ne déploie JAMAIS : la mise en ligne passe par le bouton « Pousser en ligne » d'Olympus, sur décision explicite. Dis-moi quelles retouches tu veux que je fasse.`,
  ].join("\n");
}
async function pgMicroStart(s) {
  const wl = await window.olympus.pegasusWireList(s.key);
  const versions = (wl.ok && wl.versions) || [];
  const deployed = wl.ok ? wl.deployed : null;
  const drafts = versions.filter((v) => v.id !== deployed).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const launch = async (which, label) => {
    const r = await window.olympus.pegasusWorkOn(s.key, pgMicroPrompt(s, which, label));
    const msg = $("pgWorkMsg");
    if (r.ok && msg) { msg.className = "msg ok"; msg.textContent = "Projet ouvert en local + conversation Claude lancée — " + (which === "actuelle" ? "version actuelle du site." : "version en cours de modification."); }
    if (!r.ok) alert("Échec : " + (r.error || ""));
  };
  // Pas de version en cours → directement sur la version actuelle du site
  if (!drafts.length) { if (confirm("Ouvrir le projet en local + une conversation avec Claude (version actuelle du site) ?")) await launch("actuelle"); return; }
  // Sinon : proposer entre la version en ligne et celle en cours de modification
  const draft = drafts[0];
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  ov.innerHTML = `
    <div class="modal-panel" style="width:600px;">
      <div class="modal-head"><h2>Sur quelle version travailler ?</h2><button class="modal-x" data-x aria-label="Fermer">✕</button></div>
      <div class="modal-body">
        <p class="pg-mnote" style="margin-top:0;">Tu as une version en cours de modification. Sur laquelle faire les retouches ? Dans les deux cas, j'ouvre le projet en local et une conversation en contexte.</p>
        <div class="wk-choices">
          <button class="wk-choice" data-w="actuelle"><div class="wk-t">🌐 Version actuelle du site</div><div class="wk-d">L'état réellement en ligne aujourd'hui.</div></button>
          <button class="wk-choice" data-w="modif"><div class="wk-t">✏️ Version en cours de modification</div><div class="wk-d">Ta dernière version de travail : « ${escapeHtml(draft.label || "Sans nom")} ».</div></button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelectorAll(".wk-choice").forEach((b) => b.onclick = async () => {
    ov.querySelectorAll(".wk-choice").forEach((x) => x.disabled = true);
    await launch(b.dataset.w, draft.label);
    close();
  });
}
// Ouvre l'arborescence ou le moodboard EN MODALE (on reste dans le pipeline).
// Les fonctions de rendu ciblent #pgArbo / #pgMood → on leur fournit ces conteneurs
// dans la modale (l'onglet pipeline ne les a pas, donc pas de collision).
function pgOpenViewModal(s, which) {
  const isArbo = which === "arbo";
  const ov = document.createElement("div");
  ov.className = "modal-overlay show pg-viewmodal";
  ov.innerHTML = `
    <div class="modal-panel pg-viewpanel">
      <div class="modal-head"><h2>${isArbo ? "Arborescence" : "Moodboard"}</h2><button class="modal-x" data-x aria-label="Fermer">✕</button></div>
      <div class="modal-body pg-viewbody">
        <div id="${isArbo ? "pgArbo" : "pgMood"}"><div class="rb-empty">Chargement…</div></div>
      </div>
      <div class="modal-foot"><button class="cal-btn primary pg-viewsave" data-save>✓ Enregistrer les modifications</button></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); pgPipelineRender(s); }; // les modifs sont déjà auto-enregistrées ; on rafraîchit le pipeline
  ov.querySelector("[data-x]").onclick = close;
  ov.querySelector("[data-save]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  if (isArbo) pgArboRender(s); else pgMoodRender(s);
}
async function pgPipelineRender(s) {
  const box = $("pgPipeline"); if (!box) return;
  if (!pgPlCache[s.key]) {
    const r = await window.olympus.pegasusPipelineGet(s.key);
    pgPlCache[s.key] = (r.ok && r.pipeline) || null;
  }
  const pl = pgPlCache[s.key];

  // ── Pas encore de pipeline : choisir le mode de travail ──
  // « Nouveau site » n'est proposé que pour un nouveau projet (colonne, pas encore
  // en ligne). Un site déjà connecté ne peut être que refait ou retouché.
  if (!pl || !pl.mode) {
    const isExisting = !!s.base_url; // site connecté du Parc = existant
    const modes = {
      nouveau: `<button class="wk-choice" data-mode="nouveau">
          <div class="wk-t">🆕 Nouveau site</div>
          <div class="wk-d">Le site part de zéro. 9 étapes guidées : wireframe → maquette → charte → niveau → références → local → (scène Blender) → génération.</div>
        </button>`,
      refonte: `<button class="wk-choice" data-mode="refonte">
          <div class="wk-t">🔄 Refonte complète</div>
          <div class="wk-d">Le site existe : tout est prérempli depuis le site réel (wireframe scanné, charte extraite), et tu reprends chaque étape pour le réinventer.</div>
        </button>`,
      micro: `<button class="wk-choice" data-mode="micro">
          <div class="wk-t">🔧 Micro-modifications</div>
          <div class="wk-d">Tout est prérempli — tu fais des retouches ponctuelles quand nécessaire, sans suivre de pipeline.</div>
        </button>`,
    };
    const offre = isExisting ? [modes.refonte, modes.micro] : [modes.nouveau];
    box.innerHTML = `
      <div class="pl-layout">
      <div class="pl-main">
        <p class="pg-mnote">Comment veux-tu travailler sur <b>${escapeHtml(s.label)}</b> ?${isExisting ? " Ce site est déjà en ligne — tu peux le refondre entièrement ou y faire des retouches." : ""} Le pipeline te guide étape par étape — chaque étape peut être passée ou confiée à l'IA, et tu génères le site quand tu veux.</p>
        <div class="wk-choices" style="max-width:640px;">${offre.join("")}</div>
      </div>
      <div class="ab-versions" id="plVersions"><div class="rb-empty">Versions…</div></div>
      </div>`;
    box.querySelectorAll(".wk-choice").forEach((b) => b.onclick = () => {
      pgPlCache[s.key] = pgPlNew(b.dataset.mode);
      pgPlSave(s.key); pgPipelineRender(s);
    });
    if (isExisting) pgSiteVersionsCol(s);
    return;
  }

  // ── Micro-modifications : ouvrir le projet en local + conversation contextualisée ──
  if (pl.mode === "micro") {
    box.innerHTML = `
      <div class="pl-layout">
      <div class="pl-main">
        <p class="pg-mnote">Mode <b>micro-modifications</b> : j'ouvre le projet en local et une conversation avec moi, en contexte. Dis-moi les retouches à faire, je les applique en local — le site en ligne n'est pas touché.</p>
        <div class="pl-shortcuts">
          <button class="pg-bigbtn" id="plMicroStart"><span class="t">Ouvrir le projet + discuter avec Claude</span><span class="d">local + conversation en contexte</span></button>
        </div>
        <div style="margin-top:18px;"><button class="btn sec" id="plReset">Changer de mode de travail</button></div>
      </div>
      <div class="ab-versions" id="plVersions"><div class="rb-empty">Versions…</div></div>
      </div>`;
    $("plMicroStart").onclick = () => pgMicroStart(s);
    $("plReset").onclick = () => { if (confirm("Changer de mode ? (les statuts d'étapes seront conservés)")) { pl.mode = null; pgPlSave(s.key); pgPipelineRender(s); } };
    pgSiteVersionsCol(s);
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
  // Versions disponibles pour connecter un wireframe / un moodboard au pipeline
  const [wl, ml] = await Promise.all([window.olympus.pegasusWireList(s.key), window.olympus.pegasusMbList(s.key)]);
  const connOpts = (r, sel) => {
    const versions = (r.ok && r.versions) || []; const dep = r.ok ? r.deployed : null;
    const list = versions.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return `<option value="">— choisir —</option>` + list.map((v) =>
      `<option value="${v.id}" ${sel === v.id ? "selected" : ""}>${escapeHtml(v.label || "Sans nom")}${v.id === dep ? " (copie en ligne)" : ""}</option>`).join("");
  };
  const connectHTML = (which) => {
    const r = which === "wire" ? wl : ml;
    const sel = which === "wire" ? pl.wireId : pl.moodId;
    return `<div class="pl-connect">
      <span class="pl-connect-l">${which === "wire" ? "Wireframe connecté" : "Moodboard connecté"}</span>
      <select class="pl-select" data-connect="${which}">${connOpts(r, sel)}</select>
    </div>`;
  };

  box.innerHTML = `
    <div class="pl-layout">
    <div class="pl-main">
    <div class="pl-head">
      <div class="pl-progress"><div class="pl-bar" style="width:${Math.round((remplies / PL_ETAPES.length) * 100)}%"></div></div>
      <span class="pl-count">${remplies}/${PL_ETAPES.length} étapes remplies · mode ${pl.mode === "nouveau" ? "nouveau site" : "refonte"}</span>
      <button class="cal-btn primary" id="plGen">⚡ Générer le site</button>
      <button class="btn sec" id="plReset" title="Revenir au choix du mode">Mode…</button>
    </div>
    <button class="pl-advance" id="plAdvance">
      <span class="pl-adv-ic">✨</span>
      <span class="pl-adv-txt"><b>Avancer avec Claude</b><span>J'ouvre une conversation avec tout le contexte du site et je te guide, question par question — tu peux passer une étape à tout moment.</span></span>
      <span class="pl-adv-go">Démarrer →</span>
    </button>
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
          ${!na && e.connect ? connectHTML(e.connect) : ""}
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
    </div>
    <div class="pl-end">
      <div class="pl-end-t">Et ensuite ?</div>
      <div class="wk-choices">
        <button class="wk-choice" id="plEndGen">
          <div class="wk-t">🚀 Lancer la création du site</div>
          <div class="wk-d">Génère le site en local depuis le wireframe et le moodboard (tu choisiras génération automatique ou manuelle).</div>
        </button>
        <button class="wk-choice" id="plEndSave">
          <div class="wk-t">💾 Enregistrer et reprendre plus tard</div>
          <div class="wk-d">Tout est déjà sauvegardé. Ferme quand tu veux et reprends le pipeline exactement où tu l'as laissé.</div>
        </button>
      </div>
      ${pl.savedAt ? `<div class="pl-saved">✓ Projet enregistré le ${new Date(pl.savedAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} — tu peux reprendre à tout moment.</div>` : ""}
    </div>
    </div>
    <div class="ab-versions" id="plVersions"><div class="rb-empty">Versions…</div></div>
    </div>`;

  pgSiteVersionsCol(s);

  const gen = async () => {
    const manquantes = PL_ETAPES.filter((e) => {
      const na = e.n34 && niveau && niveau <= 2;
      return !na && e.id !== "generation" && (et[e.id]?.statut || "afaire") === "afaire";
    });
    if (manquantes.length && !confirm(`Étapes non remplies : ${manquantes.map((e) => e.titre).join(", ")}.\n\nTu peux générer quand même, mais le résultat pourra s'éloigner de tes attentes. Continuer ?`)) return;
    const wr = await window.olympus.pegasusWireList(s.key);
    const vs = ((wr.ok && wr.versions) || []).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    if (!vs.length) { alert("Aucun wireframe. Ouvre l'arborescence et crée un wireframe d'abord."); return; }
    // Génère depuis le wireframe CONNECTÉ (sinon le plus récent) + le moodboard connecté
    const target = (pl.wireId && vs.find((v) => v.id === pl.wireId)) || vs[0];
    pgWireWorkModal(s, target, pl.moodId || null);
  };
  $("plGen").onclick = gen;
  $("plEndGen").onclick = gen;
  $("plEndSave").onclick = () => {
    pl.savedAt = Date.now(); pgPlSave(s.key);
    const msg = $("pgWorkMsg");
    if (msg) { msg.className = "msg ok"; msg.textContent = "Projet enregistré — tout est sauvegardé (pipeline + versions du site), tu peux fermer et reprendre quand tu veux."; }
    pgPipelineRender(s);
  };
  $("plReset").onclick = () => { pl.mode = null; pgPlSave(s.key); pgPipelineRender(s); };
  $("plAdvance").onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true;
    const r = await window.olympus.pegasusPipelineDiscuss(s.key, pgPipelineAdvancePrompt(s, pl, niveau));
    btn.disabled = false;
    const msg = $("pgWorkMsg");
    if (r.ok && msg) { msg.className = "msg ok"; msg.textContent = "Conversation Claude ouverte — je te guide étape par étape dans le terminal."; }
    if (!r.ok) alert("Échec : " + (r.error || ""));
  };

  box.querySelectorAll(".pl-step").forEach((el) => {
    const e = PL_ETAPES.find((x) => x.id === el.dataset.e);
    const st = () => et[e.id] || (et[e.id] = { statut: "afaire" });
    el.querySelectorAll(".pl-acts .pl-b").forEach((b) => b.onclick = async () => {
      const act = b.dataset.act;
      if (act === "open") { pgOpenViewModal(s, e.vue); return; }
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
    // Connecter un wireframe / un moodboard au pipeline
    const sel = el.querySelector(".pl-select");
    if (sel) sel.onchange = () => {
      if (sel.dataset.connect === "wire") pl.wireId = sel.value || null;
      else pl.moodId = sel.value || null;
      pgPlSave(s.key);
    };
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
const pgMoodSaveT = {};                                      // idem : un debounce par site (pas de perte inter-site)
function pgMoodSave(key) {
  clearTimeout(pgMoodSaveT[key]);
  pgMoodSaveT[key] = setTimeout(() => window.olympus.pegasusMoodboardSave(key, pgMoodCache[key]), 400);
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

function pgTabFiche(s) {
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

// ══════════ GÉNÉRAL — aperçu du site : modifier + rapports + arbo en ligne + moodboard ══════════
async function pgGeneralRender(s) {
  const box = $("pgGeneral"); if (!box) return;
  box.innerHTML = `
    <button class="pg-modbtn" id="pgModify">
      <span class="pg-modbtn-i">✎</span>
      <span class="pg-modbtn-txt"><b>Modifier le site</b><span>Ouvre le site en local et démarre une conversation avec Claude</span></span>
      <span class="pg-modbtn-arr">→</span>
    </button>
    <div class="pg-ovcard">
      <div class="pg-ovh">Rapports<button class="pg-ovlink" data-goto="rapport">Voir le rapport complet →</button></div>
      <div class="pg-ovbody" id="ovReports"><div class="rb-empty">Lecture…</div></div>
    </div>
    <div class="pg-ovcard">
      <div class="pg-ovh">Arborescence du site en ligne<button class="pg-ovlink" data-goto="arbo">Ouvrir l'arborescence →</button></div>
      <div class="pg-ovbody" id="ovArbo"><div class="rb-empty">Lecture…</div></div>
    </div>
    <div class="pg-ovcard">
      <div class="pg-ovh">Moodboard actuel<button class="pg-ovlink" data-goto="mood">Ouvrir le moodboard →</button></div>
      <div class="pg-ovbody" id="ovMood"><div class="rb-empty">Lecture…</div></div>
    </div>`;
  $("pgModify").onclick = () => pgModifySiteModal(s);
  box.querySelectorAll(".pg-ovlink").forEach((b) => b.onclick = () => { pgSiteTab = b.dataset.goto; pgRenderSide(); pgRenderDetail(); });
  pgOvReports(s); pgOvArbo(s); pgOvMood(s);
}

async function pgOvReports(s) {
  const box = $("ovReports"); if (!box) return;
  const m = (await pgLoadMetrics(s.key)) || pgMetrics[s.key] || { seo: [], perf: [], secu: [] };
  const data = pgReportData(m, 30);
  const pk = s.key + ":peg:30";
  if (pgAudCache[pk] === undefined) { try { pgAudCache[pk] = await window.olympus.pegasusAudiencePegasus(s.key, 30); } catch { pgAudCache[pk] = { ok: false }; } }
  const aud = pgAudCache[pk] && pgAudCache[pk].ok ? pgAudCache[pk].data : null;
  const g = (label, arr, color) => arr.length
    ? `<div class="pg-ovmini"><div class="pg-gwrap">${pgGauge(arr[arr.length - 1].score, 100, color)}</div><div class="pg-ovmini-l">${label}</div></div>`
    : `<div class="pg-ovmini"><div class="pg-ovmini-v dim">—</div><div class="pg-ovmini-l">${label}</div></div>`;
  if (!data.seo.length && !data.perf.length && !data.secu.length && !(aud && aud.total)) {
    box.innerHTML = `<div class="rb-empty">Pas encore de données. Lance les analyses SEO, Performance et Sécurité (elles s'enregistrent toutes seules) — l'audience se remplit au fil des visites.</div>`;
    return;
  }
  box.innerHTML = `<div class="pg-ovreports">
    ${g("SEO", data.seo, "var(--accent2)")}
    ${g("Performance", data.perf, "#7fb2e8")}
    ${g("Sécurité", data.secu, "var(--ok)")}
    <div class="pg-ovmini"><div class="pg-ovmini-v">${aud && aud.total ? pgFmtN(aud.total) : "—"}</div><div class="pg-ovmini-l">Visites · 30 j</div></div>
  </div>`;
}

async function pgOvArbo(s) {
  const box = $("ovArbo"); if (!box) return;
  let arbo = null;
  const r = await window.olympus.pegasusWireList(s.key);
  if (r.ok && r.deployed) { const lr = await window.olympus.pegasusWireLoad(s.key, r.deployed); if (lr.ok) arbo = lr.arbo; }
  if (!arbo) { const ag = await window.olympus.pegasusArboGet(s.key); if (ag.ok) arbo = ag.arbo; }
  const pages = (arbo && arbo.pages) || [];
  if (!pages.length) {
    box.innerHTML = `<div class="rb-empty">Aucune arborescence pour l'instant. Ouvre l'onglet <b>Arborescence</b> : Pegasus peut scanner le site et générer la structure en ligne, déjà câblée.</div>`;
    return;
  }
  box.innerHTML = `<div class="pg-ovtree">${pages.map((p) => `
    <div class="pg-ovpage">
      <div class="pg-ovpage-t">${p.home ? "🏠 " : ""}${escapeHtml(p.titre || "Sans titre")}<span class="pg-ovpage-n">${(p.sections || []).length} section(s)</span></div>
      ${(p.sections || []).length ? `<div class="pg-ovsecs">${p.sections.map((sec, i) => `<span class="pg-ovsec">${i + 1} · ${escapeHtml(sec.titre || "section")}</span>`).join("")}</div>` : ""}
    </div>`).join("")}</div>`;
}

async function pgOvMood(s) {
  const box = $("ovMood"); if (!box) return;
  let mb = null;
  const r = await window.olympus.pegasusMbList(s.key);
  if (r.ok && r.deployed) { const lr = await window.olympus.pegasusMbLoad(s.key, r.deployed); if (lr.ok) mb = lr.moodboard; }
  if (!mb) { const mg = await window.olympus.pegasusMoodboardGet(s.key); if (mg.ok) mb = mg.moodboard; }
  if (!mb || (!(mb.couleurs || []).length && !(mb.typos || []).length && !mb.logo && !(mb.refs || []).length && !mb.niveau)) {
    box.innerHTML = `<div class="rb-empty">Pas encore de charte graphique. Ouvre l'onglet <b>Moodboard</b> pour la définir (couleurs, typographies, logo, niveau).</div>`;
    return;
  }
  const NIV = { 1: "N1 · Premium", 2: "N2 · Luxe", 3: "N3 · Luxe supérieur", 4: "N4 · Ultra luxe" };
  const parts = [];
  if (mb.niveau) parts.push(`<div class="pg-ovmrow"><span class="pg-ovmk">Niveau</span><span class="pg-ovmv">${NIV[mb.niveau] || mb.niveau}</span></div>`);
  if ((mb.couleurs || []).length) parts.push(`<div class="pg-ovmrow"><span class="pg-ovmk">Couleurs</span><span class="pg-ovmv pg-ovswatches">${mb.couleurs.map((c) => `<span class="pg-ovsw" title="${escapeHtml((c.nom || "") + " " + (c.hex || ""))}" style="background:${escapeHtml(c.hex || "#ccc")}"></span>`).join("")}</span></div>`);
  if ((mb.typos || []).length) parts.push(`<div class="pg-ovmrow"><span class="pg-ovmk">Typos</span><span class="pg-ovmv">${mb.typos.map((t) => escapeHtml(t.nom || t.role || "?")).filter(Boolean).join(" · ")}</span></div>`);
  if (mb.logo) parts.push(`<div class="pg-ovmrow"><span class="pg-ovmk">Logo</span><span class="pg-ovmv">${/^https?:|^\/|\.(svg|png|jpe?g|webp)$/i.test(mb.logo) ? `<img class="pg-ovlogo" src="${escapeHtml(mb.logo)}" alt="logo">` : escapeHtml(mb.logo)}</span></div>`);
  if ((mb.refs || []).length) parts.push(`<div class="pg-ovmrow"><span class="pg-ovmk">Références</span><span class="pg-ovmv">${mb.refs.length} référence(s)</span></div>`);
  box.innerHTML = `<div class="pg-ovmood">${parts.join("")}</div>`;
}

// Gros bouton « Modifier le site » : ouvre le local + une conversation Claude.
// Propose de continuer une modification en cours (dossier local présent) ou de
// repartir de la version actuelle du site en ligne (copie fraîche).
async function pgModifySiteModal(s) {
  const slug = s.host || s.key;
  const ov = document.createElement("div");
  ov.className = "modal-overlay show";
  ov.innerHTML = `<div class="modal-panel" style="width:600px;">
      <div class="modal-head"><h2>Modifier « ${escapeHtml(s.label)} »</h2><button class="modal-x" data-x aria-label="Fermer">✕</button></div>
      <div class="modal-body"><div class="rb-empty">Vérification du dossier local…</div></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const st = await window.olympus.pegasusFolderExists(slug);
  const body = ov.querySelector(".modal-body");
  const promptBase = `Tu ouvres le site « ${s.label} » (${s.base_url}) en local pour le modifier. Le contexte est dans ce dossier : le site local (wordpress/ ou les .html), et si présents arborescence.json (structure + sections), moodboard.json (charte) et pipeline.json. Lis-les d'abord. Puis demande-moi ce que je veux changer et applique les modifications proprement.`;
  const choices = [];
  if (st.exists) {
    choices.push({ mode: "continue", t: "▶ Continuer la modification en cours", d: "Reprend le dossier local tel quel, avec les changements déjà commencés." });
    choices.push({ mode: "fresh", t: "↻ Repartir de la version actuelle du site", d: "Remplace le local par une copie fraîche du site en ligne, puis l'ouvre (les changements locaux non déployés seront perdus)." });
  } else {
    choices.push({ mode: "continue", t: "▶ Ouvrir le site en local + Claude", d: "Télécharge une copie du site en ligne dans le dossier du projet et démarre la conversation." });
  }
  body.innerHTML = `<p class="pg-mnote" style="margin-top:0;">${st.exists ? "Une copie locale de ce site existe déjà." : "Aucune copie locale encore — elle sera téléchargée depuis le site en ligne."} On ouvre le site en local et une conversation Claude démarre.</p>
    <div class="wk-choices">${choices.map((c) => `<button class="wk-choice" data-mode="${c.mode}"><div class="wk-t">${c.t}</div><div class="wk-d">${c.d}</div></button>`).join("")}</div>
    <div class="msg" id="pgModMsg" style="margin-top:14px;"></div>`;
  body.querySelectorAll(".wk-choice").forEach((b) => b.onclick = async () => {
    const mode = b.dataset.mode;
    body.querySelectorAll(".wk-choice").forEach((x) => x.disabled = true);
    const msg = body.querySelector("#pgModMsg"); msg.className = "msg";
    if (mode === "fresh") {
      msg.textContent = "Copie fraîche du site en ligne…";
      const cr = await window.olympus.pegasusCopySite(s.key, "overwrite");
      if (!cr.ok) { msg.className = "msg err"; msg.textContent = cr.error || "Échec de la copie."; body.querySelectorAll(".wk-choice").forEach((x) => x.disabled = false); return; }
    }
    msg.textContent = "Préparation du local + ouverture de Claude Code…";
    const prompt = (mode === "fresh" ? "On repart de la version actuelle du site en ligne. " : st.exists ? "On continue une modification déjà commencée sur ce site. " : "") + promptBase;
    const r = await window.olympus.pegasusWorkOn(s.key, prompt);
    if (!r.ok) { msg.className = "msg err"; msg.textContent = r.error || "Échec."; body.querySelectorAll(".wk-choice").forEach((x) => x.disabled = false); return; }
    msg.className = "msg ok";
    msg.textContent = (r.copied ? "Copie créée. " : "") + (r.mode === "wordpress" ? "WordPress lancé en local + Claude Code ouvert." : r.mode === "static" ? "Site ouvert dans le navigateur + Claude Code ouvert." : "Dossier prêt + Claude Code ouvert.");
    setTimeout(close, 2200);
  });
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
    delete pgInspect[s.key]; delete pgHealth[s.key]; delete pgDiag[s.key];
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
  if (!seo) return `<div class="ga-note">Audit SEO : lecture du HTML rendu de chaque page (title, meta description, H1, canonical, Open Graph, alt, langue) + détection du plugin SEO, sitemap et robots.txt.</div><button class="cal-btn" id="pgSeoBtn" style="margin-top:12px;">Lancer l'audit SEO</button>`;
  if (seo.loading) return `<div class="ga-note">Audit en cours… (lecture du HTML rendu de chaque page)</div>`;
  if (!seo.ok) return `<div class="ga-note">Audit impossible : ${escapeHtml(seo.error || "")}</div><button class="cal-btn" id="pgSeoBtn" style="margin-top:12px;">Réessayer</button>`;
  const a = seo.seo;
  const problemes = Object.values(a.resume_problemes || {}).reduce((n, x) => n + (x || 0), 0);
  const score = Math.max(0, Math.round(100 - (a.pages_auditees ? (problemes / a.pages_auditees) * 20 : 0)));
  const hist = (pgMetrics[s.key]?.seo || []).map((m) => m.score);
  const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
  let html = pgGaHead("SEO", s, "pgSeoBtn");
  html += `<div class="ga-cards">
    ${pgScore("Santé SEO", `${score}<span class="ga-unit">/100</span>`, pgDelta(score, prev))}
    ${pgScore("Problèmes", String(problemes))}
    ${pgScore("Pages auditées", String(a.pages_auditees || 0))}
  </div>`;
  if (hist.length >= 2) html += pgPanel("Tendance de la santé SEO", pgAreaChart(hist.map((v, i) => ({ label: "#" + (i + 1), value: v })), { color: "var(--accent2)" }));
  html += pgPanel("Indexation", pgKV([["Plugin SEO", a.plugin_seo], ["Sitemap", a.sitemap], ["robots.txt", a.robots_txt]]));
  const res = Object.entries(a.resume_problemes || {}).filter(([, n]) => n > 0);
  if (res.length) html += pgPanel(`Problèmes par type · ${a.pages_auditees} page(s)`, pgBreak(res.map(([k, n]) => ({ label: k.replace(/_/g, " "), value: n })), { color: "#e0868f" }));
  else html += pgPanel("Problèmes", `<div class="ga-check"><span class="ga-i ok">✓</span> <span>Aucun problème détecté.</span></div>`);
  const pagesBad = (a.detail || []).filter((p) => p.problemes && p.problemes[0] !== "aucun").slice(0, 12);
  if (pagesBad.length) html += pgPanel("Pages à corriger", pagesBad.map((p) => `<div class="ga-check"><span class="ga-check-p">${escapeHtml(p.page)}</span> <span class="dim">${escapeHtml((p.problemes || []).join(" · "))}</span></div>`).join(""));
  return html;
}

function pgTabPerf(s) {
  const perf = pgPerf[s.key];
  if (!perf) return `<div class="ga-note">Rapport de performance via Google PageSpeed (budgets Orphic : LCP &lt; 2,5 s, CLS &lt; 0,1). L'analyse prend 20 à 60 s.</div><button class="cal-btn" id="pgPerfBtn" style="margin-top:12px;">Lancer l'analyse (mobile)</button>`;
  if (perf.loading) return `<div class="ga-note">Analyse PageSpeed en cours… (20-60 s)</div>`;
  if (!perf.ok) return `<div class="ga-note">Analyse impossible : ${escapeHtml(perf.error || "")}</div><button class="cal-btn" id="pgPerfBtn" style="margin-top:12px;">Réessayer</button>`;
  const p = perf.perf;
  const lcpOk = p.lcp_ms != null ? p.lcp_ms <= 2500 : null;
  const clsOk = p.cls_val != null ? p.cls_val <= 0.1 : null;
  const budget = (ok) => ok == null ? "" : ok ? `<span class="ga-delta up">✓ budget</span>` : `<span class="ga-delta down">✕ hors budget</span>`;
  const hist = (pgMetrics[s.key]?.perf || []).map((m) => m.score);
  const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
  let html = pgGaHead("Performance", s, "pgPerfBtn");
  html += `<div class="ga-cards">
    ${pgScore(`Score perf · ${escapeHtml(p.strategy)}`, `${p.score}<span class="ga-unit">/100</span>`, pgDelta(p.score, prev))}
    ${pgScore("LCP", escapeHtml(p.lcp || "—"), budget(lcpOk))}
    ${pgScore("CLS", escapeHtml(p.cls || "—"), budget(clsOk))}
  </div>`;
  if (hist.length >= 2) html += pgPanel("Tendance du score", pgAreaChart(hist.map((v, i) => ({ label: "#" + (i + 1), value: v })), { color: "#7fb2e8" }));
  html += pgPanel("Métriques détaillées", pgKV([["First Contentful Paint", p.fcp || "—"], ["Total Blocking Time", p.tbt || "—"], ["Speed Index", p.si || "—"]]));
  return html;
}

// Contrôles de sécurité dérivés du diagnostic (partagés onglet + capture métrique)
function pgSecuChecks(s, d) {
  const https = /^https:\/\//i.test(s.base_url);
  const phpV = parseFloat(String(d.site?.php || ""));
  const locks = d.verrous_serveur || {};
  const plugins = d.plugins || [];
  const inactifs = plugins.filter((p) => !p.active);
  const checks = [
    https ? ["ok", "Connexion HTTPS active", ""] : ["err", "Pas de HTTPS", "requis pour sécuriser les identifiants et le référencement"],
    d.site?.debug ? ["err", "Mode debug WordPress ACTIVÉ en production", "expose des chemins et erreurs — à désactiver (WP_DEBUG=false)"] : ["ok", "Mode debug désactivé", ""],
    locks.DISALLOW_FILE_EDIT ? ["ok", "Éditeur de fichiers du back-office désactivé", ""] : ["warn", "Éditeur de thème/plugin actif dans wp-admin", "un compte admin compromis peut injecter du PHP — verrouiller avec DISALLOW_FILE_EDIT"],
    phpV >= 8.1 ? ["ok", `PHP ${escapeHtml(String(d.site?.php))}`, "version maintenue"] : ["warn", `PHP ${escapeHtml(String(d.site?.php || "?"))}`, "fin de vie / bientôt — planifier une montée de version avec l'hébergeur"],
    inactifs.length ? ["warn", `${inactifs.length} extension(s) inactive(s)`, "à supprimer : même inactives, elles restent une surface d'attaque"] : ["ok", "Aucune extension inactive qui traîne", ""],
    d.multisite ? ["warn", "Installation multisite", "surface et droits élargis — à surveiller"] : null,
  ].filter(Boolean);
  const nOk = checks.filter((c) => c[0] === "ok").length;
  return { checks, nOk, nBad: checks.length - nOk, https, phpV, plugins, inactifs };
}
function pgTabSecu(s) {
  const dg = pgDiag[s.key];
  if (!dg) return `<div class="rb-empty">Analyse de sécurité en cours…</div>`;
  if (!dg.ok) return `<div class="rb-empty">Analyse impossible : ${escapeHtml(dg.error || "")}</div><button class="cal-btn" id="pgSecuBtn" style="margin-top:8px;">Réessayer</button>`;
  const d = dg.diag;
  const { checks, nOk, nBad, plugins, inactifs } = pgSecuChecks(s, d);
  const score = Math.round((nOk / (checks.length || 1)) * 100);
  const hist = (pgMetrics[s.key]?.secu || []).map((m) => m.score);
  const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
  const ico = { ok: '<span class="ga-i ok">✓</span>', warn: '<span class="ga-i warn">!</span>', err: '<span class="ga-i err">✕</span>' };
  let html = pgGaHead("Sécurité", s, "pgSecuBtn");
  html += `<div class="ga-cards">
    ${pgScore("Contrôles au vert", `${nOk}<span class="ga-unit">/${checks.length}</span>`, pgDelta(score, prev))}
    ${pgScore("À traiter", String(nBad))}
    ${pgScore("Score sécurité", `${score}<span class="ga-unit">/100</span>`)}
  </div>`;
  if (hist.length >= 2) html += pgPanel("Tendance du score", pgAreaChart(hist.map((v, i) => ({ label: "#" + (i + 1), value: v })), { color: "var(--ok)" }));
  html += pgPanel("Contrôles", checks.map(([st, label, detail]) => `<div class="ga-check">${ico[st]} <span>${label}${detail ? ` <span class="dim">— ${detail}</span>` : ""}</span></div>`).join(""));
  const caps = d.capacites_pegasus || {};
  html += pgPanel("Ce que Pegasus peut toucher", pgKV([["Contenus", caps.ecrire_contenus ? "lecture + écriture" : "lecture seule"], ["Thèmes / extensions", caps.installer_themes ? "installation possible" : "verrouillé"]]));
  const actifs = plugins.filter((p) => p.active);
  let extList = actifs.map((p) => `<div class="ga-kv-r"><span>${escapeHtml(p.name)}</span><b>${escapeHtml(p.version || "?")}</b></div>`).join("");
  if (inactifs.length) extList += `<div class="ga-kv-r"><span class="dim">+ ${inactifs.length} inactive(s) — surface d'attaque à supprimer</span><b></b></div>`;
  html += pgPanel(`Extensions actives · ${actifs.length}`, `<div class="ga-kv">${extList}</div>`);
  return html;
}
async function pgLoadDiag(key) {
  pgDiag[key] = null;
  const r = await window.olympus.pegasusSiteDiag(key);
  pgDiag[key] = r;
  if (r.ok && r.diag) {
    const s = pgSites.find((x) => x.key === key) || { base_url: "", key };
    const c = pgSecuChecks(s, r.diag);
    const score = Math.round((c.nOk / (c.checks.length || 1)) * 100);
    await pgCaptureMetric(key, "secu", { score, ok: c.nOk, bad: c.nBad });
  }
  if (pgSel === key && pgSiteTab === "secu") pgRenderDetail();
}

// ══════════ RAPPORT — tableau de bord dans le temps + analyse + export PDF ══════════
let pgRapportPeriod = 30;
const pgSlugish = (s) => String(s || "site").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
function pgWithin(arr, days) {
  if (!days) return arr.slice();
  const cut = Date.now() - days * 86400000;
  return (arr || []).filter((m) => new Date(m.ts).getTime() >= cut);
}
function pgReportData(m, days) {
  return { seo: pgWithin(m.seo || [], days), perf: pgWithin(m.perf || [], days), secu: pgWithin(m.secu || [], days) };
}
// Analyse « chiffres → sens » : état, tendance, priorités. Renvoie des blocs.
function pgReportAnalysis(data, aud) {
  const blocs = [];
  const trendTxt = (t) => !t ? "" : t.dir === "stable" ? " — stable sur la période" : t.good ? ` — en amélioration (${t.txt})` : ` — en dégradation (${t.txt})`;
  if (aud && aud.total) {
    const lignes = [`<b>${aud.total}</b> visite(s) pour <b>${aud.uniques}</b> visiteur(s) unique(s) sur la période.`];
    const top = aud.sources && aud.sources[0];
    if (top) lignes.push(`Première source de trafic : <b>${top.label}</b> (${top.value} visite(s)).`);
    if (aud.pages && aud.pages[0]) lignes.push(`Page la plus consultée : ${aud.pages[0].label} (${aud.pages[0].value} vue(s)).`);
    const mob = (aud.devices || []).find((x) => x.label === "mobile");
    if (mob) lignes.push(`${Math.round(mob.value / aud.total * 100)} % des visites depuis un mobile.`);
    blocs.push({ titre: "Audience", lignes });
  }
  if (data.seo.length) {
    const l = data.seo[data.seo.length - 1], t = pgTrend(data.seo.map((x) => x.score), false);
    const lignes = [`Santé SEO à <b>${l.score}/100</b> sur ${l.pages} page(s) auditée(s)${trendTxt(t)}.`];
    if (l.problemes) lignes.push(`${l.problemes} problème(s) SEO relevé(s) — titres, méta-descriptions, H1, canonical ou balises Open Graph à compléter, page par page dans l'onglet SEO.`);
    else lignes.push("Aucun problème SEO majeur détecté.");
    if (!l.sitemap) lignes.push("⚠ Pas de sitemap détecté — à activer pour l'indexation.");
    if (!l.robots) lignes.push("⚠ robots.txt absent.");
    blocs.push({ titre: "Référencement (SEO)", score: l.score, lignes });
  }
  if (data.perf.length) {
    const l = data.perf[data.perf.length - 1], t = pgTrend(data.perf.map((x) => x.score), false);
    const lignes = [`Score de performance <b>${l.score}/100</b> (${l.strategy})${trendTxt(t)}.`];
    if (l.lcp != null) lignes.push(`LCP ${(l.lcp / 1000).toFixed(1)} s ${l.lcp <= 2500 ? "✓ dans le budget Orphic (< 2,5 s)" : "✕ hors budget (> 2,5 s) — optimiser images/police/hébergement"}.`);
    if (l.cls != null) lignes.push(`CLS ${l.cls.toFixed(2)} ${l.cls <= 0.1 ? "✓ stable" : "✕ mise en page instable — réserver les tailles d'images/embeds"}.`);
    blocs.push({ titre: "Performance", score: l.score, lignes });
  }
  if (data.secu.length) {
    const l = data.secu[data.secu.length - 1], t = pgTrend(data.secu.map((x) => x.score), false);
    const lignes = [`Score de sécurité <b>${l.score}/100</b> — ${l.ok} contrôle(s) au vert, <b>${l.bad}</b> à traiter${trendTxt(t)}.`];
    if (l.bad) lignes.push("Points ouverts détaillés dans l'onglet Sécurité (verrou de l'éditeur de fichiers, version PHP, extensions inactives…).");
    else lignes.push("Tous les contrôles de sécurité passent.");
    blocs.push({ titre: "Sécurité", score: l.score, lignes });
  }
  return blocs;
}
function pgReportBody(s, data, days, aud, perLabel) {
  const blocs = pgReportAnalysis(data, aud);
  const card = (label, arr) => {
    if (!arr.length) return "";
    const l = arr[arr.length - 1];
    const prev = arr.length >= 2 ? arr[arr.length - 2].score : null;
    return pgScore(label, `${l.score}<span class="ga-unit">/100</span>`, pgDelta(l.score, prev));
  };
  let cards = card("SEO", data.seo) + card("Performance", data.perf) + card("Sécurité", data.secu);
  if (aud && aud.total) cards += pgScore("Visites", pgFmtN(aud.total), "", aud.uniques + " visiteur(s) unique(s)");
  let html = cards ? `<div class="ga-cards">${cards}</div>` : "";
  if (aud && aud.total) {
    if ((aud.byDay || []).length >= 2) html += pgPanel("Visites par jour", pgAreaChart(aud.byDay.map((x) => ({ label: pgDayLabel(x.date), value: x.hits }))));
    if (aud.sources?.length) html += pgPanel("Provenance", pgBreak(aud.sources.map((x) => ({ label: x.label, value: x.value })), { total: aud.total }));
  }
  html += pgPanel("Analyse", blocs.length ? blocs.map((b) => `<div class="ga-anz"><div class="ga-anz-t">${escapeHtml(b.titre)}</div>${b.lignes.map((x) => `<div class="ga-anz-l">${x}</div>`).join("")}</div>`).join("") : `<div class="dim">Pas encore d'analyse — lance les analyses ou attends le prochain rapport.</div>`);
  return html;
}
function pgReportPdfHTML(s, data, days, aud, perLabel) {
  const per = perLabel || (days ? `${days} derniers jours` : "tout l'historique");
  const C = { acc: "#7a1b28", ok: "#2e7d32", warn: "#b7791f", err: "#c62828", blue: "#3a6ea5" };
  const dom = (label, arr, color) => {
    if (!arr.length) return "";
    const l = arr[arr.length - 1];
    return `<div class="dom"><h2>${label}</h2>
      <div class="row"><div class="gauge">${pgGauge(l.score, 100, color)}<div class="cap">Score actuel</div></div>
      <div class="spark">${pgSparkline(arr.map((x) => x.score), color)}<div class="cap">Évolution sur la période (${arr.length} mesures)</div></div></div></div>`;
  };
  const audPdf = aud && aud.total ? `<div class="dom"><h2>Audience — visites</h2>
      <div class="row"><div class="kpis">
        <div class="kpi"><div class="kn">${pgFmtN(aud.total)}</div><div class="cap">Visites</div></div>
        <div class="kpi"><div class="kn">${pgFmtN(aud.uniques)}</div><div class="cap">Visiteurs uniques</div></div>
      </div><div class="spark">${pgSparkline((aud.byDay || []).map((x) => x.hits), C.acc)}<div class="cap">Visites par jour · mesuré par Pegasus</div></div></div>
      ${aud.sources?.length ? `<div class="cap" style="margin:10px 0 4px">Provenance</div>${pgBars(aud.sources.map((x) => ({ label: x.label, value: x.value, color: C.acc })))}` : ""}</div>` : "";
  const blocs = pgReportAnalysis(data, aud);
  const now = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1c;font-size:13px;line-height:1.55;padding:8px 4px}
    .head{border-bottom:3px solid ${C.acc};padding-bottom:14px;margin-bottom:22px}
    .head .brand{color:${C.acc};font-weight:800;letter-spacing:.14em;font-size:12px}
    .head h1{font-size:24px;margin:6px 0 3px;font-weight:700}
    .head .meta{color:#666;font-size:12px}
    h2{font-size:15px;margin:0 0 10px;color:${C.acc}}
    .dom{border:1px solid #e6e6e6;border-radius:12px;padding:16px 18px;margin-bottom:16px;break-inside:avoid}
    .row{display:flex;gap:26px;align-items:center}
    .gauge{width:150px;text-align:center;flex-shrink:0}
    .spark{flex:1}
    .cap{color:#777;font-size:11px;margin-top:4px}
    .pg-gauge{width:130px;height:78px}
    .pg-spark{width:100%;height:56px}
    .anz{margin-bottom:14px;break-inside:avoid}
    .anz h3{font-size:13.5px;margin-bottom:4px;color:#111}
    .anz p{margin:3px 0;color:#333}
    .sec-title{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#999;margin:24px 0 12px;border-top:1px solid #eee;padding-top:14px}
    .foot{margin-top:28px;border-top:1px solid #eee;padding-top:12px;color:#999;font-size:11px;text-align:center}
    b{color:#111}
    .kpis{width:150px;flex-shrink:0;display:flex;flex-direction:column;gap:12px}
    .kpi{text-align:center}
    .kpi .kn{font-size:30px;font-weight:800;color:${C.acc};line-height:1}
    .pg-bars{margin-top:2px}
    .pg-bar-row{display:flex;align-items:center;gap:10px;margin:5px 0;font-size:12px}
    .pg-bar-l{width:130px;flex-shrink:0;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pg-bar-track{flex:1;height:9px;background:#eee;border-radius:5px;overflow:hidden}
    .pg-bar-fill{display:block;height:100%;border-radius:5px}
    .pg-bar-v{width:44px;text-align:right;color:#666;flex-shrink:0}
  </style></head><body>
    <div class="head"><div class="brand">ORPHIC AGENCY</div><h1>Rapport — ${escapeHtml(s.label)}</h1>
      <div class="meta">Période : ${per} · Édité le ${now} · ${escapeHtml(s.base_url || "")}</div></div>
    ${audPdf}
    ${dom("Référencement (SEO)", data.seo, C.acc)}
    ${dom("Performance", data.perf, C.blue)}
    ${dom("Sécurité", data.secu, C.ok)}
    <div class="sec-title">Analyse</div>
    ${blocs.map((b) => `<div class="anz"><h3>${b.titre}</h3>${b.lignes.map((x) => `<p>${x}</p>`).join("")}</div>`).join("") || "<p>Pas encore de données sur la période.</p>"}
    <div class="foot">Généré par Pegasus · Olympus — Orphic Agency, Monaco</div>
  </body></html>`;
}
async function pgRapportRender(s) {
  const box = $("pgRapport"); if (!box) return;
  box.innerHTML = `
    <div class="ga-head"><div class="ga-head-t"><h2>Rapport</h2><span>${escapeHtml(s.label)} · bilan complet généré chaque jour à 18 h</span></div></div>
    <div class="ga-subhead" style="margin-top:0;border-top:none;padding-top:0;">Rapports quotidiens</div>
    <div id="pgRapCards"><div class="ga-note">Lecture des rapports…</div></div>
    <div id="pgRapMain"></div>`;
  const r = await window.olympus.pegasusReportsList(s.key);
  pgRapCardsRender(s, r);
  pgRapLatestRender(s, r);
}

// Cartes des rapports quotidiens (générés côté site à 18 h Paris, stockés dans Supabase)
function pgRapCardsRender(s, r) {
  const box = $("pgRapCards"); if (!box) return;
  if (!r.ok && r.missing_table) {
    window.olympus.pegasusReportsSetup().then((setup) => {
      box.innerHTML = `<div class="pg-setup">
        <p><b>Les rapports quotidiens ne sont pas encore activés.</b><br>Une table Supabase doit être créée une seule fois. Colle le SQL <kbd>reports.sql</kbd> dans le SQL Editor du Supabase Pegasus — ensuite chaque site pousse son rapport tout seul à 18 h.</p>
        <div class="act">${setup.sql ? '<button class="cal-btn primary" id="rpSqlCopy">Copier le SQL</button>' : ""}${setup.editor ? `<button class="btn sec pg-open" data-url="${escapeHtml(setup.editor)}" style="padding:8px 16px;font-size:12.5px;">Ouvrir le SQL Editor ↗</button>` : ""}</div>
        <div class="msg" id="rpSqlMsg"></div></div>`;
      const cp = $("rpSqlCopy"); if (cp) cp.onclick = async () => { await navigator.clipboard.writeText(setup.sql); const m = $("rpSqlMsg"); m.className = "msg ok"; m.textContent = "SQL copié — colle-le dans le SQL Editor, exécute, puis reviens."; };
      box.querySelectorAll(".pg-open").forEach((b) => b.onclick = () => window.olympus.openExternal(b.dataset.url));
    });
    return;
  }
  if (!r.ok) { box.innerHTML = `<div class="rb-empty">${escapeHtml(r.error || "Indisponible.")}</div>`; return; }
  const reports = r.reports || [];
  const genRow = `<div class="pg-actrow" style="margin-bottom:12px;"><button class="btn sec" id="rpGenNow" title="Génère le rapport d'aujourd'hui immédiatement">⚡ Générer maintenant</button><span class="msg" id="rpGenMsg"></span></div>`;
  if (!reports.length) {
    box.innerHTML = `<div class="rb-empty" style="margin-bottom:12px;">Aucun rapport encore. Ils se génèrent automatiquement chaque jour à 18 h (heure française). Tu peux aussi lancer le premier maintenant.</div>${genRow}`;
    pgWireRpGen(s); return;
  }
  const chip = (label, score) => {
    if (score == null) return `<span class="rp-chip dim"><b>—</b>${label}</span>`;
    const cls = score >= 80 ? "ok" : score >= 50 ? "warn" : "err";
    return `<span class="rp-chip ${cls}"><b>${score}</b>${label}</span>`;
  };
  box.innerHTML = genRow + `<div class="rp-cards">${reports.map((rep, i) => {
    const dt = new Date(rep.day + "T12:00:00");
    const date = isNaN(dt) ? rep.day : dt.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
    const vis = rep.audience && rep.audience.total;
    return `<button class="rp-card${i === 0 ? " latest" : ""}" data-i="${i}">
        <div class="rp-card-d">${escapeHtml(date)}${i === 0 ? ' <span class="rp-card-tag">dernier</span>' : ""}</div>
        <div class="rp-card-chips">
          ${chip("SEO", rep.seo && rep.seo.score)}
          ${chip("Perf", rep.perf && rep.perf.score)}
          ${chip("Sécu", rep.secu && rep.secu.score)}
          <span class="rp-chip vis"><b>${vis != null ? pgFmtN(vis) : "—"}</b>Visites</span>
        </div>
      </button>`;
  }).join("")}</div>`;
  box.querySelectorAll(".rp-card").forEach((b) => b.onclick = () => pgReportCardModal(s, reports[+b.dataset.i]));
  pgWireRpGen(s);
}
// État affiché par défaut = le DERNIER rapport (plus d'« état en direct » sauf à la demande)
function pgRapLatestRender(s, r) {
  const box = $("pgRapMain"); if (!box) return;
  if (!r.ok || !(r.reports && r.reports.length)) { box.innerHTML = ""; return; }
  const rep = r.reports[0];
  const data = { seo: rep.seo ? [rep.seo] : [], perf: rep.perf ? [rep.perf] : [], secu: rep.secu ? [rep.secu] : [] };
  const aud = rep.audience || null;
  const dt = new Date(rep.day + "T12:00:00");
  const dLong = isNaN(dt) ? rep.day : dt.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  box.innerHTML = `
    <div class="ga-subhead">Dernier rapport <span>· ${escapeHtml(dLong)}</span></div>
    ${pgReportBody(s, data, 1, aud, "rapport du " + dLong)}
    <div class="pg-actrow" style="margin-top:14px;">
      <button class="cal-btn primary" id="rpLatestPdf">⤓ Exporter en PDF</button>
      <button class="btn sec" id="rpLiveBtn" title="Relance une analyse SEO / performance / sécurité en temps réel">↻ Analyser en direct maintenant</button>
      <span class="msg" id="rpLatestMsg"></span>
    </div>
    <div id="pgRapLive"></div>`;
  $("rpLatestPdf").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "Génération…";
    const rr = await window.olympus.pegasusExportPdf(pgReportPdfHTML(s, data, 1, aud, "rapport du " + dLong), `rapport-${pgSlugish(s.label)}-${rep.day}.pdf`);
    b.disabled = false; b.textContent = "⤓ Exporter en PDF";
    const msg = $("rpLatestMsg");
    if (rr.ok && msg) { msg.className = "msg ok"; msg.textContent = "PDF exporté."; }
    else if (!rr.ok && rr.error !== "Export annulé.") alert("Échec de l'export : " + (rr.error || ""));
  };
  $("rpLiveBtn").onclick = () => pgRapportLive(s);
}
function pgWireRpGen(s) {
  const g = $("rpGenNow"); if (!g) return;
  g.onclick = async () => {
    const m = $("rpGenMsg"); g.disabled = true; m.className = "msg"; m.textContent = "Génération (SEO + performance + sécurité + audience)… ~20 s.";
    const r = await window.olympus.pegasusReportRunNow(s.key);
    g.disabled = false;
    if (!r.ok) { m.className = "msg err"; m.textContent = r.error || "Échec."; return; }
    const d = r.data;
    if (d && d.ok === false) { m.className = "msg err"; m.textContent = d.error || "Échec côté site."; return; }
    m.className = "msg ok"; m.textContent = d && d.skipped ? "Déjà généré aujourd'hui." : "Rapport du jour généré.";
    pgRapportRender(s);
  };
}
// État en direct — À LA DEMANDE seulement (bouton). Métriques temps réel + audience live.
async function pgRapportLive(s) {
  const box = $("pgRapLive"); if (!box) return;
  box.innerHTML = `<div class="rb-empty">Analyse en direct (SEO, performance, sécurité)…</div>`;
  const m = (await pgLoadMetrics(s.key)) || pgMetrics[s.key] || { seo: [], perf: [], secu: [] };
  const days = pgRapportPeriod;
  const data = pgReportData(m, days);
  let aud = null;
  try { const ar = await window.olympus.pegasusAudiencePegasus(s.key, days || 365); if (ar.ok) aud = ar.data; } catch {}
  const empty = !data.seo.length && !data.perf.length && !data.secu.length && !(aud && aud.total);
  box.innerHTML = `
    <div class="pg-sub" style="margin-top:28px;">État en direct</div>
    <div class="rp-head">
      <div class="rp-periods">${[[7, "7 j"], [30, "30 j"], [90, "90 j"], [0, "Tout"]].map(([d, l]) => `<button class="rp-per${days === d ? " on" : ""}" data-per="${d}">${l}</button>`).join("")}</div>
      <button class="btn sec" id="rpClaude" title="Ouvre une session Claude Code sur les métriques pour une analyse rédigée">✨ Analyse par Claude</button>
      <button class="cal-btn primary" id="rpPdf">⤓ Exporter en PDF</button>
    </div>
    ${empty ? `<div class="rb-empty">Aucune donnée en direct sur cette période. Lance les analyses SEO, Performance et Sécurité depuis leurs onglets — elles s'enregistrent automatiquement.</div>` : pgReportBody(s, data, days, aud)}`;
  box.querySelectorAll(".rp-per").forEach((b) => b.onclick = () => { pgRapportPeriod = +b.dataset.per; pgRapportLive(s); });
  const pdf = $("rpPdf"); if (pdf) pdf.onclick = async () => {
    if (empty) { alert("Rien à exporter : lance d'abord les analyses."); return; }
    pdf.disabled = true; pdf.textContent = "Génération…";
    const r = await window.olympus.pegasusExportPdf(pgReportPdfHTML(s, data, days, aud), `rapport-direct-${pgSlugish(s.label)}-${new Date().toISOString().slice(0, 10)}.pdf`);
    pdf.disabled = false; pdf.textContent = "⤓ Exporter en PDF";
    if (!r.ok && r.error !== "Export annulé.") alert("Échec de l'export : " + (r.error || ""));
  };
  const clb = $("rpClaude"); if (clb) clb.onclick = async () => {
    const prompt = `Rédige une analyse du site « ${s.label} » à partir de son historique de métriques (fichier metrics.json de ce dossier : séries seo/perf/secu datées). Période : ${days ? `${days} derniers jours` : "tout l'historique"}. Donne un état des lieux par domaine (SEO, performance, sécurité), les tendances (amélioration ou dégradation), les points prioritaires et des recommandations concrètes et chiffrées. Écris en français, ton professionnel, et enregistre le résultat dans metrics-analyse.md.`;
    const r = await window.olympus.pegasusPipelineDiscuss(s.key, prompt);
    const msg = $("pgWorkMsg");
    if (r.ok && msg) { msg.className = "msg ok"; msg.textContent = "Session Claude ouverte — l'analyse rédigée arrivera dans metrics-analyse.md."; }
    else if (!r.ok) alert("Échec : " + (r.error || ""));
  };
}
// Détail d'un rapport quotidien (réutilise le corps du rapport + export PDF de ce jour)
function pgReportCardModal(s, rep) {
  const data = { seo: rep.seo ? [rep.seo] : [], perf: rep.perf ? [rep.perf] : [], secu: rep.secu ? [rep.secu] : [] };
  const aud = rep.audience || null;
  const dt = new Date(rep.day + "T12:00:00");
  const dLong = isNaN(dt) ? rep.day : dt.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  ov.innerHTML = `<div class="modal-panel" style="width:780px;max-width:94vw;">
      <div class="modal-head"><h2>Rapport du ${escapeHtml(dLong)}</h2><button class="modal-x" data-x aria-label="Fermer">✕</button></div>
      <div class="modal-body" style="max-height:74vh;overflow:auto;">${pgReportBody(s, data, 1, aud, "instantané du " + dLong)}</div>
      <div class="modal-foot"><button class="cal-btn primary" data-pdf>⤓ Exporter ce rapport en PDF</button></div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelector("[data-pdf]").onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "Génération…";
    const r = await window.olympus.pegasusExportPdf(pgReportPdfHTML(s, data, 1, aud, "instantané du " + dLong), `rapport-${pgSlugish(s.label)}-${rep.day}.pdf`);
    b.disabled = false; b.textContent = "⤓ Exporter ce rapport en PDF";
    if (r.ok) close(); else if (r.error !== "Export annulé.") alert("Échec : " + (r.error || ""));
  };
}

// ══════════ AUDIENCE — Google Analytics 4 + Search Console (visites, provenance) ══════════
let pgAudiencePeriod = 30;
const pgAudCache = {};
const pgFlag = (cc) => { // code pays ISO-2 → drapeau emoji
  if (!cc || cc.length !== 2 || !/^[A-Za-z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
};
const pgKpi = (n, l) => `<div class="pg-dcard"><div class="pg-dbig">${n}</div><div class="pg-dlabel">${l}</div></div>`;
const pgFmtN = (x) => (x >= 1000 ? (x / 1000).toFixed(1).replace(".0", "") + "k" : String(x));
// Vue Audience : SOURCE PRINCIPALE = le traqueur Pegasus (aucune config, RGPD, dispo
// dès la mise à jour du plugin). Bloc OPTIONNEL = mots-clés Google (Search Console).
async function pgAudienceRender(s) {
  const box = $("pgAudience"); if (!box) return;
  const days = pgAudiencePeriod;
  const pk = s.key + ":peg:" + days, pk2 = s.key + ":peg2:" + days;
  if (pgAudCache[pk] === undefined) { box.innerHTML = `<div class="ga-note">Lecture de l'audience…</div>`; pgAudCache[pk] = await window.olympus.pegasusAudiencePegasus(s.key, days); }
  // Fenêtre double (pour l'évolution vs période précédente)
  if (pgAudCache[pk2] === undefined) pgAudCache[pk2] = await window.olympus.pegasusAudiencePegasus(s.key, days * 2);
  const pr = pgAudCache[pk], prW = pgAudCache[pk2];
  const hasData = pr.ok && pr.data && pr.data.total > 0;
  let html = `<div class="ga-head">
      <div class="ga-head-t"><h2>Audience</h2><span>${escapeHtml(s.label)} · mesuré par Pegasus</span></div>
      <div class="ga-controls">
        <div class="ga-period">${[[7, "7 j"], [30, "30 j"], [90, "90 j"]].map(([d, l]) => `<button class="ga-per${days === d ? " on" : ""}" data-per="${d}">${l}</button>`).join("")}</div>
        <button class="ga-ic" id="audReload" title="Actualiser">↻</button>
        ${hasData ? `<button class="ga-ic" id="audReset" title="Réinitialiser la mesure de ce site">⟲</button>` : ""}
      </div>
    </div>`;
  if (!pr.ok && /404|no_route|rest_no_route/i.test(pr.error || "")) {
    html += `<div class="ga-note">Le traqueur d'audience a besoin de la dernière version du plugin Pegasus sur ce site. Le plugin se met à jour tout seul — réessaie dans un moment, ou mets-le à jour depuis l'onglet Général.</div>`;
  } else if (!pr.ok) {
    html += `<div class="ga-note">Lecture impossible : ${escapeHtml(pr.error || "")}</div>`;
  } else {
    const d = pr.data;
    if (!d.total) {
      html += `<div class="ga-note">Aucune visite enregistrée pour l'instant. La mesure vient de démarrer — les visites apparaîtront ici au fil du trafic. <span class="dim">(Les visites de l'équipe connectée au site ne sont pas comptées.)</span></div>`;
    } else {
      const prev = prW.ok && prW.data ? { total: Math.max(0, (prW.data.total || 0) - d.total), uniques: Math.max(0, (prW.data.uniques || 0) - d.uniques) } : {};
      const mobile = (d.devices || []).find((x) => x.label === "mobile");
      const mobilePct = d.total ? Math.round((mobile?.value || 0) / d.total * 100) : 0;
      html += `<div class="ga-cards">
        ${pgScore("Visites", pgFmtN(d.total), pgDelta(d.total, prev.total))}
        ${pgScore("Visiteurs uniques", pgFmtN(d.uniques), pgDelta(d.uniques, prev.uniques))}
        ${pgScore("Part mobile", mobilePct + " %", "", (mobile?.value || 0) + " visite(s)")}
      </div>`;
      html += pgPanel("Visites par jour", pgAreaChart((d.byDay || []).map((x) => ({ label: pgDayLabel(x.date), value: x.hits }))));
      // Entonnoir de visite + donut de provenance
      const contact = (d.pages || []).find((p) => /contact|devis|quote|rendez|reservation|booking|estimate|contatti/i.test(p.label || ""));
      const funnel = [{ label: "Visites", value: d.total }, { label: "Visiteurs uniques", value: d.uniques }];
      if (contact) funnel.push({ label: `Ont vu « ${contact.label} »`, value: contact.value });
      html += `<div class="ga-breaks">`;
      html += pgPanel("Entonnoir de visite", pgFunnel(funnel));
      if (d.sources?.length) html += pgPanel("Provenance", pgDonut(d.sources.map((x) => ({ label: x.label, value: x.value })), { centerLabel: "visites" }));
      html += `</div>`;
      html += `<div class="ga-breaks">`;
      if (d.pages?.length) html += pgPanel("Pages les plus vues", pgBreak(d.pages.map((x) => ({ label: x.label, value: x.value })), { color: "var(--ok)" }));
      if (d.countries?.length) html += pgPanel("Pays", pgBreak(d.countries.map((x) => ({ label: x.label, value: x.value, icon: pgFlag(x.label) })), { total: d.total, color: "#7fb2e8" }));
      if (d.devices?.length) html += pgPanel("Appareils", pgBreak(d.devices.map((x) => ({ label: x.label === "mobile" ? "Mobile" : "Ordinateur", value: x.value, icon: x.label === "mobile" ? "📱" : "💻" })), { total: d.total, color: "#c9a2e8" }));
      html += `</div>`;
      html += pgPanel("Répartition horaire des visites", pgHeatmap(d.heatmap || []), "heure locale du serveur");
    }
  }
  html += `<div class="ga-subhead">Mots-clés Google <span>· Search Console — optionnel</span></div><div id="audGoogle"><div class="ga-note">…</div></div>`;
  box.innerHTML = html;
  box.querySelectorAll(".ga-per").forEach((b) => b.onclick = () => { pgAudiencePeriod = +b.dataset.per; pgAudienceRender(s); });
  $("audReload").onclick = () => { Object.keys(pgAudCache).forEach((k) => k.startsWith(s.key + ":") && delete pgAudCache[k]); pgAudienceRender(s); };
  const rb = $("audReset");
  if (rb) rb.onclick = async () => {
    if (!confirm(`Réinitialiser la mesure d'audience de « ${s.label} » ?\n\nTout l'historique de visites de ce site sera effacé définitivement. La mesure repartira de zéro. (Cela n'affecte que les statistiques, pas le site.)`)) return;
    rb.disabled = true; rb.textContent = "…";
    const r = await window.olympus.pegasusAudienceReset(s.key);
    if (!r.ok) { rb.disabled = false; rb.textContent = "⟲ Réinitialiser la mesure"; alert("Échec de la réinitialisation : " + (r.error || "")); return; }
    Object.keys(pgAudCache).forEach((k) => k.startsWith(s.key + ":") && delete pgAudCache[k]);
    pgAudienceRender(s);
  };
  pgAudienceGoogle(s, days);
}
// Bloc optionnel : mots-clés Google (Search Console) via OAuth agence
async function pgAudienceGoogle(s, days) {
  const box = $("audGoogle"); if (!box) return;
  const st = await window.olympus.pegasusAnalyticsStatus();
  if (!st.creds) { box.innerHTML = `<p class="pg-mnote" style="margin-top:2px;">Pour afficher les mots-clés tapés dans Google (impressions, clics, position moyenne), il faut connecter Search Console une fois pour l'agence (voir le guide de connexion Google). Le reste de l'audience ci-dessus n'en a pas besoin.</p>`; return; }
  if (!st.connected) {
    box.innerHTML = `<button class="btn sec" id="audGConnect">Connecter le compte Google de l'agence</button><div class="msg" id="audGMsg" style="margin-top:8px;"></div>`;
    $("audGConnect").onclick = async () => { const m = $("audGMsg"); m.className = "msg"; m.textContent = "Autorise dans le navigateur puis reviens…"; const r = await window.olympus.pegasusGoogleConnect(); if (r.ok) pgAudienceGoogle(s, days); else { m.className = "msg err"; m.textContent = r.error || "Échec."; } };
    return;
  }
  const cr = await window.olympus.pegasusAnalyticsConfigGet(s.key);
  const cfg = (cr.ok && cr.config) || {};
  if (!cfg.scUrl) {
    const host = (s.base_url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    box.innerHTML = `<div class="mq-label">URL de la propriété Search Console de ce site</div>
      <div class="rp-head" style="margin:6px 0 0;"><input class="mood-in" id="audScUrl" placeholder="https://${escapeHtml(host)}/  ou  sc-domain:${escapeHtml(host)}" style="flex:1;"><button class="cal-btn" id="audScSave">Connecter</button></div>`;
    $("audScSave").onclick = async () => { await window.olympus.pegasusAnalyticsConfigSet(s.key, { ...cfg, scUrl: $("audScUrl").value.trim() }); Object.keys(pgAudCache).forEach((k) => k.startsWith(s.key + ":g:") && delete pgAudCache[k]); pgAudienceGoogle(s, days); };
    return;
  }
  const gk = s.key + ":g:" + days;
  if (pgAudCache[gk] === undefined) { box.innerHTML = `<div class="rb-empty">Lecture de Search Console…</div>`; pgAudCache[gk] = await window.olympus.pegasusAnalyticsFetch(s.key, days); }
  const r = pgAudCache[gk];
  if (!r.ok) { box.innerHTML = `<div class="rb-empty">Search Console : ${escapeHtml(r.error || "")}</div>`; return; }
  const d = r.data;
  let h = "";
  if (d.scTotals) h += `<div class="ga-cards">${pgScore("Clics Google", pgFmtN(d.scTotals.clicks))}${pgScore("Impressions", pgFmtN(d.scTotals.impressions))}${pgScore("Taux de clic", (d.scTotals.ctr * 100).toFixed(1) + " %")}${pgScore("Position moy.", d.scTotals.position.toFixed(1))}</div>`;
  if (d.queries?.length) h += pgPanel("Requêtes Google", `<div class="ga-tbl">${d.queries.map((q) => `<div class="ga-tr"><span class="ga-tl">${escapeHtml(q.query)}</span><span class="ga-tbar"><span class="ga-tbar-f" style="width:${Math.min(100, (q.clicks / Math.max(1, d.queries[0].clicks)) * 100).toFixed(0)}%"></span></span><span class="ga-tv">${q.clicks}<span class="ga-tpct">${q.impressions} vues · pos. ${q.position.toFixed(1)}</span></span></div>`).join("")}</div>`);
  box.innerHTML = h || `<div class="ga-note">Connecté, mais pas encore de données Search Console sur la période.</div>`;
}

async function pgRunSeo(key) {
  pgSeo[key] = { loading: true };
  pgRenderDetail();
  const r = await window.olympus.pegasusSiteSeo(key, 10);
  pgSeo[key] = r;
  if (r.ok && r.seo) {
    const a = r.seo;
    const problemes = Object.values(a.resume_problemes || {}).reduce((n, x) => n + (x || 0), 0);
    const pages = a.pages_auditees || 0;
    // Score SEO simple : 100 − (problèmes / pages) pondéré
    const score = Math.max(0, Math.round(100 - (pages ? (problemes / pages) * 20 : 0)));
    await pgCaptureMetric(key, "seo", { problemes, pages, score, sitemap: a.sitemap !== "absent", robots: a.robots_txt !== "absent" });
  }
  if (pgSel === key) pgRenderDetail();
}
async function pgRunPerf(key) {
  pgPerf[key] = { loading: true };
  pgRenderDetail();
  const r = await window.olympus.pegasusSitePerf(key, "mobile");
  pgPerf[key] = r;
  if (r.ok && r.perf) {
    const p = r.perf;
    await pgCaptureMetric(key, "perf", { score: p.score, lcp: p.lcp_ms, cls: p.cls_val, strategy: p.strategy });
  }
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
  Object.keys(pgDiag).forEach((k) => delete pgDiag[k]);
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
let currentUserId = null, currentUserName = null;
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
  if (!r.ok) { list.innerHTML = `<div class="env-row"><div class="st miss">!</div><div><div class="nm">${escapeHtml(r.error || "")}</div></div></div>`; return; }
  if (!r.members.length) { list.innerHTML = '<div class="env-row"><div><div class="meta">Aucun membre.</div></div></div>'; return; }
  list.innerHTML = r.members.map((m) => {
    // Données venues de Supabase → échappées partout (prénom/nom/email peuvent contenir < > " &).
    const name = escapeHtml(((m.first_name || "") + " " + (m.last_name || "")).trim() || m.email);
    const email = escapeHtml(m.email || "");
    const roleLabel = m.role === "super_admin" ? "super admin" : "classic";
    const mark = m.role === "super_admin" ? "★" : "•";
    const toggleRole = m.role === "super_admin" ? "classic" : "super_admin";
    const toggleLabel = m.role === "super_admin" ? "Passer classic" : "Passer super admin";
    const actions = m.id === currentUserId
      ? '<span class="member-self">vous</span>'
      : `<div class="member-actions">
           <button class="member-btn" data-act="role" data-id="${escapeHtml(m.id)}" data-role="${toggleRole}">${toggleLabel}</button>
           <button class="member-btn" data-act="reset" data-id="${escapeHtml(m.id)}" data-name="${name}">Réinit. mdp</button>
           <button class="member-btn danger" data-act="delete" data-id="${escapeHtml(m.id)}" data-name="${name}">Supprimer</button>
         </div>`;
    return `<div class="env-row"><div class="st ${m.role === "super_admin" ? "ok" : ""}">${mark}</div><div style="flex:1"><div class="nm">${name}</div><div class="meta">${email} · ${roleLabel}</div></div>${actions}</div>`;
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
    { d: "Aujourd'hui", a: "Lucas Dubois", t: "09:02", kind: "text", body: "J'ai laissé mes notes sur le rythme du montage dans le doc partagé." },
    { d: "Aujourd'hui", a: "Lucas Dubois", t: "09:03", kind: "text", body: "Dis-moi ce que t'en penses avant le call de 10h" },
  ] },
  { id: "dm-astrid", kind: "dm", name: "Astrid Berges", online: false, unread: 0, msgs: [
    { d: "Mardi", a: "Astrid Berges", t: "11:35", kind: "image", cap: "Moodboard — Maison Solène", g: 0 },
    { d: "Mardi", mine: true, t: "11:48", kind: "text", body: "Canon. On part là-dessus pour la DA." },
    { d: "Mardi", a: "Astrid Berges", t: "12:02", kind: "text", body: "Je te détaille la palette et les références en réunion demain." },
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
    { d: "Lundi", a: "Lucas Dubois", t: "17:41", kind: "text", body: "Je te fais un récap écrit dès que la sélection est prête." },
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
  hmWaCur = null; hmCur = c; c.unread = 0;
  $("hmHeadAv").textContent = c.kind === "channel" ? "◎" : initialsOf(c.name);
  $("hmHeadName").textContent = c.name;
  $("hmHeadSub").textContent = c.kind === "channel" ? c.sub : c.kind === "group" ? c.members.join(" · ") : (c.online ? "en ligne" : "hors ligne");
  if (c.real) { $("chatMessages").innerHTML = ""; chatLastId = 0; chatShownIds.clear(); chatTick(); }
  else renderFakeMsgs(c);
  renderConvList();
  if (typeof renderSchedChips === "function") renderSchedChips();
}
const chatShownIds = new Set();                              // ids déjà affichés → anti-doublon
function appendMessage(m) {
  if (!hmCur || !hmCur.real) return;
  if (m.id != null && chatShownIds.has(m.id)) return;        // course sendMsg ↔ poll : le même message n'apparaît qu'une fois
  if (m.id != null) chatShownIds.add(m.id);
  const box = $("chatMessages");
  const mine = m.user_id === currentUserId;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const el = document.createElement("div");
  el.className = "bubble " + (mine ? "me" : "them");
  el.innerHTML = `${mine ? "" : `<div class="author">${escapeHtml(m.author_name || "?")}</div>`}<div>${escapeHtml(m.body)}</div><div class="time">${fmtTime(m.created_at)}</div>`;
  box.appendChild(el);
  if (mine || near) box.scrollTop = box.scrollHeight;
}
let chatTicking = false;
async function chatTick() {
  if (!hmCur || !hmCur.real || chatTicking) return;          // pas de ticks concurrents (chacun repartait du même chatLastId)
  chatTicking = true;
  try {
    const r = await window.olympus.chatList(chatLastId);
    if (!hmCur || !hmCur.real) return;                        // conversation changée pendant l'attente
    if (r.ok && r.messages && r.messages.length) {
      r.messages.forEach(appendMessage);
      const last = r.messages[r.messages.length - 1];
      if (last.id > chatLastId) chatLastId = last.id;
      const team = hmConvs.find((c) => c.id === "team");
      if (team) { team.last = last.body; team.time = fmtTime(last.created_at); renderConvList(); }
    }
  } finally { chatTicking = false; }
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
  if (!body) return;
  if (hmWaCur) {
    input.value = "";
    const r = await window.olympus.waSend(hmWaCur, body);
    if (r.ok) { const rr = await window.olympus.waMessages(hmWaCur); paintWaMsgs(rr.messages || []); }
    else input.value = body;
    return;
  }
  if (!hmCur) return;
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

// ══ Hermès : bascule Équipe / WhatsApp (WhatsApp perso via Baileys) ══
let hmMode = "team";
let hmWaCur = null; // jid de la conversation WhatsApp ouverte
document.querySelectorAll(".hm-mode").forEach((b) => b.onclick = () => {
  hmMode = b.dataset.hmmode;
  document.querySelectorAll(".hm-mode").forEach((x) => x.classList.toggle("on", x === b));
  $("hmTeamPane").style.display = hmMode === "team" ? "" : "none";
  $("hmSearch").style.display = hmMode === "team" ? "" : "none";
  $("hmWaPane").style.display = hmMode === "wa" ? "" : "none";
  if (hmMode === "wa") renderWa();
});
async function renderWa() {
  const box = $("hmWaPane"); if (!box) return;
  const st = await window.olympus.waStatus();
  if (st.state === "connected") {
    const r = await window.olympus.waChats();
    const chats = r.chats || [];
    box.innerHTML = `<div class="hm-sec">WhatsApp · ${escapeHtml((st.me && st.me.name) || "connecté")} <button class="wa-logout" id="waLogout" title="Déconnecter WhatsApp">⏻</button></div>`
      + (chats.length ? chats.map(waRow).join("") : `<div class="ga-note" style="margin:8px;">Aucune conversation encore. Elles apparaissent au fil des messages reçus/envoyés.</div>`);
    $("waLogout").onclick = async () => { if (!confirm("Déconnecter WhatsApp d'Olympus ?")) return; await window.olympus.waLogout(); hmWaCur = null; renderWa(); };
    box.querySelectorAll("[data-wa]").forEach((el) => el.onclick = () => openWaChat(el.dataset.wa, el.dataset.name));
  } else if (st.state === "qr" && st.qr) {
    box.innerHTML = `<div class="wa-connect">
      <div class="wa-qr"><img src="${st.qr}" alt="QR WhatsApp"></div>
      <div class="wa-steps"><b>Scanne ce QR code</b><br>Sur ton téléphone : WhatsApp → <b>Réglages</b> → <b>Appareils connectés</b> → <b>Connecter un appareil</b>.</div>
    </div>`;
  } else if (st.state === "connecting") {
    box.innerHTML = `<div class="wa-connect"><div class="wa-spin"></div><div class="wa-steps">Connexion à WhatsApp…</div></div>`;
  } else {
    box.innerHTML = `<div class="wa-connect">
      <div class="wa-logo">💬</div>
      <div class="wa-steps"><b>Connecte ton WhatsApp</b><br>Retrouve tes conversations et réponds à tes contacts depuis Hermès.</div>
      <button class="cal-btn primary" id="waConnectBtn">Connecter WhatsApp</button>
      <div class="wa-warn">Connexion non officielle (comme WhatsApp Web) — tes messages restent entre ton téléphone et WhatsApp.</div>
    </div>`;
    $("waConnectBtn").onclick = async () => { const b = $("waConnectBtn"); b.disabled = true; b.textContent = "Ouverture…"; await window.olympus.waConnect(); renderWa(); };
  }
}
function waRow(c) {
  const un = c.unread ? `<span class="hm-unread">${c.unread}</span>` : "";
  const t = c.ts ? new Date(c.ts * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "";
  const preview = (c.lastFromMe ? "Vous : " : "") + (c.lastText || "");
  return `<div class="hm-conv${hmWaCur === c.id ? " active" : ""}" data-wa="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}"><div class="hm-av">${c.isGroup ? "👥" : initialsOf(c.name)}</div><div class="hm-cinfo"><div class="hm-cname">${escapeHtml(c.name)}</div><div class="hm-clast">${escapeHtml(preview).slice(0, 64)}</div></div><div class="hm-cmeta"><span class="hm-ctime">${t}</span>${un}</div></div>`;
}
async function openWaChat(jid, name) {
  hmWaCur = jid; hmCur = null;
  $("hmHeadAv").textContent = jid.endsWith("@g.us") ? "👥" : initialsOf(name);
  $("hmHeadName").textContent = name;
  $("hmHeadSub").textContent = "WhatsApp";
  $("chatMessages").innerHTML = `<div class="ga-note" style="margin:12px;">Chargement…</div>`;
  const r = await window.olympus.waMessages(jid);
  if (hmWaCur !== jid) return;                                // l'utilisateur a ouvert une autre conversation entre-temps
  paintWaMsgs(r.messages || []);
  renderWa();
}
function paintWaMsgs(msgs) {
  const box = $("chatMessages");
  box.innerHTML = msgs.map((m) => `<div class="bubble ${m.fromMe ? "me" : "them"}">${(!m.fromMe && m.author) ? `<div class="author">${escapeHtml(m.author)}</div>` : ""}<div>${escapeHtml(m.text)}</div><div class="time">${m.ts ? new Date(m.ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}</div></div>`).join("") || `<div class="ga-note" style="margin:12px;">Pas encore de messages dans cette conversation.</div>`;
  box.scrollTop = box.scrollHeight;
}
window.olympus.onWaEvent((d) => {
  if (d.type === "status") { if (hmMode === "wa") renderWa(); }
  else if (d.type === "chats") { if (hmMode === "wa") renderWa(); }
  else if (d.type === "message" && d.jid === hmWaCur) { const jid = hmWaCur; window.olympus.waMessages(jid).then((r) => { if (hmWaCur === jid) paintWaMsgs(r.messages || []); }); }
});
// Joindre un fichier / média
$("chatAttach").onclick = () => {
  if (hmWaCur) { $("chatInput").placeholder = "Pièces jointes WhatsApp non prises en charge pour l'instant"; setTimeout(() => { $("chatInput").placeholder = "Écris un message…"; }, 2500); return; }
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
// IA + programmation (Hermès) : réutilise le moteur des bulles, câblé sur la conversation courante.
function hmAiCtx() {
  return {
    participants: hmCur ? hmCur.name : "",
    priceEl: $("chatAiPrice"),
    gather: async () => {
      if (!hmCur) return [];
      if (hmCur.real) {
        const r = await window.olympus.chatList(0).catch(() => ({ ok: false }));
        return ((r.ok && r.messages) || []).map((m) => ({ who: m.user_id === currentUserId ? "Moi" : (m.author_name || hmCur.name), text: m.body })).filter((x) => x.text);
      }
      return (hmCur.msgs || []).map((m) => ({ who: m.mine ? "Moi" : (m.a || hmCur.name), text: (m.kind === "text" || !m.kind) ? m.body : (m.cap || m.name || "") })).filter((x) => x.text);
    },
  };
}
$("chatAiBtn").onclick = (e) => aiPrepareReply("chat", $("chatInput"), e.currentTarget, "draft", hmAiCtx());
$("chatImpBtn").onclick = (e) => aiPrepareReply("chat", $("chatInput"), e.currentTarget, "improve", hmAiCtx());
$("chatSchedBtn").onclick = (e) => rbSchedOpen("chat", $("chatInput"), e.currentTarget, { conv: hmCur });
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
let wheelSeq = 0;
async function renderWheel() {
  const d = wheelDate;
  drawWheel();
  syncGridToWheel();                         // la grille suit le jour de la roue
  $("agendaHead").textContent = DOW_FULL[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()];
  const iso = isoD(d.getFullYear(), d.getMonth(), d.getDate());
  // On sert D'ABORD l'agenda depuis les événements déjà en mémoire (chronosEvents) → l'agenda
  // suit la roue instantanément, sans clignoter, même en scroll rapide.
  agendaEvents = chronosEvents.filter((e) => e.date <= iso && (e.end_date || e.date) >= iso).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  $("agendaDay").innerHTML = agendaHoursHtml(agendaEvents);
  // Puis on rafraîchit depuis le réseau, mais on ignore la réponse si la roue a bougé entre-temps
  // (réponses hors-ordre en scroll rapide → l'agenda affichait le mauvais jour, bug signalé).
  const seq = ++wheelSeq;
  const r = await window.olympus.chronosList(iso, iso);
  if (seq !== wheelSeq) return;
  if (r.ok && !r.partial) {
    agendaEvents = (r.events || []).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    $("agendaDay").innerHTML = agendaHoursHtml(agendaEvents);
  }
}
// Un événement dans l'agenda (pastille + heure + titre)
function agItem(e) {
  const dot = e.is_personal ? "" : `<span class="ev-dot" style="background:${catColor(e.category)}"></span>`;
  const who = e.is_personal && e.assignee ? `<span class="ev-name">${escapeHtml(e.assignee)}</span> · ` : "";
  const t = e.time ? `<span class="ag-t">${e.time.slice(0, 5)}</span>` : "";
  return `<div class="agenda-ev${e.is_personal ? " perso" : ""}" data-ev="${e.id}">${dot}${t}${who}${escapeHtml(e.title)}</div>`;
}
// Agenda du jour découpé en heures : bandeau « toute la journée » + créneaux horaires.
function agendaHoursHtml(events) {
  const allday = events.filter((e) => !e.time);
  const timed = events.filter((e) => e.time).sort((a, b) => a.time.localeCompare(b.time));
  if (!allday.length && !timed.length) return '<div class="rb-empty">Rien de prévu ce jour-là.</div>';
  const hourOf = (e) => parseInt(e.time.slice(0, 2), 10);
  const startH = 0, endH = 24; // minuit → minuit
  const byHour = {};
  timed.forEach((e) => { (byHour[hourOf(e)] = byHour[hourOf(e)] || []).push(e); });
  let html = "";
  if (allday.length) html += `<div class="ag-allday"><div class="ag-allday-l">Toute la journée</div>${allday.map(agItem).join("")}</div>`;
  html += '<div class="ag-hours">';
  for (let h = startH; h < endH; h++) {
    html += `<div class="ag-hour"><div class="ag-hlabel">${String(h).padStart(2, "0")}</div><div class="ag-hslot">${(byHour[h] || []).map(agItem).join("")}</div></div>`;
  }
  html += "</div>";
  return html;
}
function highlightSelected() {
  document.querySelectorAll("#calScroll .cal-cell").forEach((c) => c.classList.toggle("sel", c.dataset.date === calSelected));
}
function syncGridToWheel() {
  calSelected = isoD(wheelDate.getFullYear(), wheelDate.getMonth(), wheelDate.getDate());
  if (calView !== "month") {
    // Semaine/Jour : si le jour est déjà dans la bande, on se contente de re-surligner (pas de
    // re-fetch ni de reset du pan). Sinon on reconstruit la bande autour du nouveau jour.
    if (tlBuf.length && tlBuf.some((x) => isoOf(x) === calSelected)) { highlightSelected(); return; }
    tlForceRebuild = true; renderChronos();
    return;
  }
  if (wheelDate.getFullYear() !== calDate.getFullYear() || wheelDate.getMonth() !== calDate.getMonth()) {
    calDate = new Date(wheelDate.getFullYear(), wheelDate.getMonth(), 1);
    calCenterNext = true;                    // navigation VOULUE → on centre sur le nouveau mois
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
  // month/year : on borne le jour, sinon avancer d'un mois depuis un 31 débordait (31 janv →
  // 3 mars) et depuis un 29 fév, +1 an sautait aussi un mois.
  else if (unit === "month") { const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + dir); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  else if (unit === "year") { const day = d.getDate(); d.setDate(1); d.setFullYear(d.getFullYear() + dir); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
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
  apple: "#8ab4f8",
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
// Voies (lanes) des événements multi-jours : chaque event garde la MÊME voie sur
// tous ses jours → les barres s'alignent horizontalement d'une case à l'autre.
function assignLanes(events) {
  const spans = events.filter((e) => evEnd(e) !== e.date).sort((a, b) => a.date.localeCompare(b.date) || evEnd(b).localeCompare(evEnd(a)));
  const laneEnd = [];
  for (const ev of spans) {
    let lane = 0;
    while (lane < laneEnd.length && laneEnd[lane] >= ev.date) lane++;
    ev._lane = lane;
    laneEnd[lane] = evEnd(ev);
  }
  events.filter((e) => evEnd(e) === e.date).forEach((e) => { e._lane = undefined; });
  return laneEnd.length;
}
function dayCell(y, m, day, byDate, todayIso, firstCol, isLast, nLanes) {
  const dIso = isoD(y, m, day);
  const cls = (dIso === todayIso ? " today" : "") + (dIso === calSelected ? " sel" : "") + (day === 1 ? " mstart" : "") + (isLast ? " mend" : "");
  const evs = byDate[dIso] || [];
  // Événements sur une seule journée en haut ; multi-jours réservés en bas, par voie.
  const singleChips = evs.filter((e) => evEnd(e) === e.date).map((e) => chipHtml(e, dIso)).join("");
  let spansHtml = "";
  if (nLanes > 0) {
    const spans = evs.filter((e) => evEnd(e) !== e.date);
    let rows = "";
    for (let L = 0; L < nLanes; L++) {
      const s = spans.find((e) => (e._lane || 0) === L);
      rows += s ? chipHtml(s, dIso) : '<div class="ev-span-ph"></div>';
    }
    spansHtml = `<div class="cal-spans">${rows}</div>`;
  }
  const style = firstCol ? ` style="grid-column-start:${firstCol}"` : "";
  const mark = day === 1 ? ` data-mstart="${monthKey(new Date(y, m, 1))}"` : "";
  return `<div class="cal-cell${cls}" data-date="${dIso}"${style}${mark}><div class="cal-daynum">${day}</div>${singleChips}${spansHtml}</div>`;
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
// Rendu SYNCHRONE depuis les événements déjà en mémoire — aucun réseau ici : indispensable
// pour que la compensation de scroll du défilement infini se fasse dans la même frame
// (le moindre await entre mesure et restauration = saut visuel, bug signalé).
function paintCalDOM() {
  const nLanes = assignLanes(chronosEvents);
  const byDate = groupByDate(chronosEvents);
  const todayIso = todayIsoNow();
  let cells = "";
  calMonths.forEach((mo, mi) => {
    const y = mo.getFullYear(), m = mo.getMonth(), days = new Date(y, m + 1, 0).getDate();
    for (let day = 1; day <= days; day++) {
      const firstCol = (mi === 0 && day === 1) ? ((new Date(y, m, 1).getDay() + 6) % 7) + 1 : 0;
      cells += dayCell(y, m, day, byDate, todayIso, firstCol, day === days, nLanes);
    }
  });
  $("calScroll").innerHTML = `<div class="cal-flow"><div class="cal-days" id="calDays">${cells}</div><div class="cal-labels" id="calLabels"></div></div>`;
  positionCalMonths();
}
// Recharge les événements de toute la fenêtre de mois affichée. Un compteur de génération
// écarte les réponses obsolètes (deux fetch concurrents qui reviendraient dans le désordre).
let calFetchGen = 0;
async function fetchCalEvents() {
  const gen = ++calFetchGen;
  const first = calMonths[0], last = calMonths[calMonths.length - 1];
  const lastEnd = new Date(last.getFullYear(), last.getMonth() + 1, 0);
  const r = await window.olympus.chronosList(isoD(first.getFullYear(), first.getMonth(), 1), isoD(lastEnd.getFullYear(), lastEnd.getMonth(), lastEnd.getDate()));
  if (gen !== calFetchGen) return "stale";                  // une requête plus récente est partie
  // partial:true = les événements internes ont échoué (seul iCloud a répondu) → on GARDE
  // l'affichage précédent au lieu de peindre un calendrier presque vide.
  if (r.ok && !r.partial) chronosEvents = r.events;
  return true;                                              // même en erreur réseau : on peint avec ce qu'on a
}
// Re-peint en conservant la position de lecture : on s'ancre sur la première cellule visible
// (exact même si des événements arrivés entre-temps ont changé les hauteurs des cellules).
function repaintKeepScroll() {
  const el = $("calScroll");
  const days = $("calDays");
  let anchorDate = null, anchorOffset = 0;
  if (days) {
    const cells = days.querySelectorAll(".cal-cell[data-date]");
    for (const c of cells) {
      if (c.offsetTop + c.offsetHeight > el.scrollTop) { anchorDate = c.dataset.date; anchorOffset = c.offsetTop - el.scrollTop; break; }
    }
  }
  paintCalDOM();
  if (anchorDate) {
    const c = $("calDays").querySelector(`[data-date="${anchorDate}"]`);
    if (c) el.scrollTop = Math.max(0, c.offsetTop - anchorOffset);
  }
}
// Renvoie false si une requête plus récente a pris le relais — dans ce cas on ne repeint PAS
// (le rendu et le scroll appartiennent au flux le plus récent, sinon on écrase son travail).
async function paintCal() { const st = await fetchCalEvents(); if (st === "stale") return false; paintCalDOM(); return true; }
let calView = "month";                                     // month | week | day
let calCenterNext = true;                                  // true = le prochain rendu Mois centre sur calDate
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
  const gridExists = !!$("calDays");
  const covered = calMonths.length && calMonths.some((mo) => monthKey(mo) === monthKey(cur));
  if (gridExists && covered && !calCenterNext) {
    // Rafraîchissement en place (après un enregistrement/coche d'événement) : on garde la
    // position de lecture — avant, chaque save re-centrait sur le mois courant (saut signalé).
    if (await fetchCalEvents() === "stale") return;
    repaintKeepScroll();
    return;
  }
  calCenterNext = false;
  calMonths = [-2, -1, 0, 1, 2].map((k) => new Date(cur.getFullYear(), cur.getMonth() + k, 1));
  $("calDow").innerHTML = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("");
  if (!await paintCal()) return;                            // rendu obsolète : un flux plus récent a repris la main
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
// Fusion sans doublon : chronos:list est une requête de CHEVAUCHEMENT, un événement multi-jours
// à cheval sur la frontière d'une fenêtre est renvoyé par deux fetchs adjacents.
function mergeEvents(base, extra) {
  const seen = new Set(base.map((e) => String(e.id)));
  return base.concat((extra || []).filter((e) => !seen.has(String(e.id))));
}
let tlGen = 0;
async function renderTimeline(vis) {
  tlVis = vis;
  // Rafraîchissement en place (save/coche/clic sur un jour déjà dans la bande) : on garde le pan
  // et le scroll vertical au lieu de tout ré-ancrer sur wheelDate (sauts signalés en Semaine/Jour).
  const iso = isoD(wheelDate.getFullYear(), wheelDate.getMonth(), wheelDate.getDate());
  const inBuf = tlBuf.length && tlBuf.some((x) => isoOf(x) === iso);
  if (inBuf && !tlForceRebuild) {
    const gen = ++tlGen;
    const r = await window.olympus.chronosList(isoOf(tlBuf[0]), isoOf(tlBuf[tlBuf.length - 1]));
    if (gen !== tlGen) return;                                                      // une requête plus récente a pris la main
    if (r.ok && !r.partial) chronosEvents = r.events;
    const keepTop = $("calScroll").scrollTop;
    tlPaint();
    $("calScroll").scrollTop = keepTop;
    highlightSelected();
    return;
  }
  tlForceRebuild = false;
  const anchor = new Date(wheelDate), start = new Date(anchor);
  if (vis === 7) start.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));    // lundi
  start.setDate(start.getDate() - vis);                                            // 1 fenêtre de marge avant
  const total = vis * 5;
  tlBuf = [...Array(total)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const gen = ++tlGen;
  const r = await window.olympus.chronosList(isoOf(tlBuf[0]), isoOf(tlBuf[total - 1]));
  if (gen !== tlGen) return;
  chronosEvents = r.ok ? r.events : [];
  computeHPX();
  tlColW = Math.max(100, Math.round(($("calScroll").clientWidth - 54 - 452) / vis));
  tlPan = -vis * tlColW;                                                            // démarre sur wheelDate (index vis)
  tlPaint();
  $("calScroll").scrollTop = earliestHour(chronosEvents) * HPX;
}
let tlForceRebuild = false;
// Pan infini SANS saut : la bande est étendue et repeinte IMMÉDIATEMENT (avec les événements
// déjà en mémoire), puis les événements des nouveaux jours arrivent en tâche de fond (débounce)
// et on repeint en conservant le pan. Avant : un await réseau s'intercalait entre le drag et le
// repaint → le pan continuait dans le vide puis tout sautait au retour de la requête.
let tlBgTimer = null;
function tlScheduleBg(fromISO, toISO) {
  clearTimeout(tlBgTimer);
  tlBgTimer = setTimeout(async () => {
    const gen = ++tlGen;
    const r = await window.olympus.chronosList(fromISO, toISO);
    if (gen !== tlGen || !r.ok || r.partial) return;
    chronosEvents = mergeEvents(chronosEvents, r.events);
    if (calView !== "month") tlPaint();
  }, 200);
}
function tlMaybeWindow() {
  if (tlLoading || calView === "month") return;
  const clip = document.querySelector(".tl-colsclip"), clipW = clip ? clip.clientWidth : 400;
  const stripW = tlBuf.length * tlColW, add = tlVis * 2;
  if (tlPan > -tlColW) {                                     // proche du début → prépend
    tlLoading = true;
    const first = tlBuf[0];
    const days = [...Array(add)].map((_, i) => { const d = new Date(first); d.setDate(first.getDate() - add + i); return d; });
    tlBuf = days.concat(tlBuf);
    tlPan -= add * tlColW; calDragPan -= add * tlColW;       // garde la position visuelle (même frame)
    tlPaint();
    tlScheduleBg(isoOf(days[0]), isoOf(days[add - 1]));
    tlLoading = false;
  } else if (tlPan < -(stripW - clipW) + tlColW) {           // proche de la fin → append
    tlLoading = true;
    const last = tlBuf[tlBuf.length - 1];
    const days = [...Array(add)].map((_, i) => { const d = new Date(last); d.setDate(last.getDate() + 1 + i); return d; });
    tlBuf = tlBuf.concat(days);
    tlPaint();
    tlScheduleBg(isoOf(days[0]), isoOf(days[add - 1]));
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
// Scroll infini SANS saut : le nouveau mois est peint immédiatement (synchrone, avec les
// événements déjà en mémoire) et la compensation de scroll se fait dans la même frame.
// Les événements du mois ajouté arrivent ensuite en arrière-plan (repaint ancré sur la
// cellule visible). Avant : un await réseau s'intercalait entre mesure et restauration du
// scroll → tout défilement pendant l'attente était perdu (sauts signalés).
let calFetchTimer = null;
function calScheduleFetch() {
  clearTimeout(calFetchTimer);
  calFetchTimer = setTimeout(async () => {                // débounce : une seule requête même si on étend 3 mois d'affilée
    const st = await fetchCalEvents();
    if (st === true && calView === "month" && $("calDays")) repaintKeepScroll();
  }, 250);
}
$("calScroll").addEventListener("scroll", () => {
  if (calView !== "month") return;                        // scroll infini : vue Mois uniquement
  const el = $("calScroll");
  if (calLoading) return;
  if (el.scrollTop < 200) {
    calLoading = true;
    const oldTop = el.scrollTop, oldH = el.scrollHeight;
    calMonths.unshift(new Date(calMonths[0].getFullYear(), calMonths[0].getMonth() - 1, 1));
    paintCalDOM();
    el.scrollTop = oldTop + (el.scrollHeight - oldH);     // même frame → zéro saut
    calScheduleFetch();
    calLoading = false;
  } else if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) {
    calLoading = true;
    const oldTop = el.scrollTop;
    const lm = calMonths[calMonths.length - 1];
    calMonths.push(new Date(lm.getFullYear(), lm.getMonth() + 1, 1));
    paintCalDOM();
    el.scrollTop = oldTop;
    calScheduleFetch();
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
  $("evModalTitle").textContent = ev ? (ev.source === "apple" ? "Événement iCloud" : "Modifier l'événement") : "Nouvel événement";
  $("evSave").textContent = ev ? "Enregistrer" : "Ajouter";
  const isApple = ev && ev.source === "apple";
  $("evSave").style.display = isApple ? "none" : "";
  $("evDelete").style.display = ev && !isApple ? "" : "none";
  $("evDone").style.display = ev && !isApple ? "" : "none";
  if (ev && !isApple) $("evDone").textContent = ev.done ? "Marquer à faire" : "Marquer fait";
  $("evMsg").className = "msg"; $("evMsg").textContent = isApple ? `📅 iCloud · ${ev.cal_name || "calendrier Apple"} — lecture seule (édition deux-sens à venir).` : "";
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
// Quand les événements iCloud arrivent en tâche de fond (stale-while-revalidate côté main),
// on re-peint le calendrier en conservant la position de lecture — sans bloquer l'affichage.
window.olympus.onChronosAppleRefreshed(() => {
  if (!$("page-chronos").classList.contains("show")) return;
  if (calView === "month") { fetchCalEvents().then((st) => { if (st === true) repaintKeepScroll(); }); }
  else { tlForceRebuild = false; renderTimeline(tlVis); }
  renderWheel();
});

// ══════════ COLONNE DROITE (infos) + présence ══════════
let rbTimer = null;
// Ligne d'événement enrichie : heure début→fin, durée, et marqueur multi-jours.
const rbDM = (iso) => { const d = new Date(iso + "T00:00"); return d.getDate() + "/" + (d.getMonth() + 1); };
function rbEvMeta(e, mode) {
  const multi = e.end_date && e.end_date > e.date;
  const st = e.time ? e.time.slice(0, 5) : "", en = e.end_time ? e.end_time.slice(0, 5) : "";
  if (e.all_day || (!st && !en)) return multi ? `Du ${rbDM(e.date)} au ${rbDM(e.end_date)}` : "Toute la journée";
  if (multi) return `${rbDM(e.date)}${st ? " " + st : ""} → ${rbDM(e.end_date)}${en ? " " + en : ""}`;
  let dur = "";
  if (st && en) { const [sh, sm] = st.split(":").map(Number), [eh, em] = en.split(":").map(Number); const mins = (eh * 60 + em) - (sh * 60 + sm); if (mins > 0) { const h = Math.floor(mins / 60), m = mins % 60; dur = " · " + (h ? h + "h" + (m ? String(m).padStart(2, "0") : "") : m + "min"); } }
  if (mode === "today") return (en ? "→ " + en : "dès " + st) + dur;
  return (st && en ? `${st} – ${en}` : st ? `dès ${st}` : "→ " + en) + dur;
}
let rbEvById = {};
function rbEvRow(e, mode) {
  const multi = e.end_date && e.end_date > e.date;
  const lead = mode === "today" ? (e.time && !e.all_day ? e.time.slice(0, 5) : "—") : rbDM(e.date);
  const meta = rbEvMeta(e, mode);
  return `<div class="rb-ev${multi ? " multi" : ""}"${e.id != null ? ` data-rbev="${escapeHtml(String(e.id))}"` : ""}><span class="rb-time">${escapeHtml(lead)}</span><div class="rb-einfo"><span class="rb-t">${escapeHtml(e.title)}${multi ? ' <span class="rb-multi">plusieurs jours</span>' : ""}</span>${meta ? `<span class="rb-emeta">${escapeHtml(meta)}</span>` : ""}</div></div>`;
}
async function refreshRightbar() {
  const now = new Date();
  const today = isoD(now.getFullYear(), now.getMonth(), now.getDate());
  const far = new Date(now.getTime() + 730 * 864e5); // fenêtre large → tous les événements à venir
  const to = isoD(far.getFullYear(), far.getMonth(), far.getDate());
  const r = await window.olympus.chronosList(today, to);
  const evs = (r.ok ? r.events : []).filter((e) => !e.done);
  rbRenderMe(); // en-tête "toi + état" partagé par toutes les vues de la colonne
  rbEvById = {}; for (const e of evs) if (e.id != null) rbEvById[e.id] = e;
  const byTime = (a, b) => (a.time || "").localeCompare(b.time || "");
  const todayEvs = evs.filter((e) => e.date === today).sort(byTime);
  const soonEvs = evs.filter((e) => e.date > today).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b));
  $("rbToday").innerHTML = todayEvs.length
    ? todayEvs.map((e) => rbEvRow(e, "today")).join("")
    : '<div class="rb-empty">Rien de prévu.</div>';
  $("rbSoon").innerHTML = soonEvs.length
    ? soonEvs.map((e) => rbEvRow(e, "soon")).join("")
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
  else if (i === 3) rbRenderAthenaConvs();
}
$("rbTabs").onclick = (e) => { const t = e.target.closest("[data-rv]"); if (t) rbSetView(+t.dataset.rv); };
// Conversations Athéna : reprendre (clic) · supprimer (✕) · nouvelle
$("rbAthenaConvs").addEventListener("click", (e) => {
  const del = e.target.closest("[data-atdel]");
  if (del) { e.stopPropagation(); const id = del.dataset.atdel; atSaveConvs(atLoadConvs().filter((c) => c.id !== id)); if (id === atConvId) atConvId = null; rbRenderAthenaConvs(); return; }
  const it = e.target.closest("[data-atconv]"); if (it) atOpenConv(it.dataset.atconv);
});
$("rbNewAthena").onclick = atStartNew;
// Glisser à la souris : maintenir le clic gauche et glisser horizontalement pour changer de vue.
(() => {
  const car = document.querySelector(".rb-carousel"), slider = $("rbSlider");
  if (!car || !slider) return;
  let dragging = false, moved = false, sx = 0, sy = 0, sv = 0, w = 0;
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved) {
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) { moved = true; slider.classList.add("rb-dragging"); slider.style.transition = "none"; }
      else if (Math.abs(dy) > 12) { onUp(e); return; }        // geste vertical → on abandonne
    }
    if (moved) {
      let off = -sv * w + dx;
      if (off > 0) off *= 0.35;                               // résistance élastique aux bords
      if (off < -2 * w) off = -2 * w + (off + 2 * w) * 0.35;
      slider.style.transform = `translateX(${off}px)`;
      e.preventDefault();
    }
  };
  const onUp = (e) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    slider.classList.remove("rb-dragging");
    slider.style.transition = "";
    if (dragging && moved) {
      const dx = e.clientX - sx;
      let t = sv;
      if (dx < -w * 0.2) t = Math.min(3, sv + 1);             // glissé vers la gauche → vue suivante
      else if (dx > w * 0.2) t = Math.max(0, sv - 1);         // glissé vers la droite → vue précédente
      rbSetView(t);                                           // accroche à la vue (transform en %)
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; // avale le clic post-glissé
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 60);
    }
    dragging = false; moved = false;
  };
  car.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true; moved = false; sx = e.clientX; sy = e.clientY; sv = rbView; w = car.clientWidth || 1;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
})();
// États de présence choisis par l'utilisateur (Hors ligne = automatique quand il n'est pas sur Olympus).
const RB_STATUS = { libre: { label: "Libre", color: "#3fb950" }, focus: { label: "Focus", color: "#a06bd6" }, absent: { label: "Absent", color: "#e0a862" } };
let rbMyStatus = (() => { try { const s = localStorage.getItem("olympusStatus"); return RB_STATUS[s] ? s : "libre"; } catch { return "libre"; } })();
function rbRenderMe() {
  const meEl = $("rbMe"); if (!meEl) return;
  const st = RB_STATUS[rbMyStatus] || RB_STATUS.libre;
  meEl.innerHTML = `<div class="rb-me">
      <div class="avatar-sm rb-me-av">${escapeHtml(initialsOf(currentUserName || "?"))}<span class="rb-me-pres" style="background:${st.color}"></span></div>
      <div class="rb-me-info"><span class="rb-me-name">${escapeHtml(currentUserName || "Moi")} <span class="rb-me-tag">toi</span></span>
        <button class="rb-status" id="rbStatusBtn"><span class="rb-sdot" style="background:${st.color}"></span>${st.label}<span class="rb-scaret">▾</span></button></div>
    </div>
    <div class="rb-statusmenu" id="rbStatusMenu">${Object.entries(RB_STATUS).map(([k, v]) => `<div class="rb-sopt${k === rbMyStatus ? " on" : ""}" data-status="${k}"><span class="rb-sdot" style="background:${v.color}"></span>${v.label}</div>`).join("")}<div class="rb-sopt off" data-status-info><span class="rb-sdot" style="background:#8a8a90"></span>Hors ligne <span class="rb-sauto">auto quand tu quittes Olympus</span></div></div>`;
  $("rbStatusBtn").onclick = (e) => { e.stopPropagation(); $("rbStatusMenu").classList.toggle("show"); };
  $("rbStatusMenu").querySelectorAll("[data-status]").forEach((o) => o.onclick = () => { rbMyStatus = o.dataset.status; try { localStorage.setItem("olympusStatus", rbMyStatus); } catch {} rbRenderMe(); });
}
document.addEventListener("click", (e) => { const m = $("rbStatusMenu"); if (m && m.classList.contains("show") && !e.target.closest("#rbStatusMenu") && !e.target.closest("#rbStatusBtn")) m.classList.remove("show"); });
// Vue Chat de la colonne droite = annuaire : TOI en haut (avec état) + équipe + groupes & canaux.
async function rbRenderChat() {
  rbRenderMe();
  const teamEl = $("rbTeam"), groupsEl = $("rbGroups");
  const p = await window.olympus.presenceOnline().catch(() => ({ ok: false }));
  const users = (p.ok ? p.users : []).slice();
  const nowMs = Date.now();
  for (const f of FAKE_MEMBERS) if (!users.some((u) => u.name === f.name)) users.push({ name: f.name, last_seen: f.online ? new Date().toISOString() : new Date(nowMs - 36e5).toISOString() });
  const isMe = (u) => u.user_id === currentUserId || (currentUserName && u.name === currentUserName);
  const others = users.filter((u) => !isMe(u));
  const isOn = (u) => nowMs - new Date(u.last_seen).getTime() < 120000;
  others.sort((a, b) => (isOn(b) - isOn(a)) || (a.name || "").localeCompare(b.name || ""));
  const dmOf = (name) => (hmConvs.find((c) => c.kind === "dm" && c.name === name) || {}).id || "";
  if (teamEl) teamEl.innerHTML = others.length
    ? others.map((u) => { const on = isOn(u), n = u.name || "?", dm = dmOf(n); return `<div class="rb-user"${dm ? ` data-rbconv="${dm}"` : ""}><div class="avatar-sm">${escapeHtml(initialsOf(n))}</div><span style="flex:1${on ? "" : ";color:var(--muted)"}">${escapeHtml(n)}</span><span class="status-dot ${on ? "on" : "off"}"></span></div>`; }).join("")
    : '<div class="rb-empty">—</div>';
  const gs = hmConvs.filter((c) => c.kind === "group" || c.kind === "channel");
  if (groupsEl) groupsEl.innerHTML = gs.length
    ? gs.map((c) => `<div class="rb-user" data-rbconv="${c.id}"><div class="avatar-sm">${c.kind === "channel" ? "#" : escapeHtml(initialsOf(c.name))}</div><span style="flex:1">${escapeHtml(c.name)}</span>${c.unread ? `<span class="rb-unread">${c.unread}</span>` : ""}</div>`).join("")
    : '<div class="rb-empty">Aucun groupe.</div>';
}
function rbRenderMail() {
  const unread = irMails.filter((m) => m.dir === "in" && m.unread && !m.trash).slice(0, 6);
  const cnt = $("rbMailCount"); if (cnt) cnt.textContent = unread.length || "";
  $("rbMailUnread").innerHTML = unread.length
    ? unread.map((m) => `<div class="rb-mrow" data-rbmail="${m.id}"><div class="avatar-sm">${escapeHtml(initialsOf(m.toName))}</div><div style="flex:1;min-width:0;"><div class="rb-mfrom">${escapeHtml(m.toName)}</div><div class="rb-msubj">${escapeHtml(m.subject)}</div></div></div>`).join("")
    : '<div class="rb-empty">✨ Boîte à zéro.</div>';
  $("rbMailLive").innerHTML = irEventFeed().slice(0, 5).map(({ m, e, ts }) => `<div class="rb-mrow" data-rbmail="${m.id}"><span class="rb-mact">${IR_EV_ICON[e.k]}</span><div style="flex:1;min-width:0;"><div class="rb-mline"><b>${escapeHtml(m.toName)}</b> ${IR_EV_VERB[e.k]}</div><div class="rb-msubj">« ${escapeHtml(m.subject)} »</div></div><span class="rb-mago">${irAgo(ts)}</span></div>`).join("") || '<div class="rb-empty">Aucune activité.</div>';
}
$("rightbar").addEventListener("click", (e) => {
  const c = e.target.closest("[data-rbconv]");
  if (c) {
    const id = c.dataset.rbconv;
    // Dans Hermès : ouvre la conversation dans l'app. Ailleurs : ouvre la bulle flottante.
    if ($("page-hermes") && $("page-hermes").classList.contains("show") && typeof openConv === "function") { $("rbChatBubble").classList.remove("show", "full"); openConv(id); }
    else rbChatOpen(id);
    return;
  }
  const ev = e.target.closest("[data-rbev]");
  if (ev) { const o = rbEvById[ev.dataset.rbev]; if (o) rbEvOpen(o); return; }
  const r = e.target.closest("[data-rbmail]"); if (!r) return;
  const m = irMails.find((x) => x.id === r.dataset.rbmail); if (!m) return;
  rbMailOpen(m.id);
});

// ══════════ Bulle de chat flottante (+ agrandir → modal plein écran) ══════════
// État séparé de Hermès (n'interfère pas avec #chatMessages/hmCur). Réutilise chatList/chatSend
// pour le canal réel « Équipe », et conv.msgs pour les conversations de démo (DM/groupes).
let rbcConv = null, rbcTimer = null;
function rbcNorm(c, realMsgs) {
  if (c.real) return (realMsgs || []).map((m) => ({ mine: m.user_id === currentUserId, author: m.author_name || "?", body: m.body, time: fmtTime(m.created_at) }));
  return (c.msgs || []).map((m) => ({ mine: !!m.mine, author: m.a || c.name, body: m.kind === "text" || !m.kind ? m.body : m.kind === "voice" ? "🎙 Message vocal" : m.kind === "image" ? "📷 Photo" : "📎 " + (m.name || "fichier"), time: m.t || "" }));
}
async function rbChatRefresh(scrollEnd) {
  const c = rbcConv; if (!c) return;
  let msgs;
  if (c.real) { const r = await window.olympus.chatList(0).catch(() => ({ ok: false })); if (rbcConv !== c) return; msgs = rbcNorm(c, r.ok ? r.messages : []); }
  else msgs = rbcNorm(c);
  const box = $("rbcMsgs"); if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  box.innerHTML = msgs.length
    ? msgs.map((m) => `<div class="rbc-b ${m.mine ? "me" : "them"}">${!m.mine && c.kind !== "dm" && m.author ? `<div class="rbc-au">${escapeHtml(m.author)}</div>` : ""}<div class="rbc-bd">${escapeHtml(m.body)}</div><div class="rbc-tm">${escapeHtml(m.time)}</div></div>`).join("")
    : `<div class="rb-empty" style="padding:14px 4px">Aucun message — lance la conversation.</div>`;
  if (scrollEnd || near) box.scrollTop = box.scrollHeight;
}
function rbChatOpen(id) {
  const c = hmConvs.find((x) => x.id === id); if (!c) return;
  rbcConv = c; c.unread = 0;
  $("rbcAv").textContent = c.kind === "channel" ? "◎" : initialsOf(c.name);
  $("rbcName").textContent = c.name;
  $("rbcSub").textContent = c.kind === "channel" ? (c.sub || "") : c.kind === "group" ? (c.members || []).join(" · ") : (c.online ? "en ligne" : "hors ligne");
  $("rbEvBubble").classList.remove("show"); $("rbMailBubble").classList.remove("show", "full"); // pas deux bulles superposées
  $("rbChatBubble").classList.add("show");
  $("rbcMsgs").innerHTML = "";
  rbChatRefresh(true);
  if (rbcTimer) clearInterval(rbcTimer);
  if (c.real) rbcTimer = setInterval(() => rbChatRefresh(false), 3000);
  if (rbView === 1) rbRenderChat();
  rbcAtts = []; if (typeof renderAttChips === "function") renderAttChips();
  if (typeof renderSchedChips === "function") renderSchedChips();
}
function rbChatClose() {
  $("rbChatBubble").classList.remove("show", "full");
  $("rbcBackdrop").classList.remove("show");
  if (rbcTimer) { clearInterval(rbcTimer); rbcTimer = null; }
  rbcConv = null;
}
function rbChatSetFull(full) {
  const el = $("rbChatBubble");
  el.classList.toggle("full", full);
  $("rbcBackdrop").classList.toggle("show", full);
  $("rbcFull").textContent = full ? "⤡" : "⤢";
  $("rbcFull").title = full ? "Réduire" : "Agrandir";
  const box = $("rbcMsgs"); if (box) box.scrollTop = box.scrollHeight;
}
async function rbChatSend() {
  const inp = $("rbcInput"), body = inp.value.trim();
  if ((!body && !rbcAtts.length) || !rbcConv) return;
  inp.value = "";
  const atts = rbcAtts.slice(); rbcAtts = []; renderAttChips();
  const hm = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (rbcConv.real) {
    const txt = [body, ...atts.map((a) => "📎 " + a.name)].filter(Boolean).join("\n");
    if (txt) { const r = await window.olympus.chatSend(txt); if (r && r.ok) rbChatRefresh(true); }
  } else {
    if (body) rbcConv.msgs.push({ kind: "text", body, mine: true, t: hm, d: "Aujourd'hui" });
    for (const a of atts) rbcConv.msgs.push({ kind: "file", name: a.name, mine: true, t: hm, d: "Aujourd'hui" });
    rbChatRefresh(true);
  }
  if (typeof renderConvList === "function") renderConvList();
}
$("rbcSend").onclick = rbChatSend;
$("rbcInput").addEventListener("keydown", (e) => { if (e.key === "Enter") rbChatSend(); });
$("rbcClose").onclick = rbChatClose;
$("rbcFull").onclick = () => rbChatSetFull(!$("rbChatBubble").classList.contains("full"));
$("rbcBackdrop").onclick = () => { if ($("rbMailBubble").classList.contains("full")) rbMailSetFull(false); else rbChatSetFull(false); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("rbChatBubble").classList.contains("show")) { if ($("rbChatBubble").classList.contains("full")) rbChatSetFull(false); else rbChatClose(); } });

// ══════════ Bulle de détail d'un événement (clic sur un événement de l'agenda) ══════════
const CAT_LABEL = { call: "Appel", rdv: "Rendez-vous", reunion: "Réunion", shoot: "Shooting", rendu: "Rendu", campagne: "Campagne", client: "Client", deadline: "Deadline", divers: "Divers", general: "Général", client_meeting: "RDV client", apple: "Agenda Apple" };
let rbEvCur = null;
function rbEvWeekday(iso) { try { return new Date(iso + "T00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); } catch { return iso; } }
function rbEvSchedule(e) {
  const st = e.time ? e.time.slice(0, 5) : "", en = e.end_time ? e.end_time.slice(0, 5) : "";
  const multi = e.end_date && e.end_date > e.date;
  if (multi) { const a = (e.all_day || !st) ? rbEvWeekday(e.date) : `${rbEvWeekday(e.date)} à ${st}`; const b = (e.all_day || !en) ? rbEvWeekday(e.end_date) : `${rbEvWeekday(e.end_date)} à ${en}`; return `Du ${a}\nau ${b}`; }
  if (e.all_day || (!st && !en)) return `${rbEvWeekday(e.date)}\nToute la journée`;
  let dur = "";
  if (st && en) { const [sh, sm] = st.split(":").map(Number), [eh, em] = en.split(":").map(Number); const m = (eh * 60 + em) - (sh * 60 + sm); if (m > 0) { const h = Math.floor(m / 60), mm = m % 60; dur = " (" + (h ? h + "h" + (mm ? String(mm).padStart(2, "0") : "") : mm + "min") + ")"; } }
  return `${rbEvWeekday(e.date)}\n${st && en ? `${st} – ${en}` : st ? `dès ${st}` : "→ " + en}${dur}`;
}
function rbEvOpen(ev) {
  rbEvCur = ev;
  $("rbChatBubble").classList.remove("show", "full"); $("rbMailBubble").classList.remove("show", "full"); $("rbcBackdrop").classList.remove("show"); // pas deux bulles en même temps
  $("rbevDot").style.background = ev.is_personal ? "var(--err)" : catColor(ev.category);
  $("rbevTitle").textContent = ev.title || "Événement";
  $("rbevCat").textContent = ev.is_personal ? "Personnel" : (CAT_LABEL[ev.category] || ev.category || "Événement");
  const val = (v) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : (v == null ? "" : String(v))).trim();
  const row = (ic, v) => { const s = val(v); return s ? `<div class="rbev-row"><span class="rbev-ic">${ic}</span><span class="rbev-v">${escapeHtml(s)}</span></div>` : ""; };
  let html = row("📅", rbEvSchedule(ev)) + row("👤", ev.assignee) + row("📍", ev.location) + row("🏢", ev.client) + row("🎬", ev.shoot_type) + row("👥", ev.participants) + (ev.delivery_date ? row("📦", "Livraison le " + rbEvWeekday(ev.delivery_date)) : "");
  if (ev.objectives) html += `<div class="rbev-notes"><b>Objectifs</b>\n${escapeHtml(ev.objectives)}</div>`;
  if (ev.shotlist) html += `<div class="rbev-notes"><b>Shotlist</b>\n${escapeHtml(ev.shotlist)}</div>`;
  if (ev.notes) html += `<div class="rbev-notes">${escapeHtml(ev.notes)}</div>`;
  $("rbevBody").innerHTML = html;
  $("rbEvBubble").classList.add("show");
}
function rbEvClose() { $("rbEvBubble").classList.remove("show"); rbEvCur = null; }
$("rbevClose").onclick = rbEvClose;
$("rbevOpen").onclick = () => { rbEvClose(); goTo("chronos"); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("rbEvBubble").classList.contains("show")) rbEvClose(); });

// ══════════ Bulle mail : fil de discussion + réponse (façon Gmail), + agrandir ══════════
let rbmCur = null;
function rbMailRenderThread() {
  const m = rbmCur; if (!m) return;
  const thread = irThreadOf(m);
  $("rbmThread").innerHTML = thread.map((t) => {
    const mine = t.dir !== "in";
    const who = mine ? (t.by || "Moi") : (t.toName || t.to || "?");
    const atts = (t.atts || []).length ? `<div class="rbm-atts">${t.atts.map((a) => `<span class="rbm-att">📎 ${escapeHtml(a.name || "pièce jointe")}</span>`).join("")}</div>` : "";
    return `<div class="rbm-msg${mine ? " me" : ""}"><div class="rbm-mh"><span class="rbm-who">${escapeHtml(who)}</span><span class="rbm-when">${escapeHtml(t.when || "")}</span></div><div class="rbm-mb">${escapeHtml(t.body || t.preview || "")}</div>${atts}</div>`;
  }).join("");
  const box = $("rbmThread"); box.scrollTop = box.scrollHeight;
}
function rbMailOpen(id) {
  const m = irMails.find((x) => x.id === id); if (!m) return;
  rbmCur = m; m.unread = false;
  $("rbChatBubble").classList.remove("show", "full"); $("rbEvBubble").classList.remove("show"); $("rbcBackdrop").classList.remove("show");
  $("rbmAv").textContent = "✉";
  $("rbmName").textContent = m.toName || m.to || "Mail";
  $("rbmSub").textContent = m.subject || "";
  $("rbMailBubble").classList.add("show");
  rbMailRenderThread();
  try { renderIrStats && renderIrStats(); renderIrFolders && renderIrFolders(); if (typeof irSel !== "undefined" && document.querySelector("#page-iris")) renderIrList(); } catch {}
  rbRenderMail();
  rbmAtts = []; if (typeof renderAttChips === "function") renderAttChips();
  if (typeof renderSchedChips === "function") renderSchedChips();
}
function rbMailAutosize() { const t = $("rbmReplyText"); if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }
function rbMailReply() {
  const t = $("rbmReplyText"), body = t.value.trim();
  if ((!body && !rbmAtts.length) || !rbmCur) return;
  t.value = ""; rbMailAutosize();
  const atts = rbmAtts.map((a) => ({ name: a.name, size: a.size })); rbmAtts = []; renderAttChips();
  const now = new Date();
  const when = now.getDate() + " " + MON_ABBR[now.getMonth()] + " · " + now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const nm = { id: "m" + Date.now(), to: rbmCur.to, toName: rbmCur.toName || rbmCur.to, client: rbmCur.client || "", cc: [], by: "Sacha", when, subject: /^re\s*:/i.test(rbmCur.subject || "") ? rbmCur.subject : "Re: " + (rbmCur.subject || ""), preview: (body || (atts[0] ? "📎 " + atts[0].name : "")).replace(/^\s+/, "").slice(0, 90), body, atts, events: [{ k: "sent", w: when }], labels: (rbmCur.labels || []).slice() };
  irMails.unshift(nm);
  rbmCur = nm; // rester sur le fil (même thread key)
  rbMailRenderThread();
  atToast("✅ Réponse ajoutée au fil.");
  try { irApplyRules && irApplyRules(); renderIrStats && renderIrStats(); renderIrFolders && renderIrFolders(); if (document.querySelector("#page-iris")) renderIrList(); } catch {}
  rbRenderMail();
}
function rbMailSetFull(full) {
  const el = $("rbMailBubble");
  el.classList.toggle("full", full);
  $("rbcBackdrop").classList.toggle("show", full);
  $("rbmFull").textContent = full ? "⤡" : "⤢";
  $("rbmFull").title = full ? "Réduire" : "Agrandir";
  const b = $("rbmThread"); if (b) b.scrollTop = b.scrollHeight;
}
function rbMailClose() { $("rbMailBubble").classList.remove("show", "full"); $("rbcBackdrop").classList.remove("show"); rbmCur = null; }
$("rbmClose").onclick = rbMailClose;
$("rbmFull").onclick = () => rbMailSetFull(!$("rbMailBubble").classList.contains("full"));
$("rbmReplySend").onclick = rbMailReply;
$("rbmReplyText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); rbMailReply(); } });
$("rbmReplyText").addEventListener("input", rbMailAutosize);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("rbMailBubble").classList.contains("show")) { if ($("rbMailBubble").classList.contains("full")) rbMailSetFull(false); else rbMailClose(); } });

// ══════════ « Préparer une réponse » — brouillon rédigé par l'API Claude (clé stockée par Olympus) ══════════
async function aiEnsureKey() { const h = await window.olympus.aiHasKey().catch(() => ({ has: false })); return (h && h.has) ? true : aiKeyModal(); }
function aiKeyModal() {
  return new Promise((resolve) => {
    const ov = document.createElement("div"); ov.className = "modal-overlay show";
    ov.innerHTML = `<div class="modal-panel" style="width:470px;max-width:92vw;"><div class="modal-body" style="padding:22px;">
      <h2 style="font-size:15px;margin:0 0 6px;">Clé API Claude</h2>
      <p style="font-size:12.5px;color:var(--muted);line-height:1.55;margin:0 0 14px;">macOS chiffre la clé de Zevs <b>par application</b> — Olympus ne peut pas la lire directement. Colle-la ici une seule fois : Olympus la stocke chiffrée (Keychain), elle ne quitte jamais ta machine sauf pour appeler l'API Claude.</p>
      <input id="aiKeyInput" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" style="width:100%;border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--txt);outline:none;">
      <div id="aiKeyMsg" style="font-size:11.5px;color:var(--err);min-height:15px;margin:6px 2px 12px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn sec" data-no>Annuler</button><button class="btn" data-yes>Enregistrer</button></div>
    </div></div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector("#aiKeyInput"), msg = ov.querySelector("#aiKeyMsg");
    setTimeout(() => inp.focus(), 30);
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector("[data-no]").onclick = () => done(false);
    const save = async () => { const r = await window.olympus.aiSetKey(inp.value).catch((e) => ({ ok: false, error: String(e) })); if (r && r.ok) done(true); else msg.textContent = (r && r.error) || "Échec."; };
    ov.querySelector("[data-yes]").onclick = save;
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
    ov.onclick = (e) => { if (e.target === ov) done(false); };
  });
}
// Coût d'une requête IA : centimes d'euro si < 0,01 €, sinon en euros.
function aiFmtCost(c) {
  if (!c || c.eur == null) return "";
  return c.eur < 0.01 ? `≈ ${(c.eur * 100).toFixed(2).replace(".", ",")} ¢` : `≈ ${c.eur.toFixed(3).replace(".", ",")} €`;
}
async function aiPrepareReply(kind, insertEl, btn, mode, ctx) {
  if (!insertEl) return;
  mode = mode || "draft";
  const draft = (ctx && typeof ctx.draftText === "function") ? ctx.draftText() : insertEl.value.trim();
  if (mode === "improve" && !draft) { if (typeof atToast === "function") atToast("Écris d'abord un message à améliorer."); return; }
  if (!(await aiEnsureKey())) return;
  let participants = "", messages = [];
  if (ctx && typeof ctx.gather === "function") {
    participants = ctx.participants || "";
    messages = (await ctx.gather()) || [];
  } else if (kind === "mail") {
    const m = rbmCur; if (!m) return;
    participants = m.toName || m.to || "";
    messages = irThreadOf(m).map((t) => ({ who: t.dir !== "in" ? "Moi" : (t.toName || t.to || "?"), text: t.body || t.preview || "" }));
  } else {
    const c = rbcConv; if (!c) return;
    participants = c.name || "";
    let msgs;
    if (c.real) { const r = await window.olympus.chatList(0).catch(() => ({ ok: false })); msgs = rbcNorm(c, r.ok ? r.messages : []); } else msgs = rbcNorm(c);
    messages = msgs.map((m) => ({ who: m.mine ? "Moi" : (m.author || participants), text: m.body }));
  }
  if (mode === "draft" && !messages.length) { if (typeof atToast === "function") atToast("Rien à lire dans cette conversation."); return; }
  const priceEl = (ctx && ctx.priceEl) ? ctx.priceEl : $(kind === "mail" ? "rbmAiPrice" : "rbcAiPrice");
  if (btn) { btn.disabled = true; btn.classList.add("busy"); }
  if (priceEl) { priceEl.textContent = "…"; priceEl.title = ""; }
  const r = await window.olympus.aiDraftReply({ kind, participants, messages, mode, draft }).catch((e) => ({ ok: false, error: String(e) }));
  if (btn) { btn.disabled = false; btn.classList.remove("busy"); }
  if (!r || !r.ok) {
    if (priceEl) priceEl.textContent = "";
    if (r && r.needKey) { if (await aiKeyModal()) return aiPrepareReply(kind, insertEl, btn, mode, ctx); return; }
    if (typeof atToast === "function") atToast("Échec IA : " + ((r && r.error) || "inconnu")); else alert("Échec : " + ((r && r.error) || ""));
    return;
  }
  if (priceEl && r.cost) { priceEl.textContent = aiFmtCost(r.cost); priceEl.title = `Entrée ${r.cost.inTok} tokens · sortie ${r.cost.outTok} tokens (estimé)`; }
  if (ctx && typeof ctx.apply === "function") ctx.apply(r.text, mode); else insertEl.value = r.text;
  insertEl.focus();
  if (insertEl.id === "rbmReplyText" && typeof rbMailAutosize === "function") rbMailAutosize();
}
$("rbcAiBtn").onclick = (e) => aiPrepareReply("chat", $("rbcInput"), e.currentTarget, "draft");
$("rbcImpBtn").onclick = (e) => aiPrepareReply("chat", $("rbcInput"), e.currentTarget, "improve");
$("rbmAiBtn").onclick = (e) => aiPrepareReply("mail", $("rbmReplyText"), e.currentTarget, "draft");
$("rbmImpBtn").onclick = (e) => aiPrepareReply("mail", $("rbmReplyText"), e.currentTarget, "improve");

// ══════════ Programmer l'envoi (chat + mail) — file locale, exécutée tant qu'Olympus est ouvert ══════════
let rbSched = (() => { try { return JSON.parse(localStorage.getItem("rbSched") || "[]"); } catch { return []; } })();
const rbSchedSave = () => { try { localStorage.setItem("rbSched", JSON.stringify(rbSched)); } catch {} };
function rbSchedFmt(ts) { const d = new Date(ts), hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); return d.toDateString() === new Date().toDateString() ? hm : `${d.getDate()}/${d.getMonth() + 1} ${hm}`; }
function renderSchedChips() {
  const fill = (el, list) => { if (!el) return; el.innerHTML = list.map((e) => `<span class="rbc-schedchip">🕐 Programmé ${rbSchedFmt(e.when)} <b data-schedcancel="${e.id}">✕</b></span>`).join(""); };
  fill($("rbcSchedChips"), rbcConv ? rbSched.filter((e) => e.kind === "chat" && e.convId === rbcConv.id) : []);
  fill($("rbmSchedChips"), rbmCur ? rbSched.filter((e) => e.kind === "mail" && e.mailKey === rbmCur.id) : []);
  fill($("chatSchedChips"), (typeof hmCur !== "undefined" && hmCur) ? rbSched.filter((e) => e.kind === "chat" && e.convId === hmCur.id) : []);
}
function rbSchedFire() {
  const now = Date.now(); let fired = false;
  for (const e of rbSched.slice()) {
    if (e.when > now) continue;
    try {
      if (e.kind === "mail") {
        const when = new Date().getDate() + " " + MON_ABBR[new Date().getMonth()] + " · " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        irMails.unshift({ id: "m" + Date.now(), to: e.to, toName: e.toName || e.to, client: e.client || "", cc: [], by: "Sacha", when, subject: e.subject, preview: (e.body || "").slice(0, 90), body: e.body, atts: [], events: [{ k: "sent", w: when }], labels: e.labels || [] });
        if (rbmCur && rbmCur.id === e.mailKey) rbMailRenderThread();
      } else {
        const c = hmConvs.find((x) => x.id === e.convId);
        if (c && c.real) window.olympus.chatSend(e.body);
        else if (c) { c.msgs.push({ kind: "text", body: e.body, mine: true, t: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), d: "Aujourd'hui" }); if (rbcConv && rbcConv.id === e.convId) rbChatRefresh(true); if (typeof hmCur !== "undefined" && hmCur && hmCur.id === e.convId) renderFakeMsgs(hmCur); }
      }
      if (typeof atToast === "function") atToast("🕐 Message programmé envoyé.");
    } catch {}
    rbSched = rbSched.filter((x) => x.id !== e.id); fired = true;
  }
  if (fired) { rbSchedSave(); renderSchedChips(); }
}
function rbSchedOpen(kind, insertEl, anchorBtn, ctx) {
  const body = insertEl.value.trim();
  if (!body) { if (typeof atToast === "function") atToast("Écris d'abord un message à programmer."); return; }
  const conv = (ctx && ctx.conv) || rbcConv;
  if (kind === "chat" && !conv) return;
  if (kind === "mail" && !rbmCur) return;
  document.querySelectorAll(".rb-schedpop").forEach((p) => p.remove());
  const at = (h, m, nextDay) => { const d = new Date(); d.setHours(h, m, 0, 0); if (nextDay || d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); };
  const presets = [{ label: "Dans 1 heure", ts: Date.now() + 3600e3 }, { label: "Ce soir 18:00", ts: at(18, 0, false) }, { label: "Demain 9:00", ts: at(9, 0, true) }];
  const pop = document.createElement("div"); pop.className = "rb-schedpop";
  pop.innerHTML = presets.map((p) => `<div class="rb-schedopt" data-ts="${p.ts}">${p.label}<span>${rbSchedFmt(p.ts)}</span></div>`).join("") + `<div class="rb-schedcustom"><input type="datetime-local" id="rbSchedDt"><button id="rbSchedGo">Programmer</button></div>`;
  document.body.appendChild(pop);
  const r = anchorBtn.getBoundingClientRect();
  pop.style.left = Math.max(10, Math.min(r.left - 60, window.innerWidth - pop.offsetWidth - 10)) + "px";
  pop.style.top = (r.top - pop.offsetHeight - 8) + "px";
  const schedule = (ts) => {
    if (!ts || ts <= Date.now()) { if (typeof atToast === "function") atToast("Choisis une heure future."); return; }
    const entry = { id: "s" + Date.now(), kind, when: ts, body };
    if (kind === "mail") { entry.mailKey = rbmCur.id; entry.to = rbmCur.to; entry.toName = rbmCur.toName; entry.client = rbmCur.client || ""; entry.labels = (rbmCur.labels || []).slice(); entry.subject = /^re\s*:/i.test(rbmCur.subject || "") ? rbmCur.subject : "Re: " + (rbmCur.subject || ""); }
    else entry.convId = conv.id;
    rbSched.push(entry); rbSchedSave();
    insertEl.value = ""; if (insertEl.id === "rbmReplyText" && typeof rbMailAutosize === "function") rbMailAutosize();
    if (typeof atToast === "function") atToast("🕐 Envoi programmé — " + rbSchedFmt(ts));
    pop.remove(); renderSchedChips();
  };
  pop.querySelectorAll("[data-ts]").forEach((o) => o.onclick = () => schedule(+o.dataset.ts));
  pop.querySelector("#rbSchedGo").onclick = () => { const v = pop.querySelector("#rbSchedDt").value; if (v) schedule(new Date(v).getTime()); };
  setTimeout(() => { const close = (ev) => { if (!ev.target.closest(".rb-schedpop") && ev.target !== anchorBtn) { pop.remove(); document.removeEventListener("mousedown", close, true); } }; document.addEventListener("mousedown", close, true); }, 0);
}
$("rbcSchedBtn").onclick = (e) => rbSchedOpen("chat", $("rbcInput"), e.currentTarget);
$("rbmSchedBtn").onclick = (e) => rbSchedOpen("mail", $("rbmReplyText"), e.currentTarget);
["rbcSchedChips", "rbmSchedChips", "chatSchedChips"].forEach((id) => { const el = $(id); if (el) el.addEventListener("click", (e) => { const c = e.target.closest("[data-schedcancel]"); if (!c) return; rbSched = rbSched.filter((x) => x.id !== c.dataset.schedcancel); rbSchedSave(); renderSchedChips(); if (typeof atToast === "function") atToast("Programmation annulée."); }); });
setInterval(rbSchedFire, 15000); rbSchedFire();

// ══════════ Pièces jointes (chat + mail) ══════════
let rbcAtts = [], rbmAtts = [];
const rbFmtBytes = (n) => n < 1024 ? n + " o" : n < 1048576 ? Math.round(n / 1024) + " Ko" : (n / 1048576).toFixed(1).replace(".", ",") + " Mo";
function renderAttChips() {
  const fill = (el, list, w) => { if (!el) return; el.innerHTML = list.map((a, i) => `<span class="rbc-attchip" title="${escapeHtml(a.name)}">📎 ${escapeHtml(a.name.length > 24 ? a.name.slice(0, 22) + "…" : a.name)} <span style="color:var(--dim)">${rbFmtBytes(a.size)}</span> <b data-attrm="${w}:${i}">✕</b></span>`).join(""); };
  fill($("rbcAttChips"), rbcAtts, "c"); fill($("rbmAttChips"), rbmAtts, "m");
}
function rbAttAdd(which, fileList) { const arr = which === "m" ? rbmAtts : rbcAtts; for (const f of fileList) arr.push({ name: f.name, size: f.size, file: f }); renderAttChips(); }
$("rbcAttBtn").onclick = () => $("rbcFileInput").click();
$("rbmAttBtn").onclick = () => $("rbmFileInput").click();
$("rbcFileInput").onchange = (e) => { rbAttAdd("c", e.target.files); e.target.value = ""; };
$("rbmFileInput").onchange = (e) => { rbAttAdd("m", e.target.files); e.target.value = ""; };
["rbcAttChips", "rbmAttChips"].forEach((id) => { const el = $(id); if (el) el.addEventListener("click", (e) => { const b = e.target.closest("[data-attrm]"); if (!b) return; const [w, i] = b.dataset.attrm.split(":"); (w === "m" ? rbmAtts : rbcAtts).splice(+i, 1); renderAttChips(); }); });

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
    // Ne JAMAIS fabriquer de fausses ouvertures/lectures sur des mails RÉELS envoyés via Gmail
    // (nm.real = envoi effectif) — la simulation ne touche que les mails de démonstration.
    const outs = irMails.filter((m) => !m.real && m.dir !== "in" && !m.draft && !m.trash && m.events.length);
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
      <div class="ir-rmain">
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
  const G = '<div class="ir-row ghost"><div class="ir-av gav"></div><div class="ir-rmain"><div class="gline w1"></div><div class="gline" style="width:58%;"></div></div></div>';
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
  // Calendrier Apple (iCloud)
  const ast = await window.olympus.appleStatus();
  const adot = $("connAppleDot"), ast2 = $("connAppleStatus"), abtn = $("connAppleBtn"), adc = $("apDisconnect");
  if (adot) {
    if (ast.connected) { adot.className = "conn-dot on"; ast2.textContent = "connecté · " + ast.email + (ast.calendars?.length ? ` · ${ast.calendars.length} calendrier(s)` : ""); abtn.textContent = "Gérer"; if (adc) adc.style.display = ""; renderAppleCals(ast); }
    else { adot.className = "conn-dot off"; ast2.textContent = "non connecté"; abtn.textContent = "Connecter"; if (adc) adc.style.display = "none"; }
  }
}
function renderAppleCals(ast) {
  const box = $("apCals"); if (!box) return;
  if (!ast.connected || !(ast.calendars && ast.calendars.length)) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="mq-label">Calendrier où Chronos écrit les nouveaux événements</div>
    <select class="mood-in" id="apSyncSel">${ast.calendars.map((c) => `<option value="${escapeHtml(c.url)}"${ast.sync === c.url ? " selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>
    <div class="desc" style="margin-top:8px;">Calendriers lus dans Chronos : ${ast.calendars.map((c) => escapeHtml(c.name)).join(" · ")}</div>`;
  $("apSyncSel").onchange = () => window.olympus.appleSetSync($("apSyncSel").value);
}
$("connAppleBtn").onclick = async () => {
  const f = $("appleForm"); const show = f.style.display === "none"; f.style.display = show ? "block" : "none";
  if (show) { const ast = await window.olympus.appleStatus(); if (ast.email) $("apEmail").value = ast.email; renderAppleCals(ast); }
};
$("apConnectBtn").onclick = async () => {
  const email = $("apEmail").value.trim(), pass = $("apPass").value.trim(), msg = $("apMsg"), btn = $("apConnectBtn");
  if (!email || !pass) { msg.className = "msg err"; msg.textContent = "Identifiant Apple et mot de passe d'application requis."; return; }
  btn.disabled = true; msg.className = "msg"; msg.textContent = "Connexion à iCloud… (quelques secondes)";
  const r = await window.olympus.appleConnect(email, pass);
  btn.disabled = false;
  if (r.ok) { $("apPass").value = ""; msg.className = "msg ok"; msg.textContent = `✅ iCloud connecté — ${r.calendars.length} calendrier(s) trouvé(s).`; refreshConnections(); }
  else { msg.className = "msg err"; msg.textContent = r.error; }
};
$("apDisconnect").onclick = async () => { await window.olympus.appleDisconnect(); $("apCals").innerHTML = ""; refreshConnections(); };
$("connGmailBtn").onclick = async () => {
  const f = $("gmailForm"); const show = f.style.display === "none"; f.style.display = show ? "block" : "none";
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
// IA (Iris) : rédige/améliore la réponse au-dessus du fil cité, sans écraser la citation.
function irSplitBody() { const v = $("irBody").value; const i = v.indexOf("\n\n— Le "); return i === -1 ? { typed: v, quote: "" } : { typed: v.slice(0, i), quote: v.slice(i) }; }
function irAiCtx() {
  return {
    participants: $("irToName").value.trim() || $("irTo").value.trim() || "",
    priceEl: $("irAiPrice"),
    draftText: () => irSplitBody().typed.trim(),
    apply: (text) => { const { quote } = irSplitBody(); $("irBody").value = text + quote; $("irBody").focus(); $("irBody").setSelectionRange(0, 0); },
    gather: async () => {
      const m = irMails.find((x) => x.id === irReplyMailId);
      if (!m) return [];
      return irThreadOf(m).map((t) => ({ who: t.dir !== "in" ? "Moi" : (t.toName || t.to || "?"), text: t.body || t.preview || "" })).filter((x) => x.text);
    },
  };
}
$("irAiBtn").onclick = (e) => aiPrepareReply("mail", $("irBody"), e.currentTarget, "draft", irAiCtx());
$("irImpBtn").onclick = (e) => aiPrepareReply("mail", $("irBody"), e.currentTarget, "improve", irAiCtx());
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
  const nm = { id: "m" + Date.now(), real: sentReal, to: d.to, toName: d.toName || d.to, client: $("irClient").value.trim(), cc: $("irCc").value.split(",").map((x) => x.trim()).filter(Boolean), by: "Sacha", when, subject: d.subject, preview: d.body.replace(/^\s+/, "").slice(0, 90), body: d.body, atts: irAtts, events: [{ k: "sent", w: when }], labels: irReplyLabels ? irReplyLabels.slice() : [] };
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
// Argos v2 — social media management : marques, publication, inbox, écoute, ads,
// concurrence, rapport, connexions. Le renderer consomme les IPC argos:* ; tant que
// les plateformes ne sont pas connectées, le main sert des données de démo (demo:true).
let arState = null, arBrand = null, arCat = "meta", arView = "apercu", arPeriod = 30, arWeekOff = 0;
const arCache = {};
// Niveau 1 (sidebar) : catégories par plateforme. Niveau 2 (sous-onglets en haut du contenu) :
// les outils de la catégorie. Une catégorie à un seul outil n'affiche pas de sous-onglets.
const AR_CATS = [
  { id: "meta", ic: "📣", label: "Meta", tools: ["apercu", "audience", "publication", "inbox", "ecoute", "ads_meta"] },
  { id: "google", ic: "🔎", label: "Google", tools: ["web", "seo", "ads_google", "tendance", "notoriete"] },
  { id: "linkedin", ic: "💼", label: "LinkedIn", tools: ["li_apercu", "li_publication", "li_audience", "li_ads"] },
  { id: "veille", ic: "⚖", label: "Veille concurrentielle", tools: ["veille_meta", "veille_linkedin"] },
  { id: "rapport", ic: "▤", label: "Rapport", tools: ["rapport_gen", "rapport_planif", "rapport_exports"] },
];
const AR_TOOLS = {
  apercu: { label: "Aperçu", ic: "◎" }, audience: { label: "Audience", ic: "◐" },
  publication: { label: "Publication", ic: "🗓" }, inbox: { label: "Inbox", ic: "💬" },
  ecoute: { label: "Écoute", ic: "🜂" }, ads_meta: { label: "Publicité", ic: "▸" },
  web: { label: "Site web", ic: "🌐" }, seo: { label: "SEO", ic: "🔍" }, ads_google: { label: "Publicité", ic: "▸" },
  tendance: { label: "Tendance", ic: "📈" }, notoriete: { label: "Notoriété", ic: "⭐" },
  li_apercu: { label: "Aperçu", ic: "◎" }, li_publication: { label: "Publication", ic: "🗓" }, li_audience: { label: "Audience", ic: "◐" }, li_ads: { label: "Publicité", ic: "▸" },
  veille_meta: { label: "Meta", ic: "📣" }, veille_linkedin: { label: "LinkedIn", ic: "💼" },
  rapport_gen: { label: "Générateur", ic: "▤" }, rapport_planif: { label: "Rapports programmés", ic: "🗓" }, rapport_exports: { label: "Exports", ic: "⬇" },
};
const arCatOf = (viewId) => AR_CATS.find((c) => c.tools.includes(viewId)) || AR_CATS[0];
// Connexion requise par outil (au moins un de ces réseaux dans les assets du client). Outil absent = pas de dépendance.
const AR_TOOL_REQ = {
  apercu: ["facebook", "instagram"], audience: ["facebook", "instagram"], publication: ["facebook", "instagram"], inbox: ["facebook", "instagram"], ecoute: ["facebook", "instagram"], ads_meta: ["meta_ads"],
  web: ["google_analytics", "search_console"], seo: ["search_console"], ads_google: ["google_ads"], tendance: ["google_ads"], notoriete: ["google_ads"],
  li_apercu: ["linkedin"], li_publication: ["linkedin"], li_audience: ["linkedin"], li_ads: ["linkedin"],
};
const arToolConnected = (b, t) => { const req = AR_TOOL_REQ[t]; if (!req || !b) return true; return (b.assets || []).some((a) => req.includes(a.network)); };
const AR_NETS = {
  instagram: { ic: "📷", label: "Instagram" }, facebook: { ic: "👥", label: "Facebook" },
  tiktok: { ic: "🎵", label: "TikTok" }, linkedin: { ic: "💼", label: "LinkedIn" },
  x: { ic: "𝕏", label: "X" }, youtube: { ic: "▶️", label: "YouTube" },
  meta_ads: { ic: "📣", label: "Meta Ads" }, google_ads: { ic: "🔎", label: "Google Ads" }, web: { ic: "🌐", label: "Web" },
  google_analytics: { ic: "📊", label: "Analytics" }, search_console: { ic: "🔍", label: "Search Console" }, google_business: { ic: "📍", label: "Google Business" },
};
const arNet = (n) => AR_NETS[n] || { ic: "·", label: n };
// Navigue vers un outil (sous-vue), en synchronisant la catégorie parente + la colonne d'outils.
function arGoView(viewId) { arCat = arCatOf(viewId).id; arView = viewId; arSideRender(); arToolsRender(); arRenderView(); }
// Colonne de navigation : TOUTES les catégories empilées, chacune avec ses outils. Toujours
// visible. Une catégorie mono-outil s'affiche comme un item direct (pas d'en-tête redondant).
const arToolItem = (t, ic, label, b) => { const conn = arToolConnected(b, t); return `<div class="ir-folder${arView === t ? " active" : ""}${conn ? "" : " notconn"}" data-tool="${t}"${conn ? "" : ` data-locked="1" title="Connecter le client pour accéder à la vue"`}><span class="fic">${ic}</span><span class="lname">${escapeHtml(label)}</span></div>`; };
function arToolsRender() {
  const el = $("arTools"); if (!el) return;
  const b = arBrandOf();
  el.innerHTML = AR_CATS.map((c) => {
    if (c.tools.length < 2) return arToolItem(c.tools[0], c.ic, c.label, b);
    return `<div class="ar-cat" style="margin:14px 2px 6px;">${escapeHtml(c.label)}</div>` +
      c.tools.map((t) => { const tt = AR_TOOLS[t] || { label: t, ic: "·" }; return arToolItem(t, tt.ic, tt.label, b); }).join("");
  }).join("");
  el.querySelectorAll(".ir-folder").forEach((bt) => bt.onclick = () => { if (bt.dataset.locked) return; if (arView === bt.dataset.tool) return; arView = bt.dataset.tool; arCat = arCatOf(bt.dataset.tool).id; arToolsRender(); arRenderView(); });
}
const arAgo = (h) => h < 1 ? "à l'instant" : h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
const AR_DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
function arInvalidate(brandId) { Object.keys(arCache).forEach((k) => (!brandId || k.startsWith(brandId + ":")) && delete arCache[k]); }
async function arGet(key, fn) { if (arCache[key] === undefined) arCache[key] = await fn(); return arCache[key]; }
// Cache-first (Obj 1) : revoir une vue N'appelle PLUS l'API. On sert le cache instantanément, et on
// ne relance un vrai appel en tâche de fond QUE si la donnée est PÉRIMÉE (> 6 h — drapeau `stale`
// posé côté main par argosCached), pas à chaque visite. Les données fraîches ne sont jamais re-fetchées.
const arLastRefresh = {};
function arFlashStage() { const s = $("arStage"); if (!s) return; s.classList.remove("ar-flash"); void s.offsetWidth; s.classList.add("ar-flash"); }
function arKickRefresh(key, stillHere, forceFetch) {
  const cur = arCache[key];
  if (!cur || !cur.stale) return; // cache frais → aucun appel (c'est tout l'intérêt du cache persistant)
  const now = Date.now();
  if (arLastRefresh[key] && now - arLastRefresh[key] < 45000) return;
  arLastRefresh[key] = now;
  const before = JSON.stringify(cur);
  forceFetch().then((fresh) => {
    if (!fresh || JSON.stringify(fresh) === before) return;
    arCache[key] = fresh;
    if (stillHere()) { arFlashStage(); arRenderView(); }
  }).catch(() => {});
}

// Une marque masquée depuis Titan (client qu'on ne gère plus) n'apparaît nulle part dans
// Argos, mais reste en base (mapping Meta conservé) — juste décochée dans Titan pour revenir.
function arVisibleBrands() { return ((arState && arState.brands) || []).filter((b) => !b.hidden); }
// Précharge TOUTES les marques visibles/reliées dès la connexion à Olympus — le temps que
// l'utilisateur navigue jusqu'à Argos, tout est déjà en cache (côté main.js) et s'affiche
// instantanément. Ne bloque rien (fire-and-forget), n'affecte pas l'écran de connexion.
async function argosPrewarmAll() {
  try {
    const st = await window.olympus.argosState();
    if (!st.ok) return;
    const netOf = (b, n) => (b.assets || []).some((a) => a.network === n);
    const targets = (st.brands || []).filter((b) => !b.hidden && (b.assets || []).length);
    targets.forEach((b) => {
      if (netOf(b, "facebook") || netOf(b, "instagram")) { window.olympus.argosOverview(b.id, 30).catch(() => {}); window.olympus.argosInbox(b.id).catch(() => {}); }
      if (netOf(b, "instagram")) window.olympus.argosAudience(b.id).catch(() => {});
      if (netOf(b, "meta_ads") || netOf(b, "google_ads")) window.olympus.argosAds(b.id).catch(() => {});
      if (netOf(b, "google_analytics")) window.olympus.argosWeb(b.id, 30).catch(() => {});
      if (netOf(b, "search_console")) window.olympus.argosSeo(b.id, 30).catch(() => {});
    });
  } catch {}
}
async function renderArgos() {
  if (!arState) { const r = await window.olympus.argosState(); if (r.ok) arState = r; }
  if (!arState) { $("arStage").innerHTML = '<div class="ga-note">Argos indisponible.</div>'; return; }
  const visible = arVisibleBrands();
  if ((!arBrand || !visible.find((b) => b.id === arBrand)) && visible.length) arBrand = visible[0].id;
  arSideRender();
  arToolsRender();
  arRenderView();
}
function arSideRender() {
  const brands = arVisibleBrands();
  $("arBrands").innerHTML = brands.map((b) => `
    <div class="ar-brand${arBrand === b.id ? " active" : ""}" data-brand="${b.id}">
      <div class="bv">${initialsOf(b.name)}</div>
      <div style="flex:1;min-width:0;"><div class="bn">${escapeHtml(b.name)}</div><div class="bs">${escapeHtml(b.secteur || "")}</div></div>
      <button class="ar-bedit" data-editbrand="${b.id}" title="Modifier la marque">✎</button>
    </div>`).join("") || '<div class="bs" style="padding:4px 2px;color:var(--dim);">Aucune marque — crée la première.</div>';
  document.querySelectorAll("#arBrands .ar-brand").forEach((el) => el.onclick = (e) => { if (e.target.closest("[data-editbrand]")) return; arBrand = el.dataset.brand; arSideRender(); arToolsRender(); arRenderView(); });
  document.querySelectorAll("#arBrands [data-editbrand]").forEach((el) => el.onclick = (e) => { e.stopPropagation(); const b = brands.find((x) => x.id === el.dataset.editbrand); if (b) arBrandModal(b); });
}
function arBrandOf() { return arVisibleBrands().find((b) => b.id === arBrand) || null; }
function arConnected() { return Object.values((arState && arState.connections) || {}).some((c) => c.status === "connected"); }
function arDemoBadge() {
  // La gestion des connexions vit dans Titan (réservé aux gérants) — un salarié classic
  // n'a rien à cliquer ici, juste l'info qu'il faut demander à un gérant.
  if (currentRole === "super_admin") return `<span class="ar-demo">◌ Données de démonstration — <b data-goconn>connecter les comptes (Titan)</b></span>`;
  return `<span class="ar-demo">◌ Données de démonstration — demande à un gérant de connecter les comptes</span>`;
}
// Pour les vues qui ne DEVIENDRONT jamais réelles via Meta (pas d'API dispo) — pas de CTA
// "connecter les comptes" trompeur, juste une explication honnête.
function arDemoBadgePermanent(reason) {
  return `<span class="ar-demo" style="border-style:solid;">◌ Démonstration — ${escapeHtml(reason)}</span>`;
}
// isDemo : chaque vue le passe selon SA PROPRE donnée (r.data.demo) — ne dépend jamais de
// "Meta est connecté quelque part" (une marque non mappée reste en démo même une fois Meta connecté).
// Peut aussi être une chaîne (raison) pour les vues structurellement démo — cf. arDemoBadgePermanent.
function arHead(title, sub, extraHtml, isDemo = true) {
  const badge = typeof isDemo === "string" ? arDemoBadgePermanent(isDemo) : (isDemo ? arDemoBadge() : "");
  return `<div class="ga-head">
    <div class="ga-head-t"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(sub || "")}</span></div>
    <div class="ga-controls">${extraHtml || ""}${badge}</div>
  </div>`;
}
function arWireCommon(box) {
  const g = box.querySelector("[data-goconn]");
  if (g) g.onclick = () => goTo("titan");
}
// Jeton de rendu : une vue lente (appel Meta réel) qui se termine APRÈS un changement de vue
// ou de marque ne doit pas écraser l'écran actuel. arRenderAlive() est vérifié par chaque vue
// avant d'écrire box.innerHTML.
let arRenderGen = 0;
function arRenderAlive(tok) { return tok === arRenderGen; }
async function arRenderView() {
  const box = $("arStage");
  const b = arBrandOf();
  const tok = ++arRenderGen;
  if (!b) { box.innerHTML = `<div class="ga-note">Crée une marque pour commencer (Réglages → Argos — Clients → Nouvelle marque).</div>`; return; }
  box.innerHTML = `<div class="ga-note">Chargement…</div>`;
  try {
    if (arView === "apercu") await arViewApercu(box, b, tok);
    else if (arView === "audience") await arViewAudience(box, b, tok);
    else if (arView === "publication") await arViewPublication(box, b, tok);
    else if (arView === "inbox") await arViewInbox(box, b, tok);
    else if (arView === "ecoute") await arViewEcoute(box, b, tok);
    else if (arView === "ads_meta") await arViewAds(box, b, tok, "meta");
    else if (arView === "ads_google") await arViewAds(box, b, tok, "google");
    else if (arView === "tendance") await arViewTendance(box, b, tok);
    else if (arView === "notoriete") await arViewNotoriete(box, b, tok);
    else if (arView === "web") await arViewWeb(box, b, tok);
    else if (arView === "seo") await arViewSeo(box, b, tok);
    else if (arView === "li_apercu") arViewSoon(box, "LinkedIn — Aperçu", "Vue d'ensemble de la présence LinkedIn (abonnés, portée, engagement). Disponible une fois l'API LinkedIn connectée.", "💼");
    else if (arView === "li_publication") arViewSoon(box, "LinkedIn — Publication", "Planification et publication de posts LinkedIn.", "🗓");
    else if (arView === "li_audience") arViewSoon(box, "LinkedIn — Audience", "Démographie et croissance de l'audience LinkedIn.", "◐");
    else if (arView === "li_ads") arViewSoon(box, "LinkedIn — Publicité", "Campagnes LinkedIn Ads (dépense, impressions, leads).", "▸");
    else if (arView === "veille_meta") await arViewVeilleMeta(box, b, tok);
    else if (arView === "veille_linkedin") arViewSoon(box, "Veille LinkedIn", "Suivi des pages et de l'activité LinkedIn des concurrents. Nécessite l'API LinkedIn.", "💼");
    else if (arView === "rapport_gen") await arViewRapport(box, b, tok);
    else if (arView === "rapport_planif") arViewSoon(box, "Rapports programmés", "Génération et envoi automatiques de rapports clients (hebdo/mensuel).", "🗓");
    else if (arView === "rapport_exports") arViewSoon(box, "Exports", "Exports PDF marque blanche, Excel multi-onglets et CSV.", "⬇");
    if (arRenderAlive(tok)) mArrive(box);
  } catch (e) { if (arRenderAlive(tok)) box.innerHTML = `<div class="ga-note">Erreur : ${escapeHtml(e.message || String(e))}</div>`; }
  if (arRenderAlive(tok)) arWireCommon(box);
}
// Placeholder d'un outil pas encore branché (LinkedIn, SEA concurrente, exports…).
function arViewSoon(box, title, desc, ic) {
  box.innerHTML = arHead(title, "bientôt disponible", "", false) +
    `<div class="ga-panel" style="text-align:center;padding:48px 24px;">
      <div style="font-size:34px;opacity:.5;margin-bottom:12px;">${escapeHtml(ic || AR_CATS.find((c) => c.label === title)?.ic || "…")}</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:8px;">${escapeHtml(title)}</div>
      <div class="ga-note" style="max-width:460px;margin:0 auto;">${escapeHtml(desc || "")}</div>
      <div class="ar-demo" style="margin-top:18px;border-style:solid;">◌ Fonctionnalité à venir</div>
    </div>`;
}

// ── Aperçu : la console de la marque ──
// Vignette cliquable du résumé multi-onglets — fait le pont vers la vue détaillée.
function arResumeTile(icon, label, value, sub, view) {
  return `<div class="ar-resume-tile" data-gotoview="${view}">
    <div class="rt-ic">${icon}</div>
    <div class="rt-body"><div class="rt-label">${escapeHtml(label)}</div><div class="rt-value">${value}</div>${sub ? `<div class="rt-sub">${escapeHtml(sub)}</div>` : ""}</div>
    <div class="rt-arrow">→</div>
  </div>`;
}
async function arViewApercu(box, b, tok) {
  const ovKey = b.id + ":ov:" + arPeriod;
  // L'Aperçu ne bloque QUE sur sa donnée principale — les 3 tuiles résumé (Publicité/Audience/
  // Inbox) arrivent en asynchrone et se remplissent à l'affichage, sinon la tuile la plus lente
  // gelait tout l'écran sur "Chargement…" (lenteur signalée).
  const tilesPromise = Promise.all([
    arGet(b.id + ":ads", () => window.olympus.argosAds(b.id)).catch(() => null),
    arGet(b.id + ":aud", () => window.olympus.argosAudience(b.id)).catch(() => null),
    arGet(b.id + ":inbox", () => window.olympus.argosInbox(b.id)).catch(() => null),
  ]);
  const r = await arGet(ovKey, () => window.olympus.argosOverview(b.id, arPeriod));
  if (!r.ok) { box.innerHTML = `<div class="ga-note">${escapeHtml(r.error)}</div>`; return; }
  const d = r.data;
  if (d.demo === false) arKickRefresh(ovKey, () => arView === "apercu" && arBrandOf()?.id === b.id, () => window.olympus.argosOverview(b.id, arPeriod, true));
  const per = `<div class="ga-period">${[[7, "7 j"], [30, "30 j"], [90, "90 j"]].map(([n, l]) => `<button class="ga-per${arPeriod === n ? " on" : ""}" data-per="${n}">${l}</button>`).join("")}</div>`;
  let html = arHead(b.name, `${arPeriod} derniers jours · ${Object.keys(b.networks || {}).length} réseau(x)`, per, d.demo !== false);
  html += `<div class="ar-resume-row" id="arResumeRow" style="display:none;"></div>`;
  if (r.warning) html += `<div class="ar-alerts"><div class="ar-alert warn"><span class="ai">△</span><span>${escapeHtml(r.warning)}</span></div></div>`;
  if (d.alerts?.length) html += `<div class="ar-alerts">${d.alerts.map((a) => `<div class="ar-alert${a.type === "warn" ? " warn" : ""}"><span class="ai">${a.type === "warn" ? "△" : "◈"}</span><span>${escapeHtml(a.txt)}${a.type === "opportunity" ? ' <b style="cursor:pointer;" data-seize>Créer le post →</b>' : ""}</span></div>`).join("")}</div>`;
  html += `<div class="ga-cards">
    ${pgScore("Abonnés cumulés", pgFmtN(d.followers))}
    ${pgScore("Portée", pgFmtN(d.reach), "", `sur ${arPeriod} jours`)}
    ${pgScore("Engagement moyen", d.engagement + " %")}
    ${d.health != null ? pgScore("Santé de présence", `${d.health}<span class="ga-unit">/100</span>`) : pgScore("Santé de présence", "—", "", "pas de score sur données réelles")}
  </div>`;
  html += pgPanel("Portée par jour", pgAreaChart((d.byDay || []).map((x) => ({ label: pgDayLabel(x.date), value: x.reach }))));
  html += `<div class="ga-breaks">`;
  html += pgPanel("Abonnés par réseau", pgDonut(d.perNet.map((n) => ({ label: arNet(n.network).label, value: n.followers, icon: arNet(n.network).ic })), { centerLabel: "abonnés" }));
  html += pgPanel("Engagement par réseau", pgBreak(d.perNet.map((n) => ({ label: arNet(n.network).label, value: n.engagement, icon: arNet(n.network).ic })), { color: "#8fd6a6" }));
  html += `</div>`;
  if (d.fbInsights) {
    html += pgPanel("Activité de la Page Facebook", `<div class="ga-cards" style="margin:0;">
      ${pgScore("Interactions sur les posts", pgFmtN(d.fbInsights.postEngagements), "", `sur ${arPeriod} jours`)}
      ${pgScore("Vues de la Page", pgFmtN(d.fbInsights.pageViews))}
      ${pgScore("Nouveaux abonnés", pgFmtN(d.fbInsights.newFollows))}
    </div>`);
  }
  html += pgPanel("Posts les plus performants", d.topPosts.map((p) => `
    <div class="ga-tr"><span class="ga-tl">${arNet(p.network).ic} ${escapeHtml(p.title)}</span>
      <span class="ga-tbar"><span class="ga-tbar-f" style="width:${Math.round(p.reach / (d.topPosts[0].reach || 1) * 100)}%"></span></span>
      <span class="ga-tv">${pgFmtN(p.reach)}<span class="ga-tpct">${p.eng} % eng.</span></span>
      <button class="ga-ic" data-recycle="${escapeHtml(p.title)}" title="Recycler ce post">↻</button>
    </div>`).join(""));
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
  box.querySelectorAll(".ga-per").forEach((bt) => bt.onclick = () => { arPeriod = +bt.dataset.per; arRenderView(); });
  box.querySelectorAll("[data-recycle]").forEach((bt) => bt.onclick = () => arComposer(b, { text: bt.dataset.recycle + " — (recyclé, à adapter)" }));
  const sz = box.querySelector("[data-seize]"); if (sz) sz.onclick = () => arComposer(b, { text: "Idée : capitaliser sur la tendance vidéo courte de la semaine.\n\n[brouillon proposé par Argos — à retravailler]" });
  // Les tuiles résumé arrivent quand elles sont prêtes — l'écran principal, lui, est déjà affiché.
  tilesPromise.then(([adsR, audR, inboxR]) => {
    const row = box.querySelector("#arResumeRow");
    if (!row || arView !== "apercu" || arBrandOf()?.id !== b.id) return;
    const eur = (n) => n.toLocaleString("fr-FR") + " €";
    const tiles = [];
    if (adsR?.ok) tiles.push(arResumeTile("▸", "Publicité", eur(adsR.data.totals.spend), `ROAS ×${adsR.data.totals.roas} · ${adsR.data.campaigns.length} campagne(s)`, "ads_meta"));
    if (audR?.ok && (audR.data.followerAge.length || audR.data.followerCountry.length)) {
      const topAge = audR.data.followerAge[0], topCountry = audR.data.followerCountry[0];
      tiles.push(arResumeTile("◐", "Audience", topAge ? topAge.label + " ans" : "—", topCountry ? `1ᵉʳ pays : ${topCountry.label}` : "", "audience"));
    }
    if (inboxR?.ok) {
      const convs = inboxR.conversations || []; const recent = convs.filter((c) => c.hoursAgo < 24).length;
      tiles.push(arResumeTile("💬", "Inbox", String(convs.length), recent ? `${recent} dans les dernières 24h` : "aucune activité récente", "inbox"));
    }
    if (!tiles.length) return;
    row.innerHTML = tiles.join(""); row.style.display = "";
    row.querySelectorAll("[data-gotoview]").forEach((el) => el.onclick = () => arGoView(el.dataset.gotoview));
  });
}

// ── Audience : démographie réelle des abonnés + de l'audience engagée, répartition du
// contenu, actions de profil. Instagram uniquement (Facebook n'expose pas ces breakdowns
// avec nos permissions actuelles) — reste en démo pour une marque sans compte Instagram lié.
const AR_CONTENT_LABEL = { POST: "Publications", REEL: "Reels", STORY: "Stories", CAROUSEL_CONTAINER: "Carrousels", AD: "Publicité" };
async function arViewAudience(box, b, tok) {
  const audKey = b.id + ":aud";
  const r = await arGet(audKey, () => window.olympus.argosAudience(b.id));
  if (!r.ok) { box.innerHTML = `<div class="ga-note">${escapeHtml(r.error)}</div>`; return; }
  const d = r.data;
  if (d.demo === false) arKickRefresh(audKey, () => arView === "audience" && arBrandOf()?.id === b.id, () => window.olympus.argosAudience(b.id, true));
  let html = arHead("Audience", "démographie réelle des abonnés Instagram", "", d.demo !== false);
  html += `<div class="ga-cards">
    ${pgScore("Clics vers le site", pgFmtN(d.actions.websiteClicks), "", "30 derniers jours")}
    ${pgScore("Taps sur le profil", pgFmtN(d.actions.profileLinksTaps), "", "adresse, appel, email…")}
    ${pgScore("Comptes engagés", pgFmtN(d.actions.accountsEngaged))}
  </div>`;
  html += pgPanel("Portée par type de contenu", d.contentReach.length
    ? pgBreak(d.contentReach.map((c) => ({ label: AR_CONTENT_LABEL[c.type] || c.type, value: c.reach })), { color: "#8fd6a6" })
    : `<div class="ga-note">Pas encore de contenu publié sur la période.</div>`);
  html += `<div class="ga-breaks">`;
  html += pgPanel("Abonnés — tranches d'âge", d.followerAge.length ? pgBreak(d.followerAge) : `<div class="ga-note">Pas assez d'abonnés pour une démographie fiable.</div>`);
  html += pgPanel("Abonnés — genre", pgDonut(d.followerGender.map((g) => ({ label: g.label === "F" ? "Femmes" : g.label === "M" ? "Hommes" : g.label, value: g.value })), { centerLabel: "abonnés" }));
  html += `</div>`;
  html += `<div class="ga-breaks">`;
  html += pgPanel("Abonnés — pays", d.followerCountry.length ? pgBreak(d.followerCountry, { color: "#7fb2e8" }) : `<div class="ga-note">—</div>`);
  html += pgPanel("Abonnés — villes", d.followerCity.length ? pgBreak(d.followerCity, { color: "#c9a2e8" }) : `<div class="ga-note">—</div>`);
  html += `</div>`;
  if (d.engagedAge.length || d.engagedGender.length) {
    html += `<div class="ga-breaks">`;
    html += pgPanel("Audience engagée — âge", d.engagedAge.length ? pgBreak(d.engagedAge, { color: "#f6b26b" }) : `<div class="ga-note">—</div>`, "qui interagit vraiment, pas juste qui suit");
    html += pgPanel("Audience engagée — genre", pgDonut(d.engagedGender.map((g) => ({ label: g.label === "F" ? "Femmes" : g.label === "M" ? "Hommes" : g.label, value: g.value })), { centerLabel: "engagés" }));
    html += `</div>`;
  }
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
}

// ── Publication : semaine + composer ──
async function arViewPublication(box, b, tok) {
  const [pr, bt] = await Promise.all([
    window.olympus.argosPosts(b.id),
    arGet(b.id + ":times", () => window.olympus.argosBestTimes(b.id)),
  ]);
  const posts = pr.ok ? pr.posts : [];
  const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + arWeekOff * 7);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const todayIso = todayIsoNow();
  const fmtRange = `${days[0].getDate()} ${MONTHS[days[0].getMonth()].slice(0, 4)} — ${days[6].getDate()} ${MONTHS[days[6].getMonth()].slice(0, 4)}`;
  const best = (bt.ok && bt.slots || []).slice(0, 3).map((s) => `${AR_DOW[(s.wd + 0) % 7]} ${s.hr} h`).join(" · ");
  let html = arHead("Publication", "calendrier éditorial multi-réseaux", `<button class="cal-btn primary" id="arNewPost">＋ Nouveau post</button>`);
  html += `<div class="ar-weeknav">
    <button class="ga-ic" id="arWkPrev">‹</button><span class="wl">${fmtRange}</span><button class="ga-ic" id="arWkNext">›</button>
    <span style="font-size:11.5px;color:var(--dim);margin-left:auto;">Meilleurs créneaux : <b style="color:var(--ok);">${best || "—"}</b></span>
  </div>`;
  html += `<div class="ar-week">` + days.map((d) => {
    const iso = isoD(d.getFullYear(), d.getMonth(), d.getDate());
    const dayPosts = posts.filter((p) => p.date === iso);
    return `<div class="ar-wday${iso === todayIso ? " today" : ""}">
      <div class="wd">${AR_DOW[(d.getDay() + 6) % 7]} ${d.getDate()}</div>
      ${dayPosts.map((p) => `<div class="ar-post${p.status === "draft" ? " draft" : ""}" data-post="${p.id}">${escapeHtml((p.text || "").slice(0, 44))}${(p.text || "").length > 44 ? "…" : ""}<div class="pm">${p.time || ""} ${(p.networks || []).map((n) => arNet(n).ic).join(" ")}${p.status === "draft" ? " · brouillon" : ""}</div></div>`).join("")}
      <button class="add" data-addday="${iso}" title="Programmer ce jour">＋</button>
    </div>`;
  }).join("") + `</div>`;
  const upcoming = posts.filter((p) => p.date >= todayIso);
  html += `<div class="ga-subhead">File d'attente <span>· ${upcoming.length} programmé(s)</span></div>`;
  html += upcoming.length
    ? pgPanel("À publier", upcoming.slice(0, 12).map((p) => `<div class="ga-tr"><span class="ga-tl">${(p.networks || []).map((n) => arNet(n).ic).join(" ")} ${escapeHtml((p.text || "").slice(0, 60))}${p.fbPublish?.ok ? ` <span style="color:var(--ok);font-size:10.5px;">· ${p.fbPublish.scheduled ? "programmé sur Facebook" : "publié sur Facebook"}</span>` : p.fbPublish && !p.fbPublish.ok ? ` <span style="color:#e0868f;font-size:10.5px;">· échec Facebook</span>` : ""}</span><span class="ga-tv">${p.date.slice(8, 10)}/${p.date.slice(5, 7)}${p.time ? " · " + p.time : ""}</span><button class="ga-ic" data-post="${p.id}" title="Modifier">✎</button><button class="ga-ic" data-delpost="${p.id}" title="Supprimer">✕</button></div>`).join(""))
    : `<div class="ga-note">Rien en file d'attente. Les posts programmés partiront automatiquement une fois les comptes connectés — en attendant, ils restent planifiés ici.</div>`;
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
  $("arNewPost").onclick = () => arComposer(b);
  $("arWkPrev").onclick = () => { arWeekOff--; arRenderView(); };
  $("arWkNext").onclick = () => { arWeekOff++; arRenderView(); };
  box.querySelectorAll("[data-addday]").forEach((el) => el.onclick = () => arComposer(b, { date: el.dataset.addday }));
  box.querySelectorAll("[data-post]").forEach((el) => el.onclick = () => { const p = posts.find((x) => x.id === el.dataset.post); if (p) arComposer(b, p); });
  box.querySelectorAll("[data-delpost]").forEach((el) => el.onclick = async (ev) => { ev.stopPropagation(); await window.olympus.argosPostDelete(el.dataset.delpost); arRenderView(); });
}
// Composer : réseaux, texte, date/heure, meilleur créneau, aperçu par réseau
async function arComposer(b, post) {
  post = post || {};
  const bt = await arGet(b.id + ":times", () => window.olympus.argosBestTimes(b.id));
  const top = (bt.ok && bt.slots || [])[0];
  const nets = Object.keys(b.networks || {});
  const sel = new Set(post.networks || nets);
  let pvNet = nets[0] || "instagram";
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  const netBtns = () => nets.map((n) => `<button class="ar-netpick${sel.has(n) ? " on" : ""}" data-net="${n}">${arNet(n).ic} ${arNet(n).label}</button>`).join("");
  const LIMITS = { x: 280, instagram: 2200, facebook: 5000, linkedin: 3000, tiktok: 2200, youtube: 5000 };
  ov.innerHTML = `<div class="modal-panel" style="width:860px;max-width:96vw;">
    <div class="modal-head"><h2>${post.id ? "Modifier le post" : "Nouveau post"} — ${escapeHtml(b.name)}</h2><button class="modal-x" data-x>✕</button></div>
    <div class="modal-body">
      <div class="ar-comp">
        <div>
          <div class="mq-label">Réseaux</div>
          <div class="ar-nets" id="arCompNets">${netBtns()}</div>
          <div class="mq-label" style="margin-top:14px;">Message</div>
          <textarea class="mood-in mood-ta" id="arCompText" style="min-height:130px;" placeholder="Écris le post… (l'aperçu à droite suit)">${escapeHtml(post.text || "")}</textarea>
          <div id="arCompCount" style="font-size:11px;color:var(--dim);text-align:right;margin-top:3px;"></div>
          <div class="auth-row2" style="margin-top:8px;">
            <div class="auth-field" style="flex:1"><label>Date</label><input class="auth-input" id="arCompDate" type="date" value="${post.date || todayIsoNow()}"></div>
            <div class="auth-field" style="flex:1"><label>Heure</label><input class="auth-input" id="arCompTime" type="time" value="${post.time || ""}"></div>
          </div>
          <div class="ar-besttime">Meilleur créneau pour ${escapeHtml(b.name)} : <b id="arCompBest">${top ? `${AR_DOW[top.wd]} ${top.hr}:00` : "—"}</b> — clic pour l'appliquer</div>
        </div>
        <div>
          <div class="mq-label">Aperçu <span id="arPvSwitch" style="text-transform:none;letter-spacing:0;">${nets.map((n) => `<b data-pv="${n}" style="cursor:pointer;margin-left:7px;${n === pvNet ? "" : "opacity:.4;"}">${arNet(n).ic}</b>`).join("")}</span></div>
          <div class="ar-preview" id="arPvBox"></div>
        </div>
      </div>
      <div class="pg-actrow" style="margin-top:16px;">
        <button class="cal-btn primary" id="arCompSave">${post.id ? "Enregistrer" : "Programmer"}</button>
        <button class="btn sec" id="arCompDraft">Garder en brouillon</button>
        <span class="msg" id="arCompMsg"></span>
      </div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const paintPv = () => {
    const t = ov.querySelector("#arCompText").value;
    const lim = LIMITS[pvNet] || 2200;
    const cut = pvNet === "x" ? 280 : 125;
    const shown = t.length > cut ? escapeHtml(t.slice(0, cut)) + `<span class="more"> … ${pvNet === "x" ? "" : "Plus"}</span>` : escapeHtml(t) || '<span style="color:var(--dim);">Le texte du post s\'affichera ici…</span>';
    ov.querySelector("#arPvBox").innerHTML = `
      <div class="ar-pv-head"><div class="ar-pv-av">${initialsOf(b.name)}</div><div><div class="ar-pv-n">${escapeHtml(b.networks[pvNet] || b.name)}</div><div class="ar-pv-s">${arNet(pvNet).label} · aperçu</div></div></div>
      ${pvNet !== "x" && pvNet !== "linkedin" ? '<div class="ar-pv-media">🖼</div>' : ""}
      <div class="ar-pv-txt">${shown}</div>`;
    ov.querySelector("#arCompCount").textContent = `${t.length} car.` + (t.length > lim ? ` — dépasse la limite ${arNet(pvNet).label} (${lim})` : "");
    ov.querySelector("#arCompCount").style.color = t.length > lim ? "#e0868f" : "var(--dim)";
  };
  ov.querySelector("#arCompText").oninput = paintPv;
  ov.querySelectorAll("#arPvSwitch [data-pv]").forEach((el) => el.onclick = () => { pvNet = el.dataset.pv; ov.querySelectorAll("#arPvSwitch [data-pv]").forEach((x) => x.style.opacity = x === el ? "1" : ".4"); paintPv(); });
  ov.querySelector("#arCompNets").onclick = (e) => { const bn = e.target.closest("[data-net]"); if (!bn) return; sel.has(bn.dataset.net) ? sel.delete(bn.dataset.net) : sel.add(bn.dataset.net); bn.classList.toggle("on"); };
  const bestEl = ov.querySelector("#arCompBest");
  if (top) bestEl.onclick = () => {
    const d = new Date(); const target = (top.wd + 1) % 7; // wd: Lun=0 → JS Lun=1
    let add = (target - d.getDay() + 7) % 7; if (add === 0 && d.getHours() >= top.hr) add = 7;
    d.setDate(d.getDate() + add);
    ov.querySelector("#arCompDate").value = isoD(d.getFullYear(), d.getMonth(), d.getDate());
    ov.querySelector("#arCompTime").value = String(top.hr).padStart(2, "0") + ":00";
  };
  let saving = false;
  const save = async (status) => {
    if (saving) return;                                       // anti double-clic : sinon 2 posts créés / 2 publications Facebook
    const text = ov.querySelector("#arCompText").value.trim();
    if (!text) { const m = ov.querySelector("#arCompMsg"); m.className = "msg err"; m.textContent = "Écris le message d'abord."; return; }
    saving = true;
    const btnS = ov.querySelector("#arCompSave"), btnD = ov.querySelector("#arCompDraft");
    btnS.disabled = true; btnD.disabled = true;
    let r;
    try { r = await window.olympus.argosPostSave({ id: post.id, brandId: b.id, text, networks: [...sel], date: ov.querySelector("#arCompDate").value, time: ov.querySelector("#arCompTime").value || null, status }); }
    catch (e) { const m = ov.querySelector("#arCompMsg"); m.className = "msg err"; m.textContent = "Échec : " + (e.message || e); saving = false; btnS.disabled = false; btnD.disabled = false; return; }
    if (r.post && r.post.id) post.id = r.post.id;              // devient une mise à jour (plus de re-création au prochain enregistrement)
    const pr = r.publishResult, m = ov.querySelector("#arCompMsg");
    if (pr && pr.ok) {
      m.className = "msg ok";
      m.textContent = pr.scheduled ? "Programmé nativement sur Facebook ✓" : "Publié sur Facebook ✓";
      setTimeout(() => { close(); if (arView === "publication") arRenderView(); }, 1600);
      return;                                                 // succès : on ne réactive pas (la modale se ferme)
    }
    if (pr && !pr.ok) {
      m.className = "msg err";
      m.textContent = "Facebook a refusé la publication (" + pr.error + ") — gardé en file d'attente locale, tu peux réessayer.";
      saving = false; btnS.disabled = false; btnD.disabled = false;
      return;
    }
    close(); if (arView === "publication") arRenderView();
  };
  ov.querySelector("#arCompSave").onclick = () => save("scheduled");
  ov.querySelector("#arCompDraft").onclick = () => save("draft");
  paintPv();
}

// ── Inbox unifiée ──
let arConvSel = null;
async function arViewInbox(box, b, tok) {
  const inboxKey = b.id + ":inbox";
  const r = await arGet(inboxKey, () => window.olympus.argosInbox(b.id));
  if (!r.ok) { box.innerHTML = `<div class="ga-note">${escapeHtml(r.error)}</div>`; return; }
  if (r.demo === false) arKickRefresh(inboxKey, () => arView === "inbox" && arBrandOf()?.id === b.id, () => window.olympus.argosInbox(b.id, true));
  const convs = r.conversations || [];
  if (!arConvSel || !convs.find((c) => c.id === arConvSel)) arConvSel = convs[0]?.id || null;
  const cur = convs.find((c) => c.id === arConvSel);
  const MACROS = ["Merci beaucoup ! 🙏", "On vous répond en DM 👌", "Oui, c'est disponible — le lien est en bio.", "Écris-nous à hello@… on s'en occupe !"];
  let html = arHead("Inbox", "commentaires et messages privés, tous réseaux", "", r.demo !== false);
  if (r.warning) html += `<div class="ar-alerts"><div class="ar-alert warn"><span class="ai">△</span><span>${escapeHtml(r.warning)}</span></div></div>`;
  html += `<div class="ar-inbox">
    <div class="ar-convs">${convs.map((c) => `
      <div class="ar-conv${c.id === arConvSel ? " active" : ""}" data-conv="${c.id}">
        <div class="av">${initialsOf(c.from)}<span class="nico">${arNet(c.network).ic}</span></div>
        <div class="ci"><div class="cn">${escapeHtml(c.from)} <span class="ct">${arAgo(c.hoursAgo)}</span></div><div class="cl">${c.kind === "dm" ? "✉ " : "💬 "}${escapeHtml(c.text)}</div></div>
        ${c.unread && !(c.replies || []).length ? '<span class="unread"></span>' : ""}
      </div>`).join("") || '<div class="ga-note" style="margin:10px;">Aucune conversation.</div>'}</div>
    <div class="ar-thread">${cur ? `
      <div class="ar-th-head">${arNet(cur.network).ic} ${escapeHtml(cur.from)} <span style="color:var(--dim);font-weight:400;font-size:11px;">· ${cur.kind === "dm" ? "message privé" : "commentaire"} ${arNet(cur.network).label}</span></div>
      <div class="ar-th-msgs">
        <div class="ar-bubble them">${escapeHtml(cur.text)}<div class="bt">${arAgo(cur.hoursAgo)}</div></div>
        ${(cur.replies || []).map((rp) => `<div class="ar-bubble me">${escapeHtml(rp.text)}<div class="bt">${rp.pending ? (r.demo === false ? "brouillon local — pas encore publié sur " + arNet(cur.network).label : "sera envoyé à la connexion du compte") : ""}</div></div>`).join("")}
      </div>
      <div class="ar-replyrow"><input class="mood-in" id="arReplyIn" placeholder="Répondre à ${escapeHtml(cur.from)}…"><button class="cal-btn primary" id="arReplyBtn">Répondre</button></div>
      <div class="ar-macros">${MACROS.map((m) => `<button class="mq-chip" data-macro="${escapeHtml(m)}">${escapeHtml(m)}</button>`).join("")}</div>
    ` : '<div class="ga-note" style="margin:14px;">Sélectionne une conversation.</div>'}</div>
  </div>`;
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
  box.querySelectorAll("[data-conv]").forEach((el) => el.onclick = () => { arConvSel = el.dataset.conv; arRenderView(); });
  box.querySelectorAll("[data-macro]").forEach((el) => el.onclick = () => { const i = $("arReplyIn"); i.value = el.dataset.macro; i.focus(); });
  const rb = $("arReplyBtn");
  if (rb) rb.onclick = async () => {
    const v = $("arReplyIn").value.trim(); if (!v || !cur) return;
    await window.olympus.argosInboxReply(b.id, cur.id, v);
    delete arCache[b.id + ":inbox"]; arRenderView();
  };
  const ri = $("arReplyIn"); if (ri) ri.addEventListener("keydown", (e) => { if (e.key === "Enter") rb.click(); });
}

// ── Écoute : mots-clés + mentions + sentiment ──
async function arViewEcoute(box, b, tok) {
  const r = await arGet(b.id + ":listen", () => window.olympus.argosListening(b.id));
  if (!r.ok) { box.innerHTML = `<div class="ga-note">${escapeHtml(r.error)}</div>`; return; }
  const d = r.data; const kws = r.keywords || [];
  let html = arHead("Écoute", "mentions de la marque et mots-clés surveillés", "", "Meta ne fournit pas de veille du web — nécessite un outil tiers (Brandwatch, Talkwalker…)");
  if (d.spike) html += `<div class="ar-alerts"><div class="ar-alert warn"><span class="ai">△</span><span>Pic de mentions inhabituel détecté sur les dernières 24 h — surveille le sentiment avant qu'un bad buzz ne s'installe.</span></div></div>`;
  html += `<div class="ga-cards">
    ${pgScore("Mentions", String(d.mentions.length), "", "7 derniers jours")}
    ${pgScore("Positives", String(d.sentiment.pos), "", "sentiment")}
    ${pgScore("Neutres", String(d.sentiment.neu))}
    ${pgScore("Négatives", String(d.sentiment.neg))}
  </div>`;
  html += pgPanel("Mots-clés surveillés", `
    <div style="display:flex;flex-wrap:wrap;gap:8px;">${kws.map((k, i) => `<span class="ar-kw">${escapeHtml(k)}<button data-delkw="${i}">✕</button></span>`).join("")}
      <span class="ar-kw" style="border-style:dashed;background:none;"><input id="arKwIn" placeholder="＋ ajouter un mot-clé" style="background:none;border:none;outline:none;color:var(--txt);font-size:12px;width:150px;"></span>
    </div>`);
  html += pgPanel("Mentions récentes", (d.mentions || []).map((m) => `
    <div class="ar-mention">
      <span class="sdot ${m.sentiment}"></span>
      <div class="mi"><div class="mt">${escapeHtml(m.text)}</div><div class="mm">${arNet(m.source).ic} ${escapeHtml(m.author)} · ${arAgo(m.hoursAgo)} · portée ~${pgFmtN(m.reach)}</div></div>
      <button class="btn sec" data-reply-mention style="padding:5px 12px;font-size:11.5px;">Répondre</button>
    </div>`).join("") || '<div class="dim">Aucune mention sur la période.</div>');
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
  const saveKws = async (list) => { await window.olympus.argosKeywords(b.id, list); arState = null; delete arCache[b.id + ":listen"]; await renderArgos(); };
  box.querySelectorAll("[data-delkw]").forEach((el) => el.onclick = () => { const l = kws.slice(); l.splice(+el.dataset.delkw, 1); saveKws(l); });
  const ki = $("arKwIn"); if (ki) ki.addEventListener("keydown", (e) => { if (e.key === "Enter" && ki.value.trim()) saveKws([...kws, ki.value.trim()]); });
  box.querySelectorAll("[data-reply-mention]").forEach((el) => el.onclick = () => arGoView("inbox"));
}

// ── Publicité (filtrée par plateforme : "meta" ou "google") ──
// La donnée argosAds contient TOUTES les campagnes (Meta + Google fusionnées) ; on filtre à
// l'affichage selon l'onglet. En démo (aucun compte mappé) on ne filtre pas — illustratif.
function arFilterAds(d, platform) {
  if (d.demo !== false) return d;
  const isG = (c) => c.platform === "google_ads";
  const campaigns = (d.campaigns || []).filter((c) => platform === "google" ? isG(c) : !isG(c));
  const spend = campaigns.reduce((n, c) => n + c.spend, 0);
  const conversions = campaigns.reduce((n, c) => n + c.conversions, 0);
  const roas = spend ? +(campaigns.reduce((n, c) => n + c.roas * c.spend, 0) / spend).toFixed(1) : 0;
  const platformSplit = (d.platformSplit || []).filter((p) => platform === "google" ? p.platform === "google_ads" : p.platform !== "google_ads");
  return { ...d, campaigns, totals: { spend, conversions, roas }, platformSplit, demoSplit: platform === "google" ? [] : (d.demoSplit || []) };
}
async function arViewAds(box, b, tok, platform = "meta") {
  // Google + compte mappé : vue RICHE (cartes campagne complètes + marché/concurrents), période choisie.
  if (platform === "google" && (b.assets || []).some((a) => a.network === "google_ads")) {
    const st = await window.olympus.siStatus().catch(() => null);
    if (tok !== undefined && !arRenderAlive(tok)) return;
    const connected = !!(st?.ok && st.connected);
    const priceOf = (id) => (st?.pricing?.find((p) => p.id === id) || {}).eur;
    const mcCost = priceOf("serp") != null ? +((priceOf("serp") || 0) + (priceOf("keyword_volume") || 0) * 8).toFixed(3) : null;
    const sandboxBadge = !connected ? "" : (st.sandbox ? `<span class="pg-pill" style="font-size:11px;">🧪 Sandbox (gratuit)</span>` : `<span class="pg-pill" style="font-size:11px;">budget ${siEur(st.budget.spent)} / ${siEur(st.budget.hard)}</span>`);
    const analyzeInner = connected
      ? `<button class="btn sec" id="arAdsRichBtn">Analyser marché &amp; concurrents${mcCost != null ? ` <span class="si-cost">(≈ ${siEur(mcCost)})</span>` : ""}</button><span class="msg" id="arAdsRichMsg" style="margin-left:8px;"></span>`
      : `<span class="ga-note" style="margin:0;display:inline-block;">Connecte un fournisseur dans <b data-goconn>Titan → Search Intelligence</b> pour ajouter le marché & les concurrents à chaque campagne.</span>`;
    let html = arHead("Publicité", "campagnes Google Ads — " + arAdsPeriodLabel(), arAdsPeriodControl(), false);
    html += `<div class="ga-panel flat"><div class="ga-panel-h">Campagnes${connected && sandboxBadge ? `<span class="ga-panel-x">${sandboxBadge}</span>` : ""}</div>
       <p class="desc" style="margin-bottom:12px;">Tes campagnes Google Ads en détail (type, budget, mots-clés & position, audiences, emplacements, zones). Lance l'analyse pour ajouter <b>dans chaque carte</b> le marché et les <b>vrais concurrents locaux</b>.</p>
       <div style="margin-bottom:12px;">${analyzeInner}</div>
       <div id="arAdsRichActive"><div class="ga-note" style="opacity:.6;">Chargement des campagnes…</div></div></div>`;
    if (tok !== undefined && !arRenderAlive(tok)) return;
    box.innerHTML = html;
    arWireAdsPeriod(box);
    const gc = box.querySelector("[data-goconn]"); if (gc) gc.onclick = () => goTo("titan");
    arMountRichCampaigns(box.querySelector("#arAdsRichActive"), b, { summary: true, connected, mktBtn: box.querySelector("#arAdsRichBtn"), msgEl: box.querySelector("#arAdsRichMsg") });
    return;
  }
  const adsKey = b.id + ":ads";
  const r = await arGet(adsKey, () => window.olympus.argosAds(b.id));
  if (!r.ok) { box.innerHTML = `<div class="ga-note">${escapeHtml(r.error)}</div>`; return; }
  const d0 = r.data;
  if (d0.demo === false) arKickRefresh(adsKey, () => (arView === "ads_meta" || arView === "ads_google") && arBrandOf()?.id === b.id, () => window.olympus.argosAds(b.id, true));
  const d = arFilterAds(d0, platform);
  const eur = (n) => n.toLocaleString("fr-FR") + " €";
  let html = arHead("Publicité", platform === "google" ? "campagnes Google Ads" : "campagnes Meta Ads", "", d0.demo !== false);
  if (r.warning) html += `<div class="ar-alerts"><div class="ar-alert warn"><span class="ai">△</span><span>${escapeHtml(r.warning)}</span></div></div>`;
  if (!d.campaigns.length) html += `<div class="ga-note">${d0.demo === false ? (platform === "google" ? "Aucune campagne Google Ads — vérifie que le compte est mappé et que l'accès Basic est accordé." : "Aucune campagne Meta active sur les 30 derniers jours.") : ""}</div>`;
  const totalImpr = (d.campaigns || []).reduce((n, c) => n + (c.impressions || 0), 0);
  const totalClicks = (d.campaigns || []).reduce((n, c) => n + (c.clicks || 0), 0);
  // KPIs adaptés à l'objectif : sans conversion (notoriété/Display) le ROAS n'a pas de sens →
  // on montre portée (impressions), CPM et CTR ; avec conversions → Conversions + ROAS.
  const awareness = (d.totals.conversions || 0) === 0 && d.totals.spend > 0;
  html += `<div class="ga-cards">
    ${pgScore("Dépense", eur(d.totals.spend), "", "sur la période")}
    ${awareness
      ? pgScore("Impressions", pgFmtN(totalImpr), "", "portée payante") +
        pgScore("CPM", (totalImpr ? (d.totals.spend / totalImpr * 1000) : 0).toFixed(2) + " €", "", "coût / 1000 impressions") +
        pgScore("Clics", pgFmtN(totalClicks), "", "CTR " + (totalImpr ? (totalClicks / totalImpr * 100).toFixed(1) : 0) + " %")
      : pgScore("Conversions", String(d.totals.conversions)) +
        pgScore("ROAS moyen", "×" + d.totals.roas) +
        pgScore("Clics", pgFmtN(totalClicks))}
  </div>`;
  html += pgPanel("Campagnes", (d.campaigns || []).map((c) => `
    <div class="ar-camp">
      <span class="st ${c.status}">${c.status === "active" ? "active" : "terminée"}</span>
      <div class="cn">
        <div class="n">${escapeHtml(c.name)}</div>
        <div class="s">${arNet(c.platform).label} · CPC ${String(c.cpc).replace(".", ",")} € · ${pgFmtN(c.impressions)} impressions · ${pgFmtN(c.clicks)} clics</div>
        <div class="ar-budget"><i style="width:${Math.min(100, Math.round((c.spend / (c.budget || 1)) * 100))}%"></i></div>
      </div>
      <div class="cv"><div class="b">${eur(c.spend)} / ${eur(c.budget)}</div><div class="s">${c.conversions ? "ROAS ×" + c.roas + " · " + c.conversions + " conv." : "CPM " + (c.impressions ? (c.spend / c.impressions * 1000).toFixed(2) : "0") + " € · CTR " + (c.impressions ? (c.clicks / c.impressions * 100).toFixed(1) : "0") + " %"}</div></div>
    </div>`).join(""));
  if (d.platformSplit?.length || d.demoSplit?.length) {
    html += `<div class="ga-breaks">`;
    html += pgPanel("Répartition par plateforme", d.platformSplit?.length
      ? pgDonut(d.platformSplit.map((p) => ({ label: arNet(p.platform).label || p.platform, value: p.spend, icon: arNet(p.platform).ic })), { centerLabel: "dépensé" })
      : `<div class="ga-note">—</div>`);
    html += pgPanel("Répartition âge / genre", d.demoSplit?.length
      ? pgBreak(d.demoSplit.slice(0, 8).map((x) => ({ label: `${x.age} · ${x.gender === "female" ? "F" : x.gender === "male" ? "H" : x.gender}`, value: x.spend })), { color: "#e0868f" })
      : `<div class="ga-note">—</div>`);
    html += `</div>`;
  }
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
}

// ── Site web : trafic Google Analytics 4 de la propriété mappée ──
async function arViewWeb(box, b, tok) {
  const key = b.id + ":web:" + arPeriod;
  const r = await arGet(key, () => window.olympus.argosWeb(b.id, arPeriod));
  if (!r.ok) { box.innerHTML = `<div class="ga-note">${escapeHtml(r.error)}</div>`; return; }
  const d = r.data;
  if (d.demo === false) arKickRefresh(key, () => arView === "web" && arBrandOf()?.id === b.id, () => window.olympus.argosWeb(b.id, arPeriod, true));
  const per = `<div class="ga-period">${[[7, "7 j"], [30, "30 j"], [90, "90 j"]].map(([n, l]) => `<button class="ga-per${arPeriod === n ? " on" : ""}" data-per="${n}">${l}</button>`).join("")}</div>`;
  let html = arHead("Site web", `trafic Google Analytics · Core Web Vitals · audit technique — ${arPeriod} derniers jours`, per, d.demo !== false);
  if (r.warning) html += `<div class="ar-alerts"><div class="ar-alert warn"><span class="ai">△</span><span>${escapeHtml(r.warning)}</span></div></div>`;
  const t = d.totals || {};
  const conv = (t.sessions ? (t.conversions / t.sessions * 100) : 0);
  html += `<div class="ga-cards">
    ${pgScore("Sessions", pgFmtN(t.sessions || 0), "", "sur la période")}
    ${pgScore("Utilisateurs", pgFmtN(t.users || 0))}
    ${pgScore("Pages vues", pgFmtN(t.pageviews || 0))}
    ${pgScore("Conversions", pgFmtN(t.conversions || 0), "", conv ? conv.toFixed(1).replace(".", ",") + " % des sessions" : "")}
  </div>`;
  html += pgPanel("Sessions par jour", pgAreaChart((d.byDay || []).map((x) => ({ label: pgDayLabel(x.date), value: x.sessions }))));
  html += `<div class="ga-breaks">`;
  html += pgPanel("Canaux d'acquisition", (d.channels || []).length ? pgDonut(d.channels.map((c) => ({ label: c.label, value: c.value })), { centerLabel: "sessions" }) : `<div class="ga-note">—</div>`);
  html += pgPanel("Pages les plus vues", (d.topPages || []).length ? pgBreak(d.topPages.map((p) => ({ label: p.label, value: p.value })), { color: "#7fb2e8" }) : `<div class="ga-note">—</div>`);
  html += `</div>`;
  html += `<div id="arWebPgAudience"></div>`;               // Audience (Pegasus)
  html += `<div id="arWebVitals"><div class="ga-note" style="opacity:.6;">Mesure des Core Web Vitals (PageSpeed)…</div></div>`;
  html += `<div id="arWebPgPerf"></div>`;                    // Performance (Pegasus · PageSpeed)
  html += `<div id="arWebAudit"></div>`;                     // Audit technique (crawl)
  html += `<div id="arWebPgSecu"></div>`;                    // Sécurité (Pegasus)
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
  box.querySelectorAll(".ga-per").forEach((bt) => bt.onclick = () => { arPeriod = +bt.dataset.per; arRenderView(); });
  arMountAudit(box.querySelector("#arWebAudit"), b); // audit technique fusionné dans Site web
  // Composants Pegasus (Audience / Performance / Sécurité) — appariés au site du client, grisés si plugin absent.
  (async () => {
    const site = await arPegasusSite(b); const installed = await arPegasusInstalled(site);
    if (arView !== "web" || arBrandOf()?.id !== b.id) return;
    arMountPgAudience(box.querySelector("#arWebPgAudience"), b, site, installed);
    arMountPgTab(box.querySelector("#arWebPgPerf"), b, site, installed, { state: pgPerf, run: (k) => window.olympus.pegasusSitePerf(k, "mobile"), tab: pgTabPerf, btn: "pgPerfBtn", view: "web", needPlugin: false, title: "Performance (Pegasus · PageSpeed)" });
    arMountPgTab(box.querySelector("#arWebPgSecu"), b, site, installed, { state: pgDiag, run: (k) => window.olympus.pegasusSiteDiag(k), tab: pgTabSecu, btn: "pgSecuBtn", view: "web", needPlugin: true, title: "Sécurité du site (Pegasus)" });
  })();
  // Core Web Vitals (PageSpeed, gratuit) — chargés en async (l'API met ~15-40 s).
  arGet(b.id + ":vitals", () => window.olympus.argosVitals(b.id)).then((rv) => {
    if (arView !== "web" || arBrandOf()?.id !== b.id) return;
    const host = box.querySelector("#arWebVitals"); if (!host) return;
    if (!rv?.ok) { host.innerHTML = ""; return; }
    host.innerHTML = arVitalsPanel(rv.data);
    mArrive(host);
  }).catch(() => { const host = box.querySelector("#arWebVitals"); if (host) host.innerHTML = ""; });
}
// Jauges Core Web Vitals (mobile / ordinateur) avec seuils Google (bon / à améliorer / mauvais).
function arVitalsRating(metric, v) {
  if (v == null) return "na";
  const th = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], score: [90, 50] }[metric];
  if (!th) return "na";
  if (metric === "score") return v >= th[0] ? "good" : v >= th[1] ? "warn" : "poor";
  return v <= th[0] ? "good" : v <= th[1] ? "warn" : "poor";
}
function arVitalsCell(metric, label, v, fmt) {
  const rate = arVitalsRating(metric, v);
  return `<div class="cwv-cell ${rate}"><div class="cwv-l">${label}</div><div class="cwv-v">${v == null ? "—" : fmt(v)}</div></div>`;
}
function arVitalsCol(title, s) {
  if (!s) return "";
  return `<div class="cwv-col"><div class="cwv-h">${title}<span class="cwv-score ${arVitalsRating("score", s.score)}">${s.score}</span></div>
    <div class="cwv-grid">
      ${arVitalsCell("lcp", "LCP", s.lcp, (v) => (v / 1000).toFixed(1).replace(".", ",") + " s")}
      ${arVitalsCell("inp", "INP", s.inp, (v) => Math.round(v) + " ms")}
      ${arVitalsCell("cls", "CLS", s.cls, (v) => (+v).toFixed(2).replace(".", ","))}
    </div></div>`;
}
function arVitalsPanel(d) {
  return pgPanel("Core Web Vitals — vitesse & stabilité" + (d.url ? "" : " (démo)"),
    `<div class="cwv-wrap">${arVitalsCol("📱 Mobile", d.mobile)}${arVitalsCol("🖥 Ordinateur", d.desktop)}</div>
     <p class="desc" style="font-size:11px;margin-top:10px;">LCP = chargement · INP = réactivité · CLS = stabilité visuelle. Seuils Google : <b style="color:#8fd6a6">bon</b> · <b style="color:#e8c268">à améliorer</b> · <b style="color:#e0868f">mauvais</b>.</p>`);
}
// ── SEO : performance de recherche Google Search Console du site mappé ──
// Tableau des mots-clés Search Console (Requête · Pos. moy · Clics · Impressions + loupe classement
// live). Partagé par la vue SEO et la Veille SEO. queries = [{keyword, position, clicks, impressions}].
function arSeoKwTable(out, b, queries) {
  if (!out) return;
  const posB = (p) => p == null ? "" : p <= 3 ? "Top 3" : p <= 10 ? "1ʳᵉ page" : p <= 20 ? "2ᵉ page" : "21+";
  const q = (queries || []).filter((x) => x.keyword).slice(0, 15);
  if (!q.length) { out.innerHTML = `<div class="ga-note">Aucune requête Search Console — vérifie que le site est bien associé et a du trafic.</div>`; return; }
  out.innerHTML = `<div class="si-kwhead"><span class="ga-tl">Requête</span><span class="c1" title="Position moyenne sur la période (Search Console)">Pos. moy.</span><span class="c2">Clics</span><span class="cx">Impressions</span><span class="c3"></span></div>
    ${q.map((k, i) => `<div class="si-kw"><div class="si-kwrow">
      <span class="ga-tl">${escapeHtml(k.keyword)} <span style="color:var(--dim);font-size:10px;">${posB(Math.round(k.position))}</span></span>
      <span class="c1"><b>${k.position != null ? String(+(+k.position).toFixed(1)).replace(".", ",") : "—"}</b></span>
      <span class="c2">${pgFmtN(k.clicks || 0)}</span>
      <span class="cx">${pgFmtN(k.impressions || 0)}</span>
      <span class="c3"><button class="btn sec si-serpbtn" data-kw="${i}" title="Voir le classement Google">🔍 liste</button></span>
    </div></div>`).join("")}`;
  out.querySelectorAll(".si-serpbtn").forEach((bt) => { const i = +bt.dataset.kw, k = q[i]; if (!k) return; bt.onclick = (e) => { e.preventDefault(); e.stopPropagation(); arSerpModal(b, k); }; });
  mArrive(out);
}
async function arViewSeo(box, b, tok) {
  const key = b.id + ":seo:" + arPeriod;
  const r = await arGet(key, () => window.olympus.argosSeo(b.id, arPeriod));
  if (!r.ok) { box.innerHTML = `<div class="ga-note">${escapeHtml(r.error)}</div>`; return; }
  const d = r.data;
  if (d.demo === false) arKickRefresh(key, () => arView === "seo" && arBrandOf()?.id === b.id, () => window.olympus.argosSeo(b.id, arPeriod, true));
  const per = `<div class="ga-period">${[[7, "7 j"], [30, "30 j"], [90, "90 j"]].map(([n, l]) => `<button class="ga-per${arPeriod === n ? " on" : ""}" data-per="${n}">${l}</button>`).join("")}</div>`;
  let html = arHead("SEO", `recherche Google · ${arPeriod} derniers jours`, per, d.demo !== false);
  if (r.warning) html += `<div class="ar-alerts"><div class="ar-alert warn"><span class="ai">△</span><span>${escapeHtml(r.warning)}</span></div></div>`;
  const t = d.totals || {};
  html += `<div class="ga-cards">
    ${pgScore("Clics", pgFmtN(t.clicks || 0), "", "sur la période")}
    ${pgScore("Impressions", pgFmtN(t.impressions || 0))}
    ${pgScore("CTR", String(t.ctr || 0).replace(".", ",") + " %")}
    ${pgScore("Position moy.", String(t.position || 0).replace(".", ","))}
  </div>`;
  html += pgPanel("Clics par jour", pgAreaChart((d.byDay || []).map((x) => ({ label: pgDayLabel(x.date), value: x.clicks }))));
  html += pgPanel("Vos mots-clés (Search Console)",
    `<p class="desc" style="margin-bottom:8px;">Les vraies requêtes Google qui amènent du trafic à <b>${escapeHtml(b.name)}</b> : <b>position moyenne</b>, clics et impressions. La <b>loupe 🔍</b> ouvre le classement en direct.</p>
     <div id="arSeoKwList"><div class="ga-note" style="opacity:.6;">Chargement…</div></div>`);
  html += pgPanel("Pages les plus visibles", (d.topPages || []).length ? pgBreak(d.topPages.map((p) => ({ label: p.label, value: p.clicks })), { color: "#8fd6a6" }) : `<div class="ga-note">—</div>`);
  html += `<div id="arSeoIntel"><div class="ga-note" style="opacity:.6;">Analyse SEO en cours…</div></div>`;
  html += `<div id="arSeoPg"></div>`; // Audit SEO on-page (Pegasus)
  html += pgPanel("Vue d'ensemble du domaine & backlinks", `<div id="arSeoOv"><div class="ga-note" style="opacity:.6;">Chargement…</div></div>`);
  html += pgPanel("Concurrents SEO du secteur", `<div id="arSeoComp"><div class="ga-note" style="opacity:.6;">Chargement…</div></div>`, `<span class="pg-pill" style="font-size:11px;">via Notoriété</span>`);
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
  arSeoKwTable(box.querySelector("#arSeoKwList"), b, (d.topQueries || []).map((x) => ({ keyword: x.label, position: x.position, clicks: x.clicks, impressions: x.impressions })));
  box.querySelectorAll(".ga-per").forEach((bt) => bt.onclick = () => { arPeriod = +bt.dataset.per; arRenderView(); });
  // Vue d'ensemble domaine/backlinks + concurrents SEO ré-alignés (vrais concurrents locaux) — SI connecté.
  window.olympus.siStatus().then((sst) => {
    if (arView !== "seo" || arBrandOf()?.id !== b.id) return;
    const ovc = box.querySelector("#arSeoOv"), cont = box.querySelector("#arSeoComp");
    if (!sst?.ok || !sst.connected) {
      const note = `<div class="ga-note">Connecte un fournisseur de données dans <b data-goconn>Titan → Search Intelligence</b> pour ces analyses SEO.</div>`;
      if (ovc) ovc.innerHTML = note; if (cont) cont.innerHTML = note;
      const g = box.querySelector("[data-goconn]"); if (g) g.onclick = () => goTo("titan"); return;
    }
    const priceOf = (id) => (sst.pricing.find((p) => p.id === id) || {}).eur;
    arMountSeoDomainOv(ovc, b, priceOf);
    arMountSeoCompetitors(cont, b, priceOf);
  }).catch(() => {});
  // Audit SEO on-page Pegasus (title/meta/H1/canonical/OG/alt + sitemap/robots) — grisé si plugin absent.
  (async () => {
    const site = await arPegasusSite(b); const installed = await arPegasusInstalled(site);
    if (arView !== "seo" || arBrandOf()?.id !== b.id) return;
    arMountPgTab(box.querySelector("#arSeoPg"), b, site, installed, { state: pgSeo, run: (k) => window.olympus.pegasusSiteSeo(k, 10), tab: pgTabSeo, btn: "pgSeoBtn", view: "seo", needPlugin: true, title: "Audit SEO on-page (Pegasus)" });
  })();
  // Intelligence SEO (cannibalisation · quick-wins · chutes) — chargée en async, 100% gratuite (GSC).
  const iKey = b.id + ":seoIntel:" + arPeriod;
  arGet(iKey, () => window.olympus.argosSeoIntel(b.id, arPeriod)).then((ri) => {
    if (arView !== "seo" || arBrandOf()?.id !== b.id) return;
    const host = box.querySelector("#arSeoIntel"); if (!host) return;
    if (!ri?.ok) { host.innerHTML = ""; return; }
    const di = ri.data;
    let h = "";
    // Quick-wins
    const qw = (di.quickWins || []).map((x) => `<div class="ga-tr">
      <span class="ga-tl">${escapeHtml(x.query)}</span>
      <span class="ga-tbar"><span class="ga-tbar-f" style="width:${Math.min(100, Math.round(x.impressions / ((di.quickWins[0]?.impressions) || 1) * 100))}%;background:#f6b26b"></span></span>
      <span class="ga-tv">${pgFmtN(x.impressions)}<span class="ga-tpct">pos. ${(+x.position).toFixed(1).replace(".", ",")}</span></span></div>`).join("");
    h += pgPanel("Opportunités — quick wins (position 4-20, fort volume)", qw || `<div class="ga-note">Aucune requête en position d'attaque sur la période.</div>`);
    // Cannibalisation
    const cn = (di.cannibal || []).map((c) => `<div class="ga-cnb">
      <div class="ga-cnb-h"><b>${escapeHtml(c.query)}</b><span>${c.pages} pages · ${pgFmtN(c.impressions)} impr.</span></div>
      <div class="ga-cnb-u">${c.urls.map((u) => `<span>${escapeHtml(u.url)} <em>pos. ${String(u.position).replace(".", ",")}</em></span>`).join("")}</div></div>`).join("");
    h += pgPanel("Cannibalisation — plusieurs pages sur la même requête", cn || `<div class="ga-note">Aucune cannibalisation détectée. 👍</div>`);
    // Chutes A/B
    const dr = (di.drops || []).map((x) => `<div class="ga-tr">
      <span class="ga-tl">${escapeHtml(x.query)}</span>
      <span class="ga-tv" style="margin-left:auto;">${x.dClicks} clic${x.dClicks <= -2 ? "s" : ""}<span class="ga-tpct">${x.dPos > 0 ? "▼ " + String(x.dPos).replace(".", ",") + " pos." : "position stable"}</span></span></div>`).join("");
    h += pgPanel("Chutes vs période précédente", dr || `<div class="ga-note">Aucune chute significative. 👍</div>`);
    host.innerHTML = h;
    mArrive(host);
  }).catch(() => { const host = box.querySelector("#arSeoIntel"); if (host) host.innerHTML = ""; });
}
// Vue d'ensemble du domaine du client (estimation DataForSEO : mots-clés référencés, trafic, positions)
// + backlinks — re-logée depuis l'ex-Veille SEO dans Google > SEO. Payant au clic, peek gratuit à l'ouverture.
async function arMountSeoDomainOv(host, b, priceOf) {
  if (!host) return;
  const ovCost = priceOf("domain_overview") != null ? +((priceOf("domain_overview") || 0) + (priceOf("backlinks_sum") || 0)).toFixed(4) : null;
  host.innerHTML = `<p class="desc" style="margin-bottom:12px;">Estimations <b>tierces</b> de <b>${escapeHtml(b.name)}</b> par DataForSEO (même méthode pour tous, faites pour <b>comparer aux concurrents</b>). Pour un petit site local cet index est partiel : la source officielle reste <b>Search Console</b> ci-dessus.</p>
    ${siCostBtn("arSeoOvBtn", "Analyser le domaine", ovCost)}<div id="arSeoOvResult" style="margin-top:14px;"></div>`;
  const out = host.querySelector("#arSeoOvResult");
  const kw = (n) => `${n} mot${n > 1 ? "s" : ""}-clé${n > 1 ? "s" : ""}`;
  const renderOv = (o, bd) => {
    if (!out) return; o = o || {};
    const total = o.count || 0;
    const buckets = [
      { label: "Top 3", sub: "positions 1 à 3 · haut de la 1ʳᵉ page", value: (o.pos1 || 0) + (o.pos23 || 0) },
      { label: "Reste de la 1ʳᵉ page", sub: "positions 4 à 10", value: o.pos410 || 0 },
      { label: "2ᵉ page", sub: "positions 11 à 20", value: o.pos1120 || 0 },
      { label: "Au-delà", sub: "positions 21 à 50", value: (o.pos2130 || 0) + (o.pos3140 || 0) + (o.pos4150 || 0) },
    ];
    const sumD = buckets.reduce((n, x) => n + x.value, 0) || 1, maxD = Math.max(1, ...buckets.map((x) => x.value));
    out.innerHTML = `<div class="ga-cards" style="margin:0 0 14px;">
        ${pgScore("Mots-clés référencés", pgFmtN(total), "", "indexés par DataForSEO dans Google")}
        ${pgScore("Trafic SEO estimé", pgFmtN(o.etv || 0), "", "visites organiques estimées / mois")}
        ${pgScore("Valeur du trafic", o.value ? pgFmtN(o.value) + " €" : "—", "", o.value ? "coût équivalent en Google Ads / mois" : "requêtes de marque/locales : ~0 enchère")}
        ${pgScore("Sites référents", bd && bd.referringDomains != null ? pgFmtN(bd.referringDomains) : "—", "", bd && bd.backlinks != null ? "sites distincts qui font un lien (" + pgFmtN(bd.backlinks) + " liens)" : "sites qui font un lien vers celui-ci")}
      </div>
      ${pgPanel("Où se classent les mots-clés du site dans Google", `<p class="desc" style="margin-bottom:12px;">Les <b>${total}</b> mots-clés que DataForSEO indexe pour ${escapeHtml(b.name)}, répartis par position. Plus une position est haute, plus elle rapporte de clics.</p>
        <div class="ga-tbl">${buckets.map((x) => `<div class="ga-tr"><span class="ga-tl">${x.label}<span style="display:block;color:var(--dim);font-size:11px;">${x.sub}</span></span><span class="ga-tbar"><span class="ga-tbar-f" style="width:${Math.round(x.value / maxD * 100)}%;background:#7fb2e8"></span></span><span class="ga-tv">${kw(x.value)}<span class="ga-tpct">${Math.round(x.value / sumD * 100)} %</span></span></div>`).join("")}</div>`)}
      ${bd ? pgPanel("Popularité du site (backlinks)", `<p class="desc" style="margin-bottom:12px;">Les backlinks sont les liens d'autres sites vers celui-ci : un signal de confiance majeur pour Google.</p>
        ${pgKV([["Autorité du domaine", bd.rank ? pgFmtN(bd.rank) + " / 1000" : "pas encore évaluée", false], ["Sites différents qui font un lien", pgFmtN(bd.referringDomains || 0), false], ["Nombre total de liens entrants", pgFmtN(bd.backlinks || 0), false], ["Liens cassés (côté sites liants)", pgFmtN(bd.brokenBacklinks || 0), false]])}`) : ""}`;
    mArrive(out);
  };
  host.querySelector("#arSeoOvBtn").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = "Analyse…";
    const [ov, bl] = await Promise.all([window.olympus.siDomainOverview(b.id), window.olympus.siBacklinks(b.id)]);
    btn.disabled = false; btn.innerHTML = `Actualiser <span class="si-cost">(${siEur(ovCost)})</span>`;
    if (!ov?.ok) { out.innerHTML = `<div class="ga-note">${escapeHtml(ov?.error || "Échec")}${ov?.budgetBlocked ? " — règle le budget dans Titan." : ""}</div>`; return; }
    renderOv(ov.data.organic, bl?.ok ? bl.data : null);
  };
  Promise.all([window.olympus.siDomainOverview(b.id, true), window.olympus.siBacklinks(b.id, true)]).then(([ov, bl]) => { if (ov?.ok && ov.data) renderOv(ov.data.organic, bl?.ok ? bl.data : null); });
}
// Concurrents SEO RÉ-ALIGNÉS sur les VRAIS concurrents locaux (même secteur, Google Maps via Notoriété)
// — fini les médias/aggregateurs hors secteur (Monaco Info, tripadvisor…). Poids SEO + content gap.
async function arMountSeoCompetitors(host, b, priceOf) {
  if (!host) return;
  host.innerHTML = `<div class="ga-note" style="opacity:.6;">Chargement des concurrents du secteur…</div>`;
  const rr = await window.olympus.siLocalCompetitors(b.id, true, 100); // peek Notoriété (gratuit)
  if (arView !== "seo" || arBrandOf()?.id !== b.id) return;
  const all = (rr?.ok && rr.data && rr.data.competitors) || [];
  const seen = new Set();
  const comps = all.filter((c) => c.domain && !c.mine && !seen.has(c.domain) && seen.add(c.domain)).slice(0, 12);
  if (!comps.length) {
    host.innerHTML = `<div class="ga-note">Pour voir tes vrais concurrents SEO, lance d'abord l'analyse dans <b data-goto-noto>Notoriété</b> (concurrents locaux du même secteur). ${all.length ? "Aucun de tes concurrents locaux n'a de site web référencé." : ""}</div>`;
    const g = host.querySelector("[data-goto-noto]"); if (g) g.onclick = () => arGoView("notoriete");
    return;
  }
  const ovCost = priceOf("domain_overview");
  const gapCost = priceOf("content_gap");
  const weightTxt = (d) => d && d.organic ? `${d.organic.count != null ? pgFmtN(d.organic.count) + " mots-clés" : ""}${d.organic.etv != null ? " · ~" + pgFmtN(d.organic.etv) + " visites/mois" : ""}` : "";
  const renderGap = (i, dom, ks) => { const go = host.querySelector("#arScGap" + i); if (!go) return; ks = ks || []; if (!ks.length) { go.innerHTML = `<div class="ga-note">Aucun mot-clé manquant vs ${escapeHtml(dom)}. 👍</div>`; return; } go.innerHTML = `<div class="ga-note" style="margin:6px 0;">${ks.length} mots-clés que <b>${escapeHtml(dom)}</b> capte et pas toi :</div><div class="ga-tbl">${ks.map((k) => `<div class="ga-tr"><span class="ga-tl">${escapeHtml(k.keyword)}</span><span class="ga-tv" style="margin-left:auto;">${k.volume != null ? pgFmtN(k.volume) + " vol." : "—"}<span class="ga-tpct">${k.position != null ? "eux pos. " + k.position : ""}</span></span></div>`).join("")}</div>`; };
  host.innerHTML = `<div class="ga-note" style="margin:0 0 10px;font-size:11.5px;">Tes <b>vrais concurrents locaux</b> (même secteur, issus de Google Maps via <b>Notoriété</b>) qui ont un site web. « <b>Poids SEO</b> » = leur nombre de mots-clés référencés + trafic estimé ; « <b>Content gap</b> » = les mots-clés qu'ils captent et pas toi.</div>
    <div style="margin-bottom:10px;">${siCostBtn("arScAllBtn", "Charger le poids SEO de tous", ovCost != null ? +(ovCost * comps.length).toFixed(3) : null)}</div>
    <div class="ga-tbl">${comps.map((c, i) => `
      <div class="ar-seocomp" data-comp="${escapeHtml(c.domain)}">
        <div class="ar-seocomp-h">
          <span class="d">${escapeHtml(c.domain)}${c.title ? ` <span style="color:var(--dim);font-size:10px;">${escapeHtml(c.title)}</span>` : ""}</span>
          <span class="m" id="arScW${i}"></span>
          ${siCostBtn("arScGapBtn" + i, "Content gap", gapCost, "btn sec")}
        </div>
        <div class="ar-gap-out" id="arScGap${i}"></div>
      </div>`).join("")}</div>`;
  const setW = (i, sr) => { const w = host.querySelector("#arScW" + i); if (w && sr?.ok && sr.data) w.textContent = weightTxt(sr.data); };
  comps.forEach((c, i) => {
    window.olympus.siDomainOverview(b.id, true, c.domain).then((sr) => setW(i, sr)); // peek du poids (gratuit si déjà en cache)
    const gb = host.querySelector("#arScGapBtn" + i);
    gb.onclick = async () => {
      gb.disabled = true; gb.innerHTML = "…";
      const gr = await window.olympus.siContentGap(b.id, c.domain);
      gb.disabled = false; gb.innerHTML = `Content gap <span class="si-cost">(${siEur(gapCost)})</span>`;
      if (!gr?.ok) { host.querySelector("#arScGap" + i).innerHTML = `<div class="ga-note">${escapeHtml(gr?.error || "Échec")}${gr?.budgetBlocked ? " — règle le budget dans Titan." : ""}</div>`; return; }
      renderGap(i, c.domain, gr.data.items);
    };
  });
  const allBtn = host.querySelector("#arScAllBtn");
  allBtn.onclick = async () => {
    allBtn.disabled = true; allBtn.innerHTML = "Analyse…";
    await Promise.all(comps.map((c, i) => window.olympus.siDomainOverview(b.id, false, c.domain).then((sr) => setW(i, sr))));
    allBtn.disabled = false; allBtn.innerHTML = `Actualiser <span class="si-cost">(${siEur(+(ovCost * comps.length).toFixed(3))})</span>`;
  };
  mArrive(host);
}

// ── Audit technique : crawl du site client (gratuit), Health Score + tickets d'action ──
function arCrawlResultHtml(d) {
  const rate = d.healthScore >= 90 ? "good" : d.healthScore >= 70 ? "warn" : "poor";
  const sevLabel = { high: "Critique", med: "Important", low: "Mineur" };
  let h = `<div class="ga-cards">
    ${pgScore("Health Score", `<span class="cwv-score ${rate}" style="font-size:22px;padding:4px 14px;">${d.healthScore}</span>`, "", "/100")}
    ${pgScore("Pages analysées", String(d.pages))}
    ${pgScore("Pages indexables", String(d.indexable))}
    ${pgScore("Tickets", String((d.tickets || []).length))}
  </div>`;
  h += pgPanel("Tickets d'action priorisés", (d.tickets || []).length ? (d.tickets || []).map((t, i) => `
    <div class="ar-ticket ${t.sev}">
      <div class="ar-ticket-h" data-tk="${i}">
        <span class="ar-ticket-sev">${sevLabel[t.sev]}</span>
        <span class="ar-ticket-l">${escapeHtml(t.label)}</span>
        <span class="ar-ticket-c">${t.count}</span>
      </div>
      ${(t.sample || []).length ? `<div class="ar-ticket-s" id="arTk${i}" style="display:none;">${t.sample.map((u) => `<span>${escapeHtml((u || "").replace(/^https?:\/\/[^/]+/, "") || "/")}</span>`).join("")}</div>` : ""}
    </div>`).join("") : `<div class="ga-note">Aucun problème technique détecté. 🎉</div>`);
  return h;
}
// Audit technique (crawl du site) — FUSIONNÉ dans la vue Site web (`arViewWeb`), monté en panneau.
// Le crawl part de l'URL du site Search Console ; sans SC mappé, on invite à l'associer.
async function arMountAudit(host, b) {
  if (!host) return;
  const hasSC = (b.assets || []).some((a) => a.network === "search_console");
  if (!hasSC) { host.innerHTML = pgPanel("Audit technique du site", `<div class="ga-note">Associe un site <b>Search Console</b> à ce client dans <b data-goto-settings3>Réglages</b> pour lancer l'audit technique (crawl gratuit du site).</div>`); const g = host.querySelector("[data-goto-settings3]"); if (g) g.onclick = () => goTo("settings"); return; }
  const peek = await arGet(b.id + ":crawl", () => window.olympus.argosCrawl(b.id, false, true));
  const has = peek?.ok && peek.data;
  const when = peek?.at ? " · dernier audit " + new Date(peek.at).toLocaleDateString("fr-FR") : "";
  host.innerHTML = `<div class="ga-panel"><div class="ga-panel-h">Audit technique du site<span style="color:var(--dim);font-weight:400;font-size:12px;">${when}</span><span class="ga-panel-x"><button class="btn${has ? " sec" : ""}" id="arCrawlBtn">${has ? "Relancer l'audit" : "Lancer l'audit du site"}</button></span></div>
    <div id="arCrawlOut">${has ? arCrawlResultHtml(peek.data) : `<div class="ga-note">Analyse jusqu'à 80 pages du site : erreurs 404, redirections, balises manquantes, images sans ALT, contenu léger… puis un Health Score et des tickets d'action. Gratuit.</div>`}</div></div>`;
  const wire = () => { host.querySelectorAll("[data-tk]").forEach((el) => el.onclick = () => { const s = host.querySelector("#arTk" + el.dataset.tk); if (s) s.style.display = s.style.display === "none" ? "" : "none"; }); };
  wire();
  const btn = host.querySelector("#arCrawlBtn");
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "Crawl en cours… (jusqu'à 1 min)";
    const out = host.querySelector("#arCrawlOut"); out.innerHTML = `<div class="ga-note" style="opacity:.7;">Analyse des pages du site…</div>`;
    const rr = await window.olympus.argosCrawl(b.id, true);
    if (arView !== "web" || arBrandOf()?.id !== b.id) return;
    btn.disabled = false; btn.textContent = "Relancer l'audit"; btn.classList.add("sec");
    if (!rr?.ok) { out.innerHTML = `<div class="ga-note">${escapeHtml(rr?.error || "Échec du crawl.")}</div>`; return; }
    arCache[b.id + ":crawl"] = { ok: true, data: rr.data, at: Date.now() };
    out.innerHTML = arCrawlResultHtml(rr.data); wire(); mArrive(out);
  };
}
// ── Réutilisation des composants Pegasus (Audience/SEO/Performance/Sécurité) dans les vues Argos ──
// Un composant qui exige le plugin Pegasus installé sur le site du client est grisé (texte rouge) tant
// que le plugin n'est pas joignable. Appariement marque↔site Pegasus par domaine Search Console.
let _arPgSitesCache = null; const _arPgInstalled = {};
async function arPegasusSites() {
  if (pgSites && pgSites.length) return pgSites;
  if (_arPgSitesCache) return _arPgSitesCache;
  try { const r = await window.olympus.pegasusSites(); _arPgSitesCache = (r && r.ok && r.sites) || []; } catch { _arPgSitesCache = []; }
  return _arPgSitesCache;
}
const arDomHost = (u) => (u || "").replace(/^https?:\/\//, "").replace(/^sc-domain:/, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
async function arPegasusSite(b) {
  const sc = (b.assets || []).find((a) => a.network === "search_console");
  const host = arDomHost(sc && sc.id); if (!host) return null;
  const sites = await arPegasusSites();
  return sites.find((s) => arDomHost(s.host || s.base_url) === host || arDomHost(s.base_url) === host) || null;
}
async function arPegasusInstalled(site) {
  if (!site) return false;
  if (_arPgInstalled[site.key] !== undefined) return _arPgInstalled[site.key];
  try { const h = await window.olympus.pegasusSiteHealth(site.key); _arPgInstalled[site.key] = !!(h && h.ok); } catch { _arPgInstalled[site.key] = false; }
  return _arPgInstalled[site.key];
}
// Carte grisée « plugin requis » (fond gris + texte rouge). L'action à faire est côté client :
// installer le plugin Pegasus sur son WordPress — ensuite le composant s'active tout seul.
function arPegasusGate(host, title, why) {
  if (!host) return;
  host.innerHTML = `<div class="ga-panel locked"><div class="ga-panel-h">${escapeHtml(title)}</div>
    <div class="ga-note lockmsg">${why || "Installe le plugin Pegasus sur le WordPress du client pour avoir accès à cette fonctionnalité (elle s'active alors automatiquement)."}</div></div>`;
}
// Réutilise un onglet Pegasus (perf/secu/seo) dans un conteneur Argos : peuple son état, rend le
// builder pur (pgTabPerf/Secu/Seo) et recâble son bouton « Lancer/Relancer ».
function arMountPgTab(host, b, site, installed, cfg) {
  if (!host) return;
  if (!site || (cfg.needPlugin && !installed)) { arPegasusGate(host, cfg.title); return; }
  const key = site.key, st = cfg.state;
  const render = () => { if (arView !== cfg.view || arBrandOf()?.id !== b.id) return; host.innerHTML = `<div class="ar-pgsec">${cfg.tab(site)}</div>`; wire(); mArrive(host); };
  const wire = () => { const bt = host.querySelector("#" + cfg.btn); if (bt) bt.onclick = async () => { st[key] = { loading: true }; render(); st[key] = await cfg.run(key); render(); }; };
  render();
}
// Audience Pegasus (visites mesurées par le plugin) — panneau compact dans Site web.
async function arMountPgAudience(host, b, site, installed) {
  if (!host) return;
  if (!site || !installed) { arPegasusGate(host, "Audience du site (Pegasus)"); return; }
  host.innerHTML = `<div class="ga-note" style="opacity:.6;">Lecture de l'audience du site…</div>`;
  const r = await window.olympus.pegasusAudiencePegasus(site.key, 30);
  if (arView !== "web" || arBrandOf()?.id !== b.id) return;
  if (!r || (!r.ok && /404|rest_no_route|no_route/i.test(r.error || ""))) { arPegasusGate(host, "Audience du site (Pegasus)", "Le traqueur d'audience nécessite la dernière version du plugin Pegasus sur le site."); return; }
  if (!r.ok) { host.innerHTML = `<div class="ar-pgsec">${pgGaHead("Audience du site", { label: site.label })}<div class="ga-note">Lecture impossible : ${escapeHtml(r.error || "")}</div></div>`; return; }
  const d = r.data || {};
  let html = `<div class="ar-pgsec">${pgGaHead("Audience du site", { label: site.label })}`;
  if (!d.total) { html += `<div class="ga-note">Aucune visite mesurée pour l'instant — la mesure Pegasus vient de démarrer, les visites s'accumulent au fil du trafic.</div></div>`; host.innerHTML = html; mArrive(host); return; }
  const mobile = (d.devices || []).find((x) => x.label === "mobile"); const mobilePct = d.total ? Math.round((mobile?.value || 0) / d.total * 100) : 0;
  html += `<div class="ga-cards">
      ${pgScore("Visites", pgFmtN(d.total), "", "30 j · mesuré par Pegasus")}
      ${pgScore("Visiteurs uniques", pgFmtN(d.uniques || 0))}
      ${pgScore("Part mobile", mobilePct + " %")}
    </div>`;
  html += pgPanel("Visites par jour", pgAreaChart((d.byDay || []).map((x) => ({ label: pgDayLabel(x.date), value: x.hits }))));
  html += `<div class="ga-breaks">`;
  if (d.sources?.length) html += pgPanel("Provenance", pgDonut(d.sources.map((x) => ({ label: x.label, value: x.value })), { centerLabel: "visites" }));
  if (d.pages?.length) html += pgPanel("Pages les plus vues", pgBreak(d.pages.map((x) => ({ label: x.label, value: x.value })), { color: "var(--ok)" }));
  html += `</div></div>`;
  host.innerHTML = html; mArrive(host);
}

// ── Veille SEA : présence publicitaire Google Ads (client vs concurrents) via DataForSEO ──
// Carte campagne Google Ads RICHE (partagée par « Mots-clés Ads » et la Veille SEA) : type, statut,
// budget, dépense, CPC, impressions, clics, conversions + mots-clés + audiences + zones géographiques.
function arAdsCampCard(c, ck, ca, cg, totalSpend, market, competitors, placements, compMeta) {
  const matchLbl = (m) => ({ EXACT: "exact", PHRASE: "expression", BROAD: "large" }[m] || (m || "").toLowerCase());
  const compLbl = (x) => ({ LOW: "faible", MEDIUM: "moyenne", HIGH: "forte" }[x] || (x || "—").toLowerCase());
  const sharePct = totalSpend ? Math.round((c.spend || 0) / totalSpend * 100) : 0;
  const head = `<div class="ar-adscamp-h">
      <span class="nm">${escapeHtml(c.name)}</span>
      <span class="ty">${escapeHtml(c.channelLabel)}</span>
      <span class="ar-adscamp-st ${c.current ? "on" : "off"}">${c.current ? "active" : "en pause"}</span>
      ${c.optScore != null ? `<span class="ar-adscamp-score ${c.optScore >= 80 ? "hi" : c.optScore >= 60 ? "mid" : "lo"}" title="Score d'optimisation Google Ads de la campagne">optim. ${c.optScore}%</span>` : ""}
      <span class="meta">${c.dailyBudget != null ? "budget " + siEurNum(c.dailyBudget) + " €/j · " : ""}${pgFmtN(Math.round(c.spend))} € · CPC ${siEurNum(c.cpc)} € · ${pgFmtN(c.impressions)} impr. · ${pgFmtN(c.clicks)} clics${c.conversions ? " · " + pgFmtN(c.conversions) + " conv." : ""}</span>
    </div>
    ${totalSpend ? `<div class="ar-adscamp-bar" title="${sharePct}% de la dépense de la période"><i style="width:${Math.max(2, sharePct)}%"></i></div>` : ""}`;
  // Cohérence : part servie par le CIBLAGE AUTOMATIQUE (= total campagne − critères explicites). Sur du
  // Display/Notoriété, Google diffuse l'essentiel via l'optimized targeting, au-delà de tes signaux.
  const sumKwClicks = ck.reduce((n, k) => n + (k.clicks || 0), 0), sumKwCost = ck.reduce((n, k) => n + (k.cost || 0), 0);
  const sumAudClicks = ca.reduce((n, a) => n + (a.clicks || 0), 0), sumAudCost = ca.reduce((n, a) => n + (a.cost || 0), 0);
  const autoClicks = Math.max(0, (c.clicks || 0) - sumKwClicks - sumAudClicks);
  const autoCost = Math.max(0, +((c.spend || 0) - sumKwCost - sumAudCost).toFixed(2));
  const hasPlc = placements && placements.length;
  const showAuto = autoClicks > (c.clicks || 0) * 0.05 && !hasPlc; // les emplacements réels remplacent l'approximation
  let body;
  if (!ck.length) {
    body = `<div class="ga-note" style="margin:8px 0 0;">${c.usesKeywords ? "Aucun mot-clé actif sur cette campagne." : "Campagne <b>" + escapeHtml(c.channelLabel) + "</b> — ciblage par audience" + (ca.length ? " (voir ci-dessous)" : "") + ", pas de mots-clés d'enchère."}</div>`;
  } else {
    // Colonnes adaptatives : perf client (seulement en Search — inutile en Display) + marché (après analyse).
    const showPerf = !!c.usesKeywords, showMkt = !!(market && ck.length);
    const posDisp = (m) => (m && m.position != null) ? m.position + "ᵉ" : (m && ("position" in m)) ? `<span style="color:var(--dim);">non</span>` : "—";
    const g = `grid-template-columns:minmax(120px,1.4fr) 80px${showPerf ? " 66px 66px 56px 56px" : ""}${showMkt ? " 78px 66px 84px 76px" : ""};`;
    const signalNote = !c.usesKeywords ? `<div class="ga-note" style="margin:0 0 8px;font-size:11px;">Ces mots-clés sont des <b>signaux de ciblage</b> (campagne ${escapeHtml(c.channelLabel)}) : Google s'en sert pour trouver l'audience, ils ne sont pas facturés au clic.${showMkt ? " « Ta position » = ton rang Google réel sur ce mot-clé ; « non » = hors du top 20." : ""}</div>` : "";
    body = signalNote + `<div class="ar-adskw-head" style="${g}"><span class="k">Mot-clé</span><span class="m">Corresp.</span>${showPerf ? `<span class="c">CPC</span><span class="c">Coût</span><span class="c">Clics</span><span class="c">Conv.</span>` : ""}${showMkt ? `<span class="c">Ta position</span><span class="c">Volume</span><span class="c">CPC marché</span><span class="c">Concur.</span>` : ""}</div>
      ${ck.map((k) => { const m = showMkt ? market[(k.keyword || "").toLowerCase()] : null; return `<div class="ar-adskw-row" style="${g}">
        <span class="k">${escapeHtml(k.keyword)}</span>
        <span class="m">${matchLbl(k.matchType)}</span>
        ${showPerf ? `<span class="c">${k.cpc ? siEurNum(k.cpc) + " €" : "—"}</span><span class="c">${k.cost ? pgFmtN(Math.round(k.cost)) + " €" : "—"}</span><span class="c">${pgFmtN(k.clicks)}</span><span class="c">${k.conversions ? pgFmtN(k.conversions) : "—"}</span>` : ""}
        ${showMkt ? `<span class="c">${posDisp(m)}</span><span class="c">${m && m.volume != null ? pgFmtN(m.volume) : "—"}</span><span class="c">${m && m.cpc != null ? siEurNum(m.cpc) + " €" : "—"}</span><span class="c">${m ? compLbl(m.competition) : "—"}</span>` : ""}
      </div>`; }).join("")}`;
  }
  let audBlock = "";
  if (ca.length || showAuto) {
    audBlock = `<div class="ar-adsaud"><div class="ar-adsaud-t">Segments d'audience ciblés</div>
      ${ca.map((a) => `<div class="ar-adsaud-row"><span class="ty">${escapeHtml(a.typeLabel || "")}</span><span class="nm">${escapeHtml(a.name)}</span><span class="mt">${pgFmtN(a.clicks)} clics${a.cost ? " · " + siEurNum(a.cost) + " €" : ""}</span></div>`).join("")}
      ${showAuto ? `<div class="ar-adsaud-row auto"><span class="ty">auto</span><span class="nm">Ciblage automatique de Google (au-delà de tes signaux)</span><span class="mt">${pgFmtN(autoClicks)} clics · ${siEurNum(autoCost)} €</span></div>` : ""}</div>`;
  }
  // Où est parti le budget : emplacements RÉELS (sites/apps/YouTube). Remplace l'approximation « auto ».
  let plcBlock = "";
  if (hasPlc) {
    const plcName = (p) => ((p.name || p.url || "").replace(/^Mobile App:\s*/i, "").replace(/\s*\((iTunes App Store|Google Play)\).*$/i, "").trim() || p.url || "—");
    const fmtD = (d) => d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—";
    const top = placements.slice(0, 12);
    const plcTotal = placements.reduce((n, p) => n + (p.cost || 0), 0);
    const g = "grid-template-columns:92px 1fr 60px 74px 50px 72px;";
    plcBlock = `<div class="ar-adsplc"><div class="ar-adsaud-t">Où est parti ton budget — emplacements réels</div>
      ${arPlacementsSummaryHtml(placements, c.name)}
      <div class="ar-adskw-head" style="${g}"><span class="k">Type</span><span class="k">Emplacement</span><span class="c">Début</span><span class="c">Fin</span><span class="c">Clics</span><span class="c">Coût</span></div>
      ${top.map((p) => `<div class="ar-adskw-row" style="${g}"><span class="m">${escapeHtml(p.typeLabel || "")}</span><span class="k">${escapeHtml(plcName(p))}</span><span class="c">${fmtD(p.firstDate)}</span><span class="c">${p.ongoing ? `<span class="ar-plc-st on">en cours</span>` : fmtD(p.lastDate)}</span><span class="c">${pgFmtN(p.clicks)}</span><span class="c">${p.cost ? siEurNum(p.cost) + " €" : "—"}</span></div>`).join("")}
      <div class="ga-note" style="margin-top:6px;font-size:11px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span>${placements.length > 12 ? "+ " + (placements.length - 12) + " autres emplacements · " : ""}total listé : <b>${siEurNum(plcTotal)} €</b>${c.spend ? " sur " + pgFmtN(Math.round(c.spend)) + " € de la campagne" : ""}. « Début » = 1er jour sur la période ; « en cours » = actif ces 2 derniers jours.</span>${placements.length > 12 ? `<button class="btn sec" data-plc-modal="${escapeHtml(c.name)}" style="padding:3px 10px;font-size:11px;">Voir les ${placements.length} emplacements</button>` : ""}</div></div>`;
  }
  let geoBlock = "";
  if (cg && (cg.locations.length || cg.excluded.length)) {
    const chip = (l) => `<span class="ar-adsgeo-z${l.proximity ? " prox" : ""}" title="${escapeHtml(l.name)}">${l.proximity ? "📍 " : ""}${escapeHtml(l.name.split(",")[0])}</span>`;
    geoBlock = `<div class="ar-adsgeo"><div class="ar-adsaud-t">Zones géographiques ciblées${cg.locations.length ? " (" + cg.locations.length + ")" : ""}</div>
      <div class="ar-adsgeo-zs">${cg.locations.map(chip).join("") || `<span class="ga-note" style="margin:0;">Aucune (national)</span>`}</div>
      ${cg.excluded.length ? `<div class="ar-adsgeo-excl">Exclues : ${cg.excluded.map((l) => escapeHtml(l.name.split(",")[0])).join(", ")}</div>` : ""}</div>`;
  }
  // Concurrents LOCAUX réels (Google Maps) — bloc partagé (aussi utilisé par la vue Notoriété).
  const mktBlock = arLocalCompetitorsHTML(competitors, compMeta, 14);
  return `<div class="ga-panel ar-adscamp">${head}${body}${audBlock}${plcBlock}${geoBlock}${mktBlock}</div>`;
}
// Tableau « Ta position vs concurrents locaux » (Google Maps) : le client (toi) + concurrents, barre =
// popularité (avis), ★note, avis ; lignes concurrentes cliquables → estimation SEA. Partagé carte campagne + vue Notoriété.
// Couleur des barres du classement selon le tri actif (une couleur par métrique).
const AR_SORT_COLORS = { distance: "#5b9bd5", reviews: "#f6b26b", rating: "#5cb98b" };
function arLocalCompetitorsHTML(competitors, compMeta, limit, barMode, rankMe, filterHtml) {
  if (!competitors || !competitors.length) return "";
  // Le client peut figurer dans ses propres résultats Maps (mine:true).
  // Ligne de référence « toi » TOUJOURS détachée en tête (compMeta.me sinon l'entrée mine)…
  const mineComp = competitors.find((c) => c.mine);
  let me = (compMeta && compMeta.me) || mineComp || null;
  // La carte héro (référence) est à distance 0 de toi-même — récupère la distance de l'entrée mine (≈ 0) sinon 0.
  if (me && me.distance == null) me = { ...me, distance: (mineComp && mineComp.distance != null) ? mineComp.distance : 0 };
  const others = competitors.filter((c) => !c.mine);
  // …et si rankMe, on la RÉAFFICHE aussi à son vrai rang dans le classement (sinon on l'exclut).
  const rows = (rankMe ? competitors : others).slice(0, limit || 14);
  const mode = barMode || "reviews";
  const maxRev = Math.max(1, ...rows.map((r) => r.reviews || 0), (me && me.reviews) || 0);
  const maxDist = Math.max(0.0001, ...rows.map((r) => r.distance || 0), (me && me.distance) || 0);
  // Remplissage 0..1 selon la métrique AFFICHÉE : avis (popularité), note (/5), distance (proche = plus rempli).
  const barFrac = (r, mine) => {
    if (mode === "rating") return Math.max(0, Math.min(1, (r.rating || 0) / 5));
    if (mode === "distance") { const d = mine ? 0 : (r.distance != null ? r.distance : maxDist); return Math.max(0, 1 - d / maxDist); }
    return (r.reviews || 0) / maxRev;
  };
  const barLabel = { reviews: "popularité (nombre d'avis)", rating: "note Google (sur 5)", distance: "proximité (le plus proche = le plus rempli)" }[mode];
  // Au bout de la barre : UNIQUEMENT la donnée du filtre actif.
  const metricHtml = (r) => mode === "distance" ? (r.distance != null ? String(r.distance).replace(".", ",") + " km" : "—")
    : mode === "rating" ? (r.rating != null ? "★ " + String(r.rating).replace(".", ",") : "—")
    : (r.reviews != null ? pgFmtN(r.reviews) + " avis" : "—");
  // Ancienneté (âge du domaine) : mois jusqu'à 3 ans, puis années. undefined = pas encore chargé, null = « NC ».
  const ageHtml = (r) => { const m = r.ageMonths; if (m === undefined) return ""; if (m === null) return "NC"; return m < 36 ? m + " mois" : Math.floor(m / 12) + " ans"; };
  // Métrique COMPLÉMENTAIRE sous la principale (Notoriété only) : vue Avis → note · vue Note → nb d'avis.
  const complHtml = (r) => {
    if (!rankMe) return "";
    if (mode === "reviews") return r.rating != null ? "★ " + String(r.rating).replace(".", ",") : "";
    if (mode === "rating") return r.reviews != null ? pgFmtN(r.reviews) + " avis" : "";
    return "";
  };
  const barColor = AR_SORT_COLORS[mode] || "#f6b26b"; // couleur des barres concurrents = métrique triée
  const q = compMeta && compMeta.keyword ? ` · « ${escapeHtml(compMeta.keyword)} »${compMeta.auto && compMeta.auto.length ? " (auto)" : ""}` : "";
  // variant : "pin" = ligne de référence détachée en tête · "rank" = même établissement à son rang · "" = concurrent.
  const rank = (r) => (rankMe && others.length ? others.filter((o) => sortLt(o, r, mode)).length + 1 : null);
  const rowHtml = (r, mine, variant) => `<div class="ga-tr${mine ? "" : " ar-comp-row"}${variant === "pin" ? " me-pin" : variant === "rank" ? " me-rank" : ""}"${mine ? "" : ` data-comp-name="${escapeHtml(r.title)}" data-comp-domain="${escapeHtml(r.domain || "")}" data-comp-rating="${r.rating != null ? r.rating : ""}" data-comp-reviews="${r.reviews != null ? r.reviews : ""}" data-comp-category="${escapeHtml(r.category || "")}" data-comp-place="${escapeHtml(r.place_id || "")}" data-comp-rank="${rank(r) || ""}" data-comp-distance="${r.distance != null ? r.distance : ""}" title="Voir les avis de ${escapeHtml(r.title)}"`}><span class="ga-tl">${mine ? "◂ " : ""}${escapeHtml(r.title)}${mine ? " (toi)" : ""}${variant === "rank" && rank(r) ? ` <span style="color:var(--accent2);font-weight:600;font-size:10px;">#${rank(r)}</span>` : ""}${r.category ? ` <span style="color:var(--dim);font-size:10px;">${escapeHtml(r.category)}</span>` : ""}${mine ? "" : ` <span class="ar-comp-hint">🔎</span>`}</span><span class="ga-tbar"><span class="ga-tbar-f" style="width:${Math.round(barFrac(r, mine) * 100)}%;background:${mine ? "var(--accent2)" : barColor}"></span></span><span class="ga-tv">${metricHtml(r)}${complHtml(r) ? `<span class="ga-tage">${complHtml(r)}</span>` : ""}${ageHtml(r) ? `<span class="ga-tage">${ageHtml(r)}</span>` : ""}</span></div>`;
  const meCard = me ? `<div class="ar-me-hero"><span class="ar-me-tag">Ton établissement</span>${rowHtml(me, true, "pin")}</div>
    <div class="ar-rank-sep"><span>Le classement du secteur${others.length ? ` · ${others.length} concurrents` : ""}</span></div>` : "";
  return `<div class="ar-adsmkt"><div class="ar-adsaud-t">Ta position vs concurrents locaux (${others.length})${q}</div>
    <div class="ga-note" style="margin:0 0 6px;font-size:11px;">Ton établissement et tes concurrents sur <b>Google Maps</b> (secteur + zone). La <b>barre = ${barLabel}</b>. <b>Clique une ligne</b> pour l'<b>estimation SEA</b> du concurrent (mots-clés payants + budget estimé).</div>
    ${meCard}${filterHtml || ""}<div class="ga-tbl">${rows.map((r) => rowHtml(r, r.mine, r.mine ? "rank" : "")).join("")}</div></div>`;
}
// Ordre de tri identique à sortComps (Notoriété) pour calculer le rang réel de l'établissement.
function sortLt(a, b, mode) {
  if (mode === "distance") { const da = a.distance == null ? Infinity : a.distance, db = b.distance == null ? Infinity : b.distance; return da < db; }
  if (mode === "rating") { if ((b.rating || 0) !== (a.rating || 0)) return (a.rating || 0) > (b.rating || 0); return (a.reviews || 0) > (b.reviews || 0); }
  return (a.reviews || 0) > (b.reviews || 0); // reviews
}
// Modale scrollable : liste COMPLÈTE des emplacements d'une campagne (où est parti le budget).
// Moteur d'efficacité + tendance des emplacements (spec issue du panel de conception, 23/07/2026) :
// score empirical-Bayes piloté par le CPM (coût de portée) + CTR/conv, borne de Wilson anti-clics
// accidentels, matérialité, et recommandation Continuer/Surveiller/Arrêter sur fenêtres R vs P.
// Annote chaque placement avec p._eff = { score, tier, tc, effTip, trend, trc, trendTip }.
function arScorePlacements(placements) {
  const EPS = 1e-9, clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const f = (r) => clamp(50 + 25 * Math.log2(Math.max(r, EPS)), 0, 100);
  const convSupported = placements.some((p) => p.convSupported);
  const W = (placements[0] && placements[0].windowDays) || null;
  // ── Stats campagne ──
  const tImpr = placements.reduce((n, p) => n + p.impressions, 0);
  const tClk = placements.reduce((n, p) => n + p.clicks, 0);
  const tCost = placements.reduce((n, p) => n + p.cost, 0);
  const tConv = placements.reduce((n, p) => n + (p.conv || 0), 0);
  const p0 = Math.max(tClk / Math.max(tImpr, 1), 0.0005);
  let varW = 0; for (const p of placements) { const w = p.impressions / Math.max(tImpr, 1), ctr = p.clicks / Math.max(p.impressions, 1); varW += w * (ctr - p0) ** 2; }
  let M = 300; if (varW > 0 && isFinite(varW) && placements.length >= 5) M = clamp(p0 * (1 - p0) / varW - 1, 100, 2000);
  const cpms = placements.filter((p) => p.impressions >= 100).map((p) => p.cost / p.impressions * 1000);
  const medCPM = cpms.length ? median(cpms) : (tCost / Math.max(tImpr, 1) * 1000 || 1);
  const cpcs = placements.filter((p) => p.clicks > 0).map((p) => p.cost / p.clicks);
  const medCPC = cpcs.length ? median(cpcs) : null; // médiane CPC campagne → base de la lecture « Google / CPC »
  // Impressions RÉELLEMENT vues (Active View). ~1/3 des impressions display ne sont jamais vues
  // (IAS 2025) et le taux varie fortement par emplacement → base de coût bien plus honnête que
  // l'impression brute. Visibilité bornée à 1 (l'API peut renvoyer >100 % par artefact de mesure).
  // On applique le TAUX de visibilité (vues / mesurables) au total des impressions : les impressions
  // non mesurables sont supposées aussi visibles que les mesurées, plutôt que comptées comme non vues
  // — sinon on pénaliserait un trou de mesure au lieu d'un vrai défaut de visibilité.
  const vRateOf = (p) => (p.avSupported && p.avMeas > 0) ? Math.min(1, p.avImpr / p.avMeas) : null;
  const vImprOf = (p) => { const r = vRateOf(p); return r == null ? null : p.impressions * r; };
  const vcpms = placements.filter((p) => (vImprOf(p) || 0) >= 100).map((p) => p.cost / vImprOf(p) * 1000);
  const medVCPM = vcpms.length ? median(vcpms) : null;
  const cpe0 = tConv / Math.max(tCost, 1);
  const useConv = convSupported && tConv >= 10;
  // ── Constantes ──
  // Seuils de suspicion : plus stricts sur les applis (×2,5 vs ×4 sur le web) — appuyé sur la mesure
  // Pixalate T3 2025 (33 % de trafic invalide in-app contre 21 % sur le web). Le seuil ABSOLU vaut
  // 3× le CTR display de référence (~0,5 %) : au-delà, un CTR display est statistiquement anormal.
  const DISPLAY_CTR_BENCH = 0.005;
  const M_CPM = 500, C0 = 20, Z = 1.96, SUS_APP = 2.5, SUS_WEB = 4.0, SUS_CTR_ABS = 3 * DISPLAY_CTR_BENCH, MIN_SUS_CLICKS = 5, S_RAMP_TOP = 8, PEN_MAX = 0.65;
  const W_CONV = 0.60, W_CPM_CV = 0.25, W_ENG_CV = 0.15, W_CPM_AW = 0.65, W_ENG_AW = 0.35;
  const COST_MAT = 2.0, SHARE_MAT = 0.01, SUS_COST = 1.0, SUS_SHARE = 0.005, MW_CTR = 150, MW_CPM = 300;
  const eur = (v) => siEurNum(v), pc = (v, d = 1) => v.toFixed(d).replace(".", ","), dP = (r) => { const v = Math.round((r - 1) * 100); return (v >= 0 ? "+" : "") + v + " %"; };
  for (const p of placements) {
    const n = Math.max(p.impressions, 1);
    const pHat = (p.clicks + p0 * M) / (p.impressions + M);
    // Coût de la portée : mesuré sur les impressions VUES quand Active View est disponible.
    const vI = vImprOf(p), useV = vI != null && medVCPM != null;
    const basisImpr = useV ? vI : p.impressions, basisMed = useV ? medVCPM : medCPM;
    const viewability = vRateOf(p);
    const cpmHat = (p.cost + basisMed / 1000 * M_CPM) / (basisImpr + M_CPM) * 1000;
    const cpeHat = ((p.conv || 0) + cpe0 * C0) / (p.cost + C0);
    const ph = p.clicks / n, wLB = (ph + Z * Z / (2 * n) - Z * Math.sqrt(ph * (1 - ph) / n + Z * Z / (4 * n * n))) / (1 + Z * Z / n);
    const isApp = p.typeLabel === "Application", T = isApp ? SUS_APP : SUS_WEB;
    const gate = p.clicks >= MIN_SUS_CLICKS && (wLB > T * p0 || (isApp && wLB >= SUS_CTR_ABS)) && !((p.conv || 0) > 0);
    const S = gate ? clamp((pHat / p0 - T) / (S_RAMP_TOP - T), 0.25, 1) : 0;
    const compCost = f(basisMed / Math.max(cpmHat, EPS));
    const compEng = S > 0 ? 50 : f(pHat / p0);
    const compConv = f(cpeHat / Math.max(cpe0, EPS));
    const raw = useConv ? W_CONV * compConv + W_CPM_CV * compCost + W_ENG_CV * compEng : W_CPM_AW * compCost + W_ENG_AW * compEng;
    const score = Math.round(raw * (1 - PEN_MAX * S));
    const material = p.cost >= COST_MAT || p.cost / Math.max(tCost, 1) >= SHARE_MAT;
    const susMaterial = p.cost >= SUS_COST || p.cost / Math.max(tCost, 1) >= SUS_SHARE;
    // ── Tier (ordre strict) ──
    let tier, tc;
    if (p.impressions < 100 && p.cost < 2) { tier = "Volume insuffisant"; tc = "na"; }
    else if (S >= 0.7 && susMaterial) { tier = "À exclure"; tc = "lo"; }
    else if (score >= 70) { tier = "Efficace"; tc = "hi"; }
    else if (score >= 45) { tier = "Correct"; tc = "mid"; }
    else if (score >= 25) { tier = "Faible"; tc = "warn"; }
    else if (material) { tier = "À exclure"; tc = "lo"; }
    else { tier = "Faible"; tc = "warn"; }
    // ── Tooltip efficacité ──
    let effTip;
    if (tier === "Volume insuffisant") effTip = `Seulement ${pgFmtN(p.impressions)} impressions et ${eur(p.cost)} € : estimation ramenée vers la moyenne de la campagne, échantillon insuffisant pour juger seul.`;
    else if (S > 0) effTip = `CTR ${pc(ph * 100, 2)} % ≈ ${(pHat / p0).toFixed(1)}× la référence campagne sur une application, sans aucune conversion. Ce profil (CTR anormalement élevé + 0 conversion sur du display in-app) est celui des clics accidentels et du trafic invalide — Pixalate mesure 33 % de trafic invalide sur l'inventaire mobile in-app (T3 2025). Score pénalisé, exclusion conseillée.`;
    else { const cheaper = cpmHat <= basisMed, portee = basisMed ? Math.abs((1 - cpmHat / basisMed) * 100) : 0;
      const lbl = useV ? "CPM visible" : "CPM";
      effTip = `${lbl} ${eur(cpmHat)} € vs ${eur(basisMed)} € (médiane campagne) : portée ${pc(portee, 0)} % ${cheaper ? "moins chère" : "plus chère"}.`;
      if (useV) effTip += ` Calculé sur les impressions réellement vues (visibilité ${pc(viewability * 100, 0)} %)${viewability < 0.7 ? ` — attention, ${pc((1 - viewability) * 100, 0)} % des impressions facturées ici ne sont jamais vues` : ""}.`;
      effTip += ` CTR ajusté ${pc(pHat * 100, 2)} % (base ${pc(p0 * 100, 2)} %). ${pc(p.cost / Math.max(tCost, 1) * 100, 1)} % du budget.`;
      if (useConv) effTip += ` ${(p.conv || 0).toFixed(1)} conv. pour ${eur(p.cost)} €.`;
    }
    // ── Tendance (fenêtres R vs P, taux shrinkés) ──
    const R = p.R || { impr: 0, clicks: 0, cost: 0, conv: 0 }, P = p.P || { impr: 0, clicks: 0, cost: 0, conv: 0 };
    const sCTR = (w) => (w.clicks + pHat * MW_CTR) / (w.impr + MW_CTR);
    const sCPM = (w) => (w.cost + cpmHat / 1000 * MW_CPM) / (w.impr + MW_CPM) * 1000;
    const dCPM = sCPM(R) / Math.max(sCPM(P), EPS), dCTR = sCTR(R) / Math.max(sCTR(P), EPS);
    const dCost = P.cost > 0 ? R.cost / P.cost : 1;
    const dCPA = (useConv && R.conv > 0 && P.conv > 0) ? (R.cost / R.conv) / (P.cost / P.conv) : null;
    const deltas = `CPM ${dP(dCPM)}, CTR ajusté ${dP(dCTR)}, coût ${dP(dCost)}${dCPA != null ? ", CPA " + dP(dCPA) : ""}`;
    let trend, trc, reason;
    if (!p.ongoing) { trend = "Terminé"; trc = "na"; reason = `Placement inactif depuis ${p.daysSinceLast != null ? p.daysSinceLast : "?"} j (${p.current ? "diffusion terminée" : "campagne en pause"}). Coût total : ${eur(p.cost)} €.`; }
    else if (tier === "À exclure") { trend = "Arrêter"; trc = "lo"; reason = (S >= 0.7 ? "Suspicion de clics accidentels" : "Efficience très faible pour un coût significatif") + ` — ${deltas}.`; }
    else if (P.impr < 50) { trend = "Surveiller"; trc = "warn"; reason = `Nouveau placement, historique insuffisant (${deltas}).`; }
    else if (R.impr < 50) { trend = "Surveiller"; trc = "warn"; reason = `Activité en forte baisse (${deltas}).`; }
    else if (R.impr + P.impr < 200) { trend = score >= 45 ? "Continuer" : "Surveiller"; trc = score >= 45 ? "hi" : "warn"; reason = `Volume trop faible pour une tendance fiable (${deltas}).`; }
    else if (dCPA != null && dCPA > 1.75) { trend = "Arrêter"; trc = "lo"; reason = `CPA en dérive forte — ${deltas}.`; }
    else if (tier === "Faible" && dCost >= 1.5) { trend = "Arrêter"; trc = "lo"; reason = `Coût en accélération sur un placement faible — ${deltas}.`; }
    else if (dCPM > 1.30 || dCTR < 0.70 || (dCPA != null && dCPA > 1.30)) { trend = score < 45 ? "Arrêter" : "Surveiller"; trc = score < 45 ? "lo" : "warn"; reason = `Dégradation — ${deltas}.`; }
    else if (score >= 45) { trend = "Continuer"; trc = "hi"; reason = `Stable — ${deltas}.`; }
    else { trend = "Surveiller"; trc = "warn"; reason = `Efficience médiocre mais stable — ${deltas}.`; }
    const trendTip = p.ongoing ? `Sur les ${W || "?"} derniers jours vs précédents : ${reason}` : reason;
    // Détail chiffré complet — alimente la fiche au clic (arPlacementDetailModal).
    const detail = {
      ph, pHat, p0, wLB, S, isApp, T,
      cpm: p.impressions ? p.cost / p.impressions * 1000 : null, cpmHat, medCPM,
      useV, viewability, vcpm: (vI ? p.cost / vI * 1000 : null), medVCPM, basisMed,
      cpc: p.clicks ? p.cost / p.clicks : null, medCPC,
      compCost, compEng, compConv, raw, useConv, cpeHat, cpe0,
      budgetShare: p.cost / Math.max(tCost, 1), material, susMaterial,
      dCPM, dCTR, dCost, dCPA, R, P, W, reason,
    };
    p._eff = { score, tier, tc, effTip, trend, trc, trendTip, detail };
    // ── Éval. « Google / CPC » : la lecture naïve (clics pas chers = bien) que corrige l'efficacité réelle ──
    let gLabel = "—", gc = "na", gRank = 0, gTip = "Aucun clic sur la période : la lecture « coût par clic » n'a rien à évaluer.";
    if (p.clicks > 0 && medCPC) {
      const cpcv = p.cost / p.clicks, ratio = cpcv / medCPC;
      if (ratio <= 0.6) { gLabel = "Bon"; gc = "hi"; gRank = 3; }
      else if (ratio <= 1.4) { gLabel = "Moyen"; gc = "warn"; gRank = 2; }
      else { gLabel = "Cher"; gc = "lo"; gRank = 1; }
      gTip = `Lecture « coût par clic » de Google : CPC ${eur(cpcv)} € vs ${eur(medCPC)} € (médiane campagne) → clics ${ratio <= 1 ? "bon marché" : "chers"}. ⚠ Un CPC bas ne dit rien de la QUALITÉ du trafic (clics accidentels, zéro conversion…) : compare toujours avec l'efficacité réelle.`;
    }
    p._goog = { label: gLabel, gc, rank: gRank, tip: gTip };
  }
  return placements;
}
// Résumé visuel « où est parti le budget » : barre empilée du coût par palier d'efficacité + KPIs +
// phrase de synthèse. Transforme 300 lignes en une lecture instantanée. Idempotent (re-score OK).
function arPlacementsSummaryHtml(placements, campName) {
  if (!placements || !placements.length) return "";
  arScorePlacements(placements);
  const COL = { hi: "var(--ok)", mid: "color-mix(in srgb, var(--ok) 50%, var(--line))", warn: "var(--warn)", lo: "var(--err)", na: "color-mix(in srgb, var(--txt) 20%, var(--line))" };
  const TIERS = [{ key: "Efficace", cls: "hi" }, { key: "Correct", cls: "mid" }, { key: "Faible", cls: "warn" }, { key: "À exclure", cls: "lo" }, { key: "Volume insuffisant", cls: "na" }];
  const byTier = {}; let total = 0;
  for (const p of placements) { const t = (p._eff && p._eff.tier) || "Volume insuffisant"; (byTier[t] = byTier[t] || { cost: 0, n: 0 }); byTier[t].cost += p.cost || 0; byTier[t].n++; total += p.cost || 0; }
  if (total <= 0) return "";
  const c = (k) => (byTier[k] && byTier[k].cost) || 0;
  const good = c("Efficace") + c("Correct"), bad = c("Faible") + c("À exclure"), excl = c("À exclure");
  let vCost = 0, vSeen = 0; for (const p of placements) { const v = (p.avSupported && p.avMeas > 0) ? Math.min(1, p.avImpr / p.avMeas) : null; if (v != null) { vCost += p.cost || 0; vSeen += (p.cost || 0) * v; } }
  const viewPct = vCost > 0 ? Math.round(vSeen / vCost * 100) : null;
  const active = placements.filter((p) => p.ongoing), activeEur = active.reduce((n, p) => n + (p.cost || 0), 0);
  // « Bons mais arrêtés » : efficaces (Correct/Efficace) que Google a cessé de diffuser — l'opportunité perdue.
  const goodStopped = placements.filter((p) => !p.ongoing && ["Efficace", "Correct"].includes(p._eff && p._eff.tier));
  const gsEur = goodStopped.reduce((n, p) => n + (p.cost || 0), 0);
  const eur = (v) => siEurNum(v) + " €", pc = (v) => Math.round(v / total * 100) + " %";
  const present = TIERS.filter((t) => c(t.key) > 0);
  const hint = campName ? " · Cliquer pour voir ces emplacements" : " · Cliquer pour filtrer";
  const seg = present.map((t) => `<span class="clickable" data-eff-tier="${escapeHtml(t.key)}" style="width:${(c(t.key) / total * 100).toFixed(2)}%;background:${COL[t.cls]};" data-tip="${escapeHtml(t.key)} : ${eur(c(t.key))} (${pc(c(t.key))}) · ${byTier[t.key].n} emplacement(s)${hint}"></span>`).join("");
  const legend = present.map((t) => `<span class="ar-plcsum-lg clickable" data-eff-tier="${escapeHtml(t.key)}" data-tip="${escapeHtml(t.key)}${hint}"><i style="background:${COL[t.cls]}"></i>${escapeHtml(t.key)} <b>${eur(c(t.key))}</b> <span>${pc(c(t.key))}</span></span>`).join("");
  const kpi = (l, v, cls) => `<div class="ar-plcsum-kpi ${cls || ""}"><span class="ar-plcsum-kl">${l}</span><span class="ar-plcsum-kv">${v}</span></div>`;
  return `<div class="ar-plcsum"${campName ? ` data-camp="${escapeHtml(campName)}"` : ""}>
    <div class="ar-plcsum-kpis">
      ${kpi("Budget total", eur(total))}
      ${kpi("Efficace / Correct", `${eur(good)} · ${pc(good)}`, "good")}
      ${kpi("Faible / À exclure", `${eur(bad)} · ${pc(bad)}`, "bad")}
      ${viewPct != null ? kpi("Part réellement vue", viewPct + " %", viewPct < 70 ? "bad" : "") : ""}
      ${kpi("Diffusent encore", `${active.length} · ${eur(activeEur)}`)}
      ${goodStopped.length ? `<div class="ar-plcsum-kpi op clickable" data-eff-tier="__goodstopped__" data-tip="Emplacements efficaces (Correct/Efficace) que Google a cessé de diffuser tout seul${campName ? " · Cliquer pour les voir" : " · Cliquer pour filtrer"}."><span class="ar-plcsum-kl">★ Bons mais arrêtés</span><span class="ar-plcsum-kv">${goodStopped.length} · ${eur(gsEur)}</span></div>` : ""}
    </div>
    <div class="ar-plcsum-bar">${seg}</div>
    <div class="ar-plcsum-legend">${legend}</div>
    ${bad > 0 ? `<p class="ar-plcsum-head">Sur ${eur(total)}, <b>${eur(bad)} (${pc(bad)})</b> sont partis dans des emplacements « Faible » ou « À exclure »${excl > 0 ? `, dont <b>${eur(excl)}</b> clairement à exclure` : ""}.</p>` : ""}
  </div>`;
}
function arPlacementsModal(campName, placements, initialEffFilter) {
  arScorePlacements(placements);
  const plcName = (p) => ((p.name || p.url || "").replace(/^Mobile App:\s*/i, "").replace(/\s*\((iTunes App Store|Google Play)\).*$/i, "").trim() || p.url || "—");
  const fmtD = (d) => d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—";
  const g = "grid-template-columns:80px 1fr 46px 56px 50px 64px 46px 52px 62px 66px 92px 34px 108px 88px 96px 34px;";
  // Durée de diffusion : du début à la dernière activité (ou à aujourd'hui si l'emplacement est en cours).
  const dur = (p) => {
    if (!p.firstDate) return "—";
    const end = p.ongoing ? new Date().toISOString().slice(0, 10) : (p.lastDate || p.firstDate);
    const days = Math.max(1, Math.round((new Date(end) - new Date(p.firstDate)) / 86400000) + 1);
    return days < 14 ? days + " j" : days < 70 ? Math.round(days / 7) + " sem" : Math.round(days / 30) + " mois";
  };
  const cpc = (p) => p.clicks ? siEurNum(p.cost / p.clicks) + " €" : "—";        // coût par clic
  const cpm = (p) => p.impressions ? siEurNum(p.cost / p.impressions * 1000) + " €" : "—"; // coût / 1000 impressions
  // Efficacité (tier + score) et tendance (recommandation) — calculés par arScorePlacements → p._eff.
  const SHORT_TIER = { "Volume insuffisant": "Vol. faible" };
  const MORE = "Clique pour la fiche complète";
  const tipAttr = (txt) => `data-tip="${escapeHtml(txt)}" data-tip-more="${MORE}"`;
  const effHtml = (p) => { const e = p._eff; if (!e) return "—"; const lbl = SHORT_TIER[e.tier] || e.tier; return `<span class="ar-eff act ${e.tc}" ${tipAttr(e.effTip)} data-plc-det="${p._i}">${escapeHtml(lbl)}${e.tc !== "na" ? " " + e.score : ""}</span>`; };
  const trendHtml = (p) => { const e = p._eff; if (!e) return "—"; return `<span class="ar-eff act ${e.trc}" ${tipAttr(e.trendTip)} data-plc-det="${p._i}">${escapeHtml(e.trend)}</span>`; };
  // Éval. Google (lecture CPC naïve) + flèche-loupe de divergence entre les deux lectures.
  const googHtml = (p) => { const gg = p._goog; if (!gg) return "—"; return `<span class="ar-eff act ${gg.gc}" ${tipAttr(gg.tip)} data-plc-det="${p._i}">${escapeHtml(gg.label)}</span>`; };
  const REAL_RANK = { "Efficace": 4, "Correct": 3, "Faible": 2, "À exclure": 1, "Volume insuffisant": 0 };
  const divHtml = (p) => {
    const e = p._eff, gg = p._goog; if (!e || !gg) return `<span class="ar-div dim">→</span>`;
    if (gg.rank >= 2 && (e.tier === "À exclure" || e.tier === "Faible")) {
      const cls = e.tier === "À exclure" ? "lo" : "warn";
      return `<span class="ar-div act ${cls}" ${tipAttr(`Google surévalue cet emplacement : côté CPC les clics sont « ${gg.label.toLowerCase()} », mais l'efficacité réelle est « ${e.tier} ». Se fier au seul CPC ferait maintenir une dépense peu utile.`)} data-plc-det="${p._i}">⚠→</span>`;
    }
    if (gg.rank === 1 && (e.tier === "Correct" || e.tier === "Efficace")) {
      return `<span class="ar-div act hi" ${tipAttr(`Google sous-évalue cet emplacement : CPC élevé mais efficacité réelle « ${e.tier} » (bonne portée / conversions). Se fier au seul CPC ferait couper un bon emplacement.`)} data-plc-det="${p._i}">✓→</span>`;
    }
    return `<span class="ar-div act dim" ${tipAttr("Les deux lectures concordent sur cet emplacement.")} data-plc-det="${p._i}">→</span>`;
  };
  // Actions réelles (exclure / réactiver) — écrivent dans le compte Google Ads, avec confirmation.
  placements.forEach((p, i) => { p._i = i; });
  const EXCLUDABLE = ["WEBSITE", "MOBILE_APPLICATION", "YOUTUBE_VIDEO", "YOUTUBE_CHANNEL"];
  const exKey = (p) => `${p.campaignId}|${p.type}|${p.placement}`;
  const mgKey = (p) => `${p.adGroupId}|${p.type}|${p.placement}`;
  let exclMap = {}, exclLoaded = false, managedMap = {}, managedLoaded = false;
  const isGoodStopped = (p) => !p.ongoing && ["Efficace", "Correct"].includes((p._eff && p._eff.tier));
  const actHtml = (p) => {
    if (!p.campaignId || !p.placement || !EXCLUDABLE.includes(p.type)) return `<span class="ar-plc-act-na" data-tip="Emplacement non exclusible individuellement.">—</span>`;
    if (!exclLoaded || !managedLoaded) return `<span class="ar-plc-act-na">…</span>`;
    // Déjà relancé (ciblage explicite) → annuler la relance.
    if (managedMap[mgKey(p)]) return `<button class="ar-plc-act relaunch" data-plc-act="untarget" data-plc-i="${p._i}" data-tip="Tu as relancé cet emplacement (ciblage explicite). Cliquer pour annuler la relance et revenir au ciblage automatique.">Relancé ✓</button>`;
    // Exclu par toi → réactiver.
    if (exclMap[exKey(p)]) return `<button class="ar-plc-act on" data-plc-act="reactivate" data-plc-i="${p._i}" data-tip="Tu as exclu cet emplacement — il ne diffuse plus. Cliquer pour le réactiver dans Google Ads.">Réactiver</button>`;
    // Bon mais arrêté → proposer la relance (ciblage explicite).
    if (isGoodStopped(p) && p.adGroupId) return `<button class="ar-plc-act relaunch" data-plc-act="target" data-plc-i="${p._i}" data-tip="Emplacement efficace que Google a arrêté. Le relancer le repasse en ciblage explicite pour inciter Google à le rediffuser (coup de pouce, pas une garantie). Écrit dans Google Ads, après confirmation.">Relancer</button>`;
    // Sinon exclure — discret (ghost) si déjà inactif (exclusion seulement préventive).
    const inactive = !p.ongoing;
    return `<button class="ar-plc-act${inactive ? " ghost" : ""}" data-plc-act="exclude" data-plc-i="${p._i}" data-tip="${inactive ? `Déjà inactif${p.daysSinceLast != null ? " depuis " + p.daysSinceLast + " j" : ""} — Google a cessé d'y diffuser tout seul (l'emplacement n'est pas exclu). L'exclure ne sert qu'à empêcher une reprise future.` : "Exclure cet emplacement de la campagne. Écrit dans le compte Google Ads, après confirmation."}">Exclure</button>`;
  };
  const typeOf = (p) => p.typeLabel || "Autre";
  // Types distincts (+ compte), triés par nombre décroissant — pour le filtre.
  const typeMap = {};
  for (const p of placements) { const t = typeOf(p); (typeMap[t] = typeMap[t] || { n: 0, cost: 0 }); typeMap[t].n++; typeMap[t].cost += (p.cost || 0); }
  const types = Object.entries(typeMap).sort((a, b) => b[1].n - a[1].n);
  let filter = "all";
  const tierOf = (p) => (p._eff && p._eff.tier) || "Volume insuffisant";
  // Filtres « intelligents » (croisent efficacité × statut) en plus des paliers simples.
  const SMART_FILTERS = { __goodstopped__: { label: "Bons mais arrêtés", pred: (p) => !p.ongoing && ["Efficace", "Correct"].includes(tierOf(p)) } };
  const effLabel = (k) => (SMART_FILTERS[k] && SMART_FILTERS[k].label) || k;
  let effFilter = initialEffFilter || null; // filtre par palier d'efficacité OU filtre intelligent
  // ── Tri par colonne (clic en-tête : ↓ décroissant → ↑ croissant → défaut) ──
  const todayIso = new Date().toISOString().slice(0, 10);
  const durDays = (p) => { if (!p.firstDate) return null; const end = p.ongoing ? todayIso : (p.lastDate || p.firstDate); return Math.round((new Date(end) - new Date(p.firstDate)) / 86400000) + 1; };
  const TREND_RANK = { "Continuer": 4, "Surveiller": 3, "Arrêter": 2, "Terminé": 1 };
  const SORT_VAL = {
    type: (p) => typeOf(p), name: (p) => plcName(p).toLowerCase(),
    start: (p) => p.firstDate || null, end: (p) => p.ongoing ? "9999-99-99" : (p.lastDate || null),
    dur: durDays, impr: (p) => p.impressions, clicks: (p) => p.clicks,
    cpc: (p) => p.clicks ? p.cost / p.clicks : null, cpm: (p) => p.impressions ? p.cost / p.impressions * 1000 : null,
    cost: (p) => p.cost, goog: (p) => p._goog ? p._goog.rank : null,
    eff: (p) => p._eff ? p._eff.score : null, trend: (p) => p._eff ? (TREND_RANK[p._eff.trend] || 0) : null,
  };
  let sortCol = "cost", sortDir = "desc"; // défaut = coût décroissant (l'ordre livré par Google)
  const isDefaultSort = () => sortCol === "cost" && sortDir === "desc";
  const applySort = (arr) => {
    const f = SORT_VAL[sortCol]; if (!f) return arr;
    const dir = sortDir === "desc" ? -1 : 1;
    return arr.slice().sort((a, b) => {
      const va = f(a), vb = f(b);
      if (va == null && vb == null) return b.cost - a.cost;
      if (va == null) return 1; if (vb == null) return -1;         // valeurs manquantes toujours en bas
      let r = typeof va === "string" ? va.localeCompare(vb, "fr") : (va - vb);
      if (r === 0) return b.cost - a.cost;                          // départage stable par coût
      return dir * r;
    });
  };
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  // Hauteur des lignes : s'adapte à l'écran (la modale doit remplir la fenêtre, pas un carré fixe).
  const ROWS_H = Math.max(560, Math.min(1100, window.innerHeight - 300));
  ov.innerHTML = `<div class="modal-panel" style="width:1680px;max-width:97vw;">
    <div class="modal-head"><h2 style="font-size:15px;">Emplacements — ${escapeHtml(campName)} <span id="arPlcCount" style="color:var(--dim);font-weight:400;"></span></h2><button class="modal-x" data-x>✕</button></div>
    <div class="modal-body">
      ${arPlacementsSummaryHtml(placements)}
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
        <div class="ar-seg" id="arPlcFilter" style="flex-wrap:wrap;margin:0;">
          <button class="ar-seg-b on" data-plctype="all">Tous <span style="opacity:.55;">${placements.length}</span></button>
          ${types.map(([t, m]) => `<button class="ar-seg-b" data-plctype="${escapeHtml(t)}">${escapeHtml(t)} <span style="opacity:.55;">${m.n}</span></button>`).join("")}
        </div>
        <span class="ar-eff-chip" id="arEffChip" style="display:none;"></span>
        <button class="ar-sort-reset" id="arSortReset" style="margin-left:auto;display:none;" data-tip="Revenir au tri par défaut (coût décroissant)">↺ Réinitialiser le tri</button>
      </div>
      <div class="ar-adskw-head" id="arPlcHead" style="${g}"><span class="k s" data-sort="type" data-tip="Trier par type d'emplacement">Type<i class="ar-sar"></i></span><span class="k s" data-sort="name" data-tip="Trier par nom d'emplacement">Emplacement<i class="ar-sar"></i></span><span class="c s" data-sort="start" data-tip="Trier par date de début">Début<i class="ar-sar"></i></span><span class="c s" data-sort="end" data-tip="Trier par date de fin (en cours en tête)">Fin<i class="ar-sar"></i></span><span class="c s" data-sort="dur" data-tip="Trier par durée de diffusion">Durée<i class="ar-sar"></i></span><span class="c s" data-sort="impr" data-tip="Trier par impressions">Impr.<i class="ar-sar"></i></span><span class="c s" data-sort="clicks" data-tip="Trier par clics">Clics<i class="ar-sar"></i></span><span class="c s" data-sort="cpc" data-tip="Trier par coût par clic">CPC<i class="ar-sar"></i></span><span class="c s" data-sort="cpm" data-tip="Trier par CPM — coût pour 1000 impressions, le vrai prix de la portée.">CPM<i class="ar-sar"></i></span><span class="c s" data-sort="cost" data-tip="Trier par coût total">Coût<i class="ar-sar"></i></span><span class="c s" data-sort="goog" data-tip="Trier par éval. Google (lecture CPC — trompeuse prise seule).">Éval. Google<i class="ar-sar"></i></span><span class="c ar-eff-loupe" id="arEffLoupe" data-tip="Pourquoi l'efficacité réelle prime sur le CPC" data-tip-more="Clique pour l'explication et les études">🔎</span><span class="c s" data-sort="eff" data-tip="Trier par efficacité réelle (score calculé).">Efficacité réelle<i class="ar-sar"></i></span><span class="c s" data-sort="trend" data-tip="Trier par tendance (Continuer → Terminé).">Tendance<i class="ar-sar"></i></span><span class="c" data-tip="Exclure / réactiver l'emplacement directement dans le compte Google Ads.">Actions</span><span class="c" data-tip="Surveiller : épingle l'emplacement en haut de la liste (favori).">★</span></div>
      <div id="arPlcRows" style="height:${ROWS_H}px;overflow-y:auto;"></div>
    </div></div>`;
  document.body.appendChild(ov);
  const rowsHost = ov.querySelector("#arPlcRows"), countEl = ov.querySelector("#arPlcCount");
  // ── Surveillance (favoris) : épingle des emplacements en haut, persistant via localStorage ──
  const WKEY = "arWatch:" + campName;
  const watchKey = (p) => p.placement || p.url || p.name || String(p._i);
  let watched; try { watched = new Set(JSON.parse(localStorage.getItem(WKEY) || "[]")); } catch { watched = new Set(); }
  const saveWatch = () => { try { localStorage.setItem(WKEY, JSON.stringify([...watched])); } catch {} };
  const isWatched = (p) => watched.has(watchKey(p));
  const watchHtml = (p) => `<span class="ar-watch${isWatched(p) ? " on" : ""}" data-plc-watch="${p._i}" data-tip="${isWatched(p) ? "Ne plus surveiller" : "Surveiller — épingle la ligne en haut de la liste"}">${isWatched(p) ? "★" : "☆"}</span>`;
  // Modèle d'une ligne (réutilisé par la liste ET la section épinglée).
  const rowHtml = (p) => `<div class="ar-adskw-row${exclLoaded && exclMap[exKey(p)] ? " ar-plc-excluded" : ""}${managedLoaded && managedMap[mgKey(p)] ? " ar-plc-relaunched" : ""}${isWatched(p) ? " ar-watched" : ""}" style="${g}"><span class="m">${escapeHtml(typeOf(p))}</span><span class="k">${escapeHtml(plcName(p))}</span><span class="c">${fmtD(p.firstDate)}</span><span class="c">${p.ongoing ? `<span class="ar-plc-st on">en cours</span>` : fmtD(p.lastDate)}</span><span class="c">${dur(p)}</span><span class="c">${pgFmtN(p.impressions)}</span><span class="c">${pgFmtN(p.clicks)}</span><span class="c">${cpc(p)}</span><span class="c">${cpm(p)}</span><span class="c">${p.cost ? siEurNum(p.cost) + " €" : "—"}</span><span class="c">${googHtml(p)}</span><span class="c">${divHtml(p)}</span><span class="c">${effHtml(p)}</span><span class="c">${trendHtml(p)}</span><span class="c">${actHtml(p)}</span><span class="c">${watchHtml(p)}</span></div>`;
  const render = () => {
    let base = filter === "all" ? placements : placements.filter((p) => typeOf(p) === filter);
    if (effFilter) { const sf = SMART_FILTERS[effFilter]; base = base.filter(sf ? sf.pred : (p) => tierOf(p) === effFilter); }
    const rows = applySort(base);
    const total = rows.reduce((n, p) => n + (p.cost || 0), 0);
    countEl.textContent = `(${rows.length} · ${siEurNum(total)} €)`;
    // Section épinglée « Surveillés » — tous les favoris (indépendamment du filtre), collée en haut.
    const pins = watched.size ? applySort(placements.filter(isWatched)) : [];
    let html = "";
    if (pins.length) html += `<div class="ar-watch-pin"><div class="ar-watch-h">★ Surveillés <span>${pins.length}</span></div>${pins.map(rowHtml).join("")}</div>`;
    html += rows.map(rowHtml).join("") || `<div class="ga-note" style="padding:12px 2px;">Aucun emplacement de ce type.</div>`;
    // Hauteur constante : on complète avec des lignes vides (mêmes bordures) jusqu'à remplir la zone.
    const ROW_H = 33; // hauteur d'une ligne (padding 6px ×2 + contenu + bordure)
    const fillers = Math.max(0, Math.ceil(ROWS_H / ROW_H) - rows.length - pins.length - (pins.length ? 1 : 0));
    for (let i = 0; i < fillers; i++) html += `<div class="ar-adskw-row ar-plc-empty" style="${g}">${"<span></span>".repeat(16)}</div>`;
    rowsHost.innerHTML = html;
  };
  ov.querySelectorAll("[data-plctype]").forEach((bt) => bt.onclick = () => { filter = bt.dataset.plctype; ov.querySelectorAll("[data-plctype]").forEach((x) => x.classList.toggle("on", x === bt)); render(); });
  // ── Tri : en-têtes cliquables + bouton de réinitialisation ──
  const head = ov.querySelector("#arPlcHead"), resetBtn = ov.querySelector("#arSortReset");
  const paintSort = () => {
    head.querySelectorAll("[data-sort]").forEach((el) => {
      const on = el.dataset.sort === sortCol;
      el.classList.toggle("sorted", on);
      const ar = el.querySelector(".ar-sar"); if (ar) ar.textContent = on ? (sortDir === "desc" ? "↓" : "↑") : "↕";
    });
    resetBtn.style.display = isDefaultSort() ? "none" : "";
  };
  head.addEventListener("click", (e) => {
    const el = e.target.closest("[data-sort]"); if (!el) return;
    const col = el.dataset.sort;
    if (sortCol === col) { if (sortDir === "desc") sortDir = "asc"; else { sortCol = "cost"; sortDir = "desc"; } } // 3e clic = défaut
    else { sortCol = col; sortDir = "desc"; }
    paintSort(); render();
  });
  resetBtn.onclick = () => { sortCol = "cost"; sortDir = "desc"; paintSort(); render(); };
  paintSort();
  // ── Filtre par palier d'efficacité : clic sur un segment/légende de la barre de synthèse ──
  const effChip = ov.querySelector("#arEffChip"), summary = ov.querySelector(".ar-plcsum");
  const paintEffFilter = () => {
    if (effFilter) { effChip.style.display = ""; effChip.innerHTML = `${SMART_FILTERS[effFilter] ? "" : "Efficacité : "}<b>${escapeHtml(effLabel(effFilter))}</b> <span class="ar-eff-chip-x" data-tip="Retirer le filtre">✕</span>`; }
    else effChip.style.display = "none";
    if (summary) summary.querySelectorAll("[data-eff-tier]").forEach((el) => el.classList.toggle("sel", el.dataset.effTier === effFilter));
  };
  if (summary) summary.addEventListener("click", (e) => {
    const el = e.target.closest("[data-eff-tier]"); if (!el) return;
    effFilter = (effFilter === el.dataset.effTier) ? null : el.dataset.effTier; // bascule
    paintEffFilter(); render();
  });
  effChip.addEventListener("click", () => { effFilter = null; paintEffFilter(); render(); });
  paintEffFilter();
  arTipInit();
  const loupe = ov.querySelector("#arEffLoupe"); if (loupe) loupe.onclick = arEffExplainerModal;
  // Clic sur une pastille (Éval. Google / divergence / Efficacité / Tendance) → fiche détaillée.
  rowsHost.addEventListener("click", (e) => {
    const el = e.target.closest("[data-plc-det]"); if (!el) return;
    const p = placements[+el.dataset.plcDet]; if (p) arPlacementDetailModal(p, campName);
  });
  // Clic sur l'étoile → surveiller / ne plus surveiller (épingle en haut, persistant).
  rowsHost.addEventListener("click", (e) => {
    const el = e.target.closest("[data-plc-watch]"); if (!el) return;
    const p = placements[+el.dataset.plcWatch]; if (!p) return;
    const k = watchKey(p); if (watched.has(k)) watched.delete(k); else watched.add(k);
    saveWatch(); render();
  });
  render();
  // État exclusions + emplacements gérés (lecture seule) → reflète l'état des boutons.
  if (arBrand) {
    window.olympus.argosAdsExclusions(arBrand).then((r) => { exclLoaded = true; if (r && r.ok) exclMap = r.exclusions || {}; render(); }).catch(() => { exclLoaded = true; render(); });
    window.olympus.argosAdsManaged(arBrand).then((r) => { managedLoaded = true; if (r && r.ok) managedMap = r.managed || {}; render(); }).catch(() => { managedLoaded = true; render(); });
  } else { exclLoaded = true; managedLoaded = true; }
  // Exclure / réactiver / relancer / annuler la relance (ÉCRITURE réelle Google Ads) — confirmation obligatoire.
  const ACT_MSG = {
    exclude: { msg: (nm) => `Exclure « ${nm} » de la campagne « ${campName} » ?\n\nCet emplacement ne diffusera plus dans le compte Google Ads du client. Action réversible (Réactiver) — l'historique de performance reste conservé par Google.`, ok: "Exclure", danger: true },
    reactivate: { msg: (nm) => `Réactiver « ${nm} » ?\n\nL'emplacement pourra de nouveau diffuser dans le compte Google Ads du client.`, ok: "Réactiver", danger: false },
    target: { msg: (nm) => `Relancer « ${nm} » ?\n\nCet emplacement efficace sera repassé en ciblage explicite (emplacement géré) pour inciter Google à le rediffuser.\n\n⚠️ C'est un coup de pouce, pas une garantie (dépend du budget, des enchères et de l'inventaire), et cela peut influencer le ciblage de tout le groupe d'annonces. Réversible. Écrit dans le compte Google Ads.`, ok: "Relancer", danger: false },
    untarget: { msg: (nm) => `Annuler la relance de « ${nm} » ?\n\nL'emplacement repasse en ciblage automatique.`, ok: "Annuler la relance", danger: false },
  };
  rowsHost.addEventListener("click", async (e) => {
    const bt = e.target.closest("[data-plc-act]"); if (!bt) return;
    const p = placements[+bt.dataset.plcI]; if (!p) return;
    const action = bt.dataset.plcAct, nm = plcName(p), cfg = ACT_MSG[action]; if (!cfg) return;
    if (!(await arConfirm(cfg.msg(nm), cfg.ok, cfg.danger))) return;
    bt.disabled = true; bt.textContent = "…";
    const ek = exKey(p), mk = mgKey(p);
    const spec = action === "exclude" ? { campaignId: p.campaignId, type: p.type, placement: p.placement, url: p.url }
      : action === "reactivate" ? { resourceName: (exclMap[ek] || {}).resourceName }
      : action === "target" ? { adGroupId: p.adGroupId, type: p.type, placement: p.placement, url: p.url }
      : { resourceName: (managedMap[mk] || {}).resourceName };
    const r = await window.olympus.argosAdsPlacementAction(arBrand, action, spec).catch((err) => ({ ok: false, error: String(err && err.message || err) }));
    if (!r || !r.ok) {
      bt.disabled = false; render();
      const pending = /DEVELOPER_TOKEN_NOT_APPROVED|not approved|explorer access|PERMISSION_DENIED|USER_PERMISSION_DENIED/i.test((r && r.error) || "");
      arNotice(pending
        ? "Écriture Google Ads en attente d'autorisation.\n\nPour modifier le compte, ton jeton développeur Google Ads doit être en accès Basic — la même autorisation que pour la vue Tendance. Une fois accordée, ce bouton fonctionnera sans rien changer d'autre."
        : "L'action a échoué : " + ((r && r.error) || "erreur inconnue") + ".");
      return;
    }
    if (action === "exclude") exclMap[ek] = { resourceName: r.resourceName, campaignId: p.campaignId, type: p.type, value: p.placement };
    else if (action === "reactivate") delete exclMap[ek];
    else if (action === "target") managedMap[mk] = { resourceName: r.resourceName, adGroupId: p.adGroupId, type: p.type, value: p.placement };
    else delete managedMap[mk];
    render();
  });
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  mArrive(ov.querySelector(".modal-body"));
}
// ── Infobulle instantanée (remplace title=, qui met ~1 s à apparaître) ──
// Apparition immédiate + animation d'entrée. Contenu injecté en textContent (jamais en HTML).
let arTipEl = null, arTipCur = null;
function arTipInit() {
  if (arTipEl) return;
  arTipEl = document.createElement("div"); arTipEl.className = "ar-tip"; document.body.appendChild(arTipEl);
  const hide = () => { arTipEl.classList.remove("show"); arTipCur = null; };
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (!t) { if (arTipCur) hide(); return; }
    if (t === arTipCur) return;
    arTipCur = t;
    arTipEl.textContent = t.dataset.tip || "";
    if (t.dataset.tipMore) { const s = document.createElement("span"); s.className = "ar-tip-more"; s.textContent = t.dataset.tipMore; arTipEl.appendChild(s); }
    arTipEl.classList.add("show");
    const r = t.getBoundingClientRect(), tw = arTipEl.offsetWidth, th = arTipEl.offsetHeight;
    let left = Math.max(10, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 10));
    let top = r.top - th - 9, below = false;
    if (top < 10) { top = r.bottom + 9; below = true; }
    arTipEl.style.left = left + "px"; arTipEl.style.top = top + "px";
    arTipEl.classList.toggle("below", below);
  }, true);
  document.addEventListener("mouseout", (e) => { const t = e.target.closest && e.target.closest("[data-tip]"); if (t && t === arTipCur) hide(); }, true);
  window.addEventListener("scroll", () => { if (arTipCur) { arTipEl.classList.remove("show"); arTipCur = null; } }, true);
}
// ── Études sur lesquelles s'appuie le score (vérifiées : source primaire, année, nature) ──
const AR_STUDIES = [
  { t: "ANA — Programmatic Media Supply Chain Transparency", y: "2023, actualisé 2024 et T2 2025", k: "Étude sectorielle · Association of National Advertisers",
    w: "Sur 123 M$ d'achat programmatique réellement audités, les sites « Made For Advertising » captaient 21 % des impressions et 15 % du budget, et seuls ~36 centimes par dollar entrant dans un DSP atteignaient l'internaute. Le benchmark T2 2025 chiffre encore 26,8 Md$ de dépense programmatique gaspillée par an.",
    u: "https://www.ana.net/content/show/id/pr-2025-08-programmatictrans" },
  { t: "Pixalate — Global Ad Fraud Benchmarks", y: "T3 2025", k: "Mesure accréditée MRC",
    w: "Sur 106 milliards d'impressions programmatiques mesurées : 33 % de trafic invalide sur l'inventaire mobile in-app, 21 % sur le web, 19 % sur la TV connectée. C'est la donnée qui justifie de se méfier d'un CTR élevé sur une application.",
    u: "https://www.pixalate.com/blog/q3-2025-global-ad-fraud-benchmarks-report" },
  { t: "Blake, Nosko & Tadelis — « Consumer Heterogeneity and Paid Search Effectiveness »", y: "Econometrica, 2015", k: "Académique · revue à comité de lecture",
    w: "Expérience à grande échelle chez eBay : les annonces sur requêtes de marque n'apportent aucun bénéfice mesurable (le trafic se reporte simplement sur l'organique) et le rendement moyen est négatif sur les utilisateurs déjà fréquents. L'impact causal réel peut être un ordre de grandeur sous ce que l'attribution laisse croire.",
    u: "https://www.nber.org/papers/w20171" },
  { t: "Lewis & Rao — « The Unfavorable Economics of Measuring the Returns to Advertising »", y: "Quarterly Journal of Economics, 2015", k: "Académique · revue à comité de lecture",
    w: "25 expériences terrain sur des millions d'utilisateurs : l'intervalle de confiance médian du ROI publicitaire dépasse 100 points de pourcentage. Les ventes individuelles sont si volatiles face au coût par personne qu'un clic isolé ne prouve à peu près rien.",
    u: "https://gwern.net/doc/economics/advertising/2015-lewis.pdf" },
  { t: "Tolomei, Lalmas, Farahat & Haines (Yahoo) — identification des clics accidentels", y: "Information Retrieval Journal, 2018", k: "Académique",
    w: "Sur des dizaines de millions de clics publicitaires mobiles, ceux dont le temps passé est inférieur à ~2 secondes sont identifiés comme accidentels ; en les excluant de l'apprentissage, le CTR des annonces progresse de 3,9 %. Confirme le mécanisme — les auteurs ne publient volontairement pas la part exacte de clics accidentels.",
    u: "https://arxiv.org/abs/1804.06912" },
  { t: "IAS — Media Quality Report, 21ᵉ édition", y: "2026, données 2025", k: "Mesure sectorielle",
    w: "Sur plus de 300 milliards d'interactions quotidiennes : 67,9 % de visibilité moyenne en display, 79,7 % en vidéo. Près d'une impression display sur trois n'est donc jamais réellement vue — facturée, mais sans portée.",
    u: "https://integralads.com/apac/insider/ias-media-quality-report-21st-edition/" },
  { t: "Efron & Morris — estimation de Stein, approche bayésienne empirique", y: "JASA, 1973", k: "Académique · fondateur",
    w: "Fondement du « shrinkage » : quand on estime plusieurs taux en parallèle, ramener chaque estimation vers la moyenne du groupe bat systématiquement l'estimation brute dès 3 éléments. C'est ce qui empêche un emplacement à 50 impressions d'être jugé sur son taux brut.",
    u: "https://www.tandfonline.com/doi/abs/10.1080/01621459.1973.10481350" },
  { t: "Agarwal et al. (Yahoo) — « Estimating Rates of Rare Events at Multiple Resolutions »", y: "KDD, 2007", k: "Académique",
    w: "Application directe du shrinkage à la publicité en ligne : les taux stables mesurés au niveau agrégé (ici la campagne) servent d'a priori pour estimer les taux au niveau fin (ici chaque emplacement).",
    u: "https://dl.acm.org/doi/10.1145/1281192.1281198" },
  { t: "Wilson (1927) · Brown, Cai & DasGupta (2001) · Evan Miller (2009)", y: "1927 / 2001 / 2009", k: "Académique + référence praticienne",
    w: "L'intervalle de score de Wilson donne une borne basse fiable pour un taux observé sur peu d'événements ; Brown, Cai & DasGupta établissent sa supériorité sur l'intervalle naïf et Evan Miller l'a popularisé pour classer par qualité. C'est la borne utilisée ici avant de qualifier un CTR d'anormal.",
    u: "https://www.evanmiller.org/how-not-to-sort-by-average-rating.html" },
];
function arStudiesHtml() {
  return `<div class="ar-studies">${AR_STUDIES.map((s) => `<div class="ar-study">
    <div class="ar-study-t">${escapeHtml(s.t)}</div>
    <div class="ar-study-m"><span class="ar-study-y">${escapeHtml(s.y)}</span><span class="ar-study-k">${escapeHtml(s.k)}</span></div>
    <p>${escapeHtml(s.w)}</p>
    <a href="${escapeHtml(s.u)}" target="_blank" rel="noreferrer">${escapeHtml(s.u.replace(/^https?:\/\//, "").slice(0, 62))}</a>
  </div>`).join("")}</div>`;
}
// ── Fiche détaillée d'un emplacement (au clic sur une des pastilles) ──
function arPlacementDetailModal(p, campName) {
  const e = p._eff || {}, d = e.detail || {}, gg = p._goog || {};
  const eur = (v) => v == null ? "—" : siEurNum(v) + " €";
  const pcv = (v, n = 2) => v == null ? "—" : (v * 100).toFixed(n).replace(".", ",") + " %";
  const x = (v, n = 2) => v == null ? "—" : "×" + v.toFixed(n).replace(".", ",");
  const dP = (r) => r == null ? "—" : ((Math.round((r - 1) * 100) >= 0 ? "+" : "") + Math.round((r - 1) * 100) + " %");
  const nm = ((p.name || p.url || "").replace(/^Mobile App:\s*/i, "").replace(/\s*\((iTunes App Store|Google Play)\).*$/i, "").trim() || p.url || "—");
  const kpi = (l, v, sub) => `<div class="ar-dt-kpi"><span class="ar-dt-kl">${l}</span><span class="ar-dt-kv">${v}</span>${sub ? `<span class="ar-dt-ks">${sub}</span>` : ""}</div>`;
  const wCost = d.useConv ? 0.25 : 0.65, wEng = d.useConv ? 0.15 : 0.35;
  const bar = (label, val, weight, tip) => `<div class="ar-dt-comp" data-tip="${escapeHtml(tip)}"><span class="ar-dt-cl">${label} <b>${Math.round(weight * 100)} %</b></span><span class="ar-dt-cbar"><span style="width:${Math.max(0, Math.min(100, val))}%"></span></span><span class="ar-dt-cv">${Math.round(val)}</span></div>`;
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  ov.innerHTML = `<div class="modal-panel" style="width:820px;max-width:95vw;">
    <div class="modal-head"><h2 style="font-size:15px;">${escapeHtml(nm)} <span style="color:var(--dim);font-weight:400;">· ${escapeHtml(p.typeLabel || "")}</span></h2><button class="modal-x" data-x>✕</button></div>
    <div class="modal-body ar-dt">
      <div class="ar-dt-verdicts">
        <div class="ar-dt-vd"><span class="ar-dt-vl">Éval. Google (CPC)</span><span class="ar-eff ${gg.gc || "na"}">${escapeHtml(gg.label || "—")}</span></div>
        <div class="ar-dt-arrow">${gg.rank >= 2 && (e.tier === "À exclure" || e.tier === "Faible") ? "⚠→" : "→"}</div>
        <div class="ar-dt-vd"><span class="ar-dt-vl">Efficacité réelle</span><span class="ar-eff ${e.tc || "na"}">${escapeHtml(e.tier || "—")}${e.tc !== "na" && e.score != null ? " " + e.score : ""}</span></div>
        <div class="ar-dt-vd"><span class="ar-dt-vl">Tendance</span><span class="ar-eff ${e.trc || "na"}">${escapeHtml(e.trend || "—")}</span></div>
      </div>
      <div class="ar-dt-kpis">
        ${kpi("Impressions", pgFmtN(p.impressions))}${kpi("Clics", pgFmtN(p.clicks))}${kpi("CTR", pcv(d.ph))}
        ${kpi("CPC", eur(d.cpc), "médiane " + eur(d.medCPC))}${kpi("CPM", eur(d.cpm), "médiane " + eur(d.medCPM))}
        ${d.useV ? kpi("CPM visible", eur(d.vcpm), "médiane " + eur(d.medVCPM)) : ""}
        ${d.viewability != null ? kpi("Visibilité", pcv(d.viewability, 0), d.viewability < 0.7 ? "⚠ portée surfacturée" : "impressions vues") : ""}
        ${kpi("Coût", eur(p.cost), pcv(d.budgetShare, 1) + " du budget")}${kpi("Conversions", d.useConv ? String(p.conv || 0) : "non suivi")}
      </div>
      <div class="ar-dt-sec">
        <div class="ar-dt-h">Ce que dit le CPC — et pourquoi c'est insuffisant</div>
        <p>${escapeHtml(gg.tip || "—")}</p>
      </div>
      <div class="ar-dt-sec">
        <div class="ar-dt-h">Comment l'efficacité réelle est calculée</div>
        <p>${escapeHtml(e.effTip || "—")}</p>
        <div class="ar-dt-comps">
          ${bar("Coût de la portée", d.compCost || 0, wCost, d.useV
            ? `Compare le coût pour 1000 impressions RÉELLEMENT VUES (${eur(d.cpmHat)}) à la médiane de la campagne (${eur(d.medVCPM)}). Les impressions jamais vues sont exclues du calcul : un emplacement peu visible est donc correctement pénalisé, même si son CPM brut paraît bas.`
            : `Compare le CPM ajusté (${eur(d.cpmHat)}) à la médiane de la campagne (${eur(d.medCPM)}). Visibilité non mesurée sur cet emplacement.`)}
          ${bar("Engagement", d.compEng || 0, wEng, d.S > 0 ? "Neutralisé à 50 : le CTR est jugé suspect (clics probablement accidentels), il ne peut donc pas faire monter la note." : `Compare le CTR ajusté (${pcv(d.pHat)}) à la référence campagne (${pcv(d.p0)}).`)}
          ${d.useConv ? bar("Conversions", d.compConv || 0, 0.60, "Conversions rapportées à l'euro dépensé, ramenées vers la moyenne campagne quand le volume est faible.") : ""}
        </div>
        ${d.S > 0 ? `<div class="ar-dt-warn"><b>Pénalité clics accidentels appliquée.</b> Borne basse de Wilson du CTR : ${pcv(d.wLB)} — soit ${x(d.pHat / d.p0)} la référence campagne, alors que le seuil de suspicion sur ce type d'inventaire est ${x(d.T, 1)}. Aucune conversion enregistrée. La note est réduite de ${Math.round(65 * d.S)} %.</div>` : ""}
      </div>
      <div class="ar-dt-sec">
        <div class="ar-dt-h">Tendance — ${escapeHtml(e.trend || "—")}</div>
        <p>${escapeHtml(e.trendTip || "—")}</p>
        ${p.ongoing ? `<div class="ar-dt-deltas">
          <span>CPM <b>${dP(d.dCPM)}</b></span><span>CTR ajusté <b>${dP(d.dCTR)}</b></span><span>Coût <b>${dP(d.dCost)}</b></span>${d.dCPA != null ? `<span>CPA <b>${dP(d.dCPA)}</b></span>` : ""}
          <span class="ar-dt-win">${d.W || "?"} derniers jours vs ${d.W || "?"} précédents</span></div>` : ""}
      </div>
      <div class="ar-dt-sec">
        <div class="ar-dt-h">Les études sur lesquelles ce calcul s'appuie</div>
        ${arStudiesHtml()}
      </div>
    </div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (ev) => { if (ev.target === ov) close(); };
  const onKey = (ev) => { if (ev.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  mArrive(ov.querySelector(".modal-body"));
}
// Explication : pourquoi l'« efficacité réelle » prime sur le CPC (ouvert par la loupe de la modale).
function arEffExplainerModal() {
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  ov.innerHTML = `<div class="modal-panel" style="width:640px;max-width:94vw;">
    <div class="modal-head"><h2 style="font-size:15px;">Éval. Google vs Efficacité réelle</h2><button class="modal-x" data-x>✕</button></div>
    <div class="modal-body ar-effx">
      <p class="ar-effx-lead">Deux façons de juger un emplacement — et l'une des deux fait gaspiller du budget.</p>
      <div class="ar-effx-cols">
        <div class="ar-effx-card">
          <div class="ar-effx-h"><span class="ar-eff hi" style="pointer-events:none;">Éval. Google</span></div>
          <p>La lecture par défaut de Google Ads : <b>coût par clic (CPC)</b>. Un clic bon marché est présenté comme « bon ». C'est <b>trompeur</b> : le CPC ne dit rien de ce que vaut le clic.</p>
        </div>
        <div class="ar-effx-card">
          <div class="ar-effx-h"><span class="ar-eff mid" style="pointer-events:none;">Efficacité réelle</span></div>
          <p>Note calculée à partir de ce que les études récentes montrent de plus fiable : <b>coût de la portée utile</b> (CPM vs médiane campagne), <b>conversions</b>, et <b>détection des clics accidentels</b>.</p>
        </div>
      </div>
      <div class="ar-effx-risk">
        <div class="ar-effx-rt">Les risques à ne regarder que le CPC</div>
        <ul>
          <li><b>Les clics les moins chers sont souvent les pires.</b> Sur l'inventaire mobile in-app, Pixalate mesure <b>33 % de trafic invalide</b> (T3 2025) — le taux le plus élevé de tous les canaux. Des clics à 0,02 € qui ne viennent d'aucun humain intéressé restent affichés comme « bon marché ».</li>
          <li><b>Un CPC bas peut masquer 0 conversion.</b> Payer 0,02 € pour 3 000 clics qui ne mènent à aucune réservation, c'est 60 € évaporés — que le CPC note pourtant « excellent ». Lewis &amp; Rao ont montré que le rendement publicitaire réel est si bruité que l'intervalle de confiance médian du ROI dépasse 100 points.</li>
          <li><b>Le clic n'est pas le résultat.</b> Chez eBay, l'expérience de Blake, Nosko &amp; Tadelis (<i>Econometrica</i>) a montré que des annonces très cliquées n'apportaient <b>aucun bénéfice mesurable</b> : le trafic se reportait simplement depuis l'organique.</li>
          <li><b>Une part du budget part dans de l'inventaire fabriqué pour la pub.</b> L'audit de l'ANA a trouvé <b>21 % des impressions</b> et <b>15 % du budget</b> sur des sites « Made For Advertising », et seulement ~36 ¢ par euro atteignant réellement l'internaute.</li>
          <li><b>Un CPC élevé n'est pas forcément mauvais.</b> Un emplacement premium plus cher au clic peut convertir bien mieux : couper au seul CPC ferait perdre les meilleurs.</li>
        </ul>
      </div>
      <p class="ar-effx-foot">👉 La colonne <b>Efficacité réelle</b> et la flèche <b>⚠→</b> te signalent les emplacements que le CPC surévalue (clics pas chers mais inutiles) ou sous-évalue (chers mais rentables). <b>Clique n'importe quelle pastille</b> d'une ligne pour la fiche complète et le détail du calcul.</p>
      <div class="ar-effx-rt" style="color:var(--muted);margin:18px 0 8px;">Les études récentes derrière ce calcul</div>
      ${arStudiesHtml()}
      <p class="ar-effx-note">Note d'honnêteté : le chiffre « 50 à 60 % des clics in-app sont accidentels », très répandu dans le milieu, n'est <b>pas vérifiable</b> — la source primaire (GoldSpot, 2012) mesurait 38 % sur bannières statiques, et le « 60 % » provient d'un sondage déclaratif sur 500 personnes. Les travaux rigoureux récents (Yahoo 2018, Verizon Media 2021) confirment le phénomène mais ne publient pas de pourcentage. Ce calcul s'appuie donc sur des taux de trafic invalide <b>mesurés</b> plutôt que sur ce chiffre.</p>
    </div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  mArrive(ov.querySelector(".modal-body"));
}
// Confirmation légère (Promise<bool>) — utilisée avant toute écriture réelle sur le compte Google Ads.
function arConfirm(message, okLabel, danger) {
  return new Promise((resolve) => {
    const ov = document.createElement("div"); ov.className = "modal-overlay show";
    ov.innerHTML = `<div class="modal-panel" style="width:440px;max-width:92vw;">
      <div class="modal-body" style="padding:22px 22px 18px;">
        <p style="font-size:13px;line-height:1.55;white-space:pre-line;margin:0 0 18px;">${escapeHtml(message)}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn sec" data-no>Annuler</button>
          <button class="btn${danger ? " danger" : ""}" data-yes>${escapeHtml(okLabel || "Confirmer")}</button>
        </div>
      </div></div>`;
    document.body.appendChild(ov);
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector("[data-no]").onclick = () => done(false);
    ov.querySelector("[data-yes]").onclick = () => done(true);
    ov.onclick = (e) => { if (e.target === ov) done(false); };
  });
}
// Message d'information (un seul bouton OK).
function arNotice(message) {
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  ov.innerHTML = `<div class="modal-panel" style="width:460px;max-width:92vw;">
    <div class="modal-body" style="padding:22px;">
      <p style="font-size:13px;line-height:1.6;margin:0 0 16px;white-space:pre-line;">${escapeHtml(message)}</p>
      <div style="display:flex;justify-content:flex-end;"><button class="btn" data-ok>OK</button></div>
    </div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-ok]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
}
// Câble les boutons « Voir les N emplacements » d'un conteneur vers la modale (avec la liste complète).
function arWirePlcModals(box, plcByCamp) {
  box.querySelectorAll("[data-plc-modal]").forEach((bt) => bt.onclick = (e) => { e.preventDefault(); e.stopPropagation(); arPlacementsModal(bt.dataset.plcModal, plcByCamp[bt.dataset.plcModal] || []); });
  // Clic sur un segment/légende de la barre de synthèse d'une carte → ouvre la modale filtrée sur ce palier.
  box.querySelectorAll(".ar-plcsum[data-camp]").forEach((sum) => {
    const cn = sum.dataset.camp;
    sum.querySelectorAll("[data-eff-tier]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); arPlacementsModal(cn, plcByCamp[cn] || [], el.dataset.effTier); }));
  });
}
// Modale concurrent. Deux modes :
//  · défaut (cartes Publicité) : infos Maps + estimation SEA du domaine + avis.
//  · opts.reviewsOnly (vue Notoriété) : en-tête comparaison avec le client + AVIS uniquement.
function arCompetitorSeaModal(b, comp, opts) {
  opts = opts || {};
  const name = comp.name || "Concurrent", domain = (comp.domain || "").trim();
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  // En-tête comparaison concurrent ↔ client (note, avis, classement, distance).
  const cmpHead = () => {
    const me = opts.me || {};
    const total = opts.total || null; // nombre total d'établissements classés
    const fmtRating = (v) => v != null ? "★ " + String(v).replace(".", ",") : "—";
    const fmtRank = (v) => v != null ? (total ? v + "/" + total : "#" + v) : "—";
    const win = (a, bv, hi) => a == null || bv == null ? ["", ""] : (a === bv ? ["", ""] : (hi ? (a > bv ? ["win", ""] : ["", "win"]) : (a < bv ? ["win", ""] : ["", "win"])));
    const rateW = win(comp.rating, me.rating, true), revW = win(comp.reviews, me.reviews, true), rankW = win(comp.rank, me.rank, false);
    const row = (label, cv, mv, cls) => `<div class="ar-cmp-row"><span class="ar-cmp-l">${label}</span><span class="ar-cmp-v ${cls ? cls[0] : ""}">${cv}</span><span class="ar-cmp-v ${cls ? cls[1] : ""}">${mv}</span></div>`;
    return `<div class="ar-cmp">
        <div class="ar-cmp-row ar-cmp-h"><span class="ar-cmp-l"></span><span class="ar-cmp-v">${escapeHtml(name)}</span><span class="ar-cmp-v">${escapeHtml(me.name || "Ton établissement")}</span></div>
        ${row("Note Google", fmtRating(comp.rating), fmtRating(me.rating), rateW)}
        ${row("Avis", comp.reviews != null ? pgFmtN(comp.reviews) : "—", me.reviews != null ? pgFmtN(me.reviews) : "—", revW)}
        ${row(`Classement${opts.sortLabel ? ` (${opts.sortLabel})` : ""}`, fmtRank(comp.rank), fmtRank(me.rank), rankW)}
        ${row("Distance", comp.distance != null ? String(comp.distance).replace(".", ",") + " km" : "—", "0 km", null)}
      </div>`;
  };
  const mapsHead = `<div class="ga-cards" style="margin-bottom:14px;">
      ${pgScore("Note Google", comp.rating != null ? "★ " + String(comp.rating).replace(".", ",") : "—", "", comp.reviews != null ? pgFmtN(comp.reviews) + " avis" : "")}
      ${pgScore("Catégorie", comp.category || "—")}
      ${pgScore("Site web", domain || "aucun")}
    </div>`;
  const head = opts.reviewsOnly ? cmpHead() : mapsHead;
  const seaBlock = opts.reviewsOnly ? "" : `<div id="arCompSea"><div class="ga-note">${domain ? "Estimation SEA en cours… (analyse payante)" : "Pas de site web référencé pour ce commerce — impossible d'estimer son SEA."}</div></div>`;
  ov.innerHTML = `<div class="modal-panel" style="width:640px;max-width:94vw;"><div class="modal-head"><h2 style="font-size:15px;">${escapeHtml(name)}</h2><button class="modal-x" data-x>✕</button></div><div class="modal-body">${head}${seaBlock}<div id="arCompReviews">${comp.placeId ? `<div class="ar-rev-sep"></div><div class="ga-note"><span class="si-spin"></span> Récupération des avis Google (peut prendre ~30 s)…</div>` : `<div class="ar-rev-sep"></div><div class="ga-note">Avis indisponibles (établissement sans identifiant Google Maps).</div>`}</div></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  // Avis Google (10 meilleurs + 10 pires récents) — ne dépend que du place_id, pas du domaine.
  if (comp.placeId) {
    const rout = ov.querySelector("#arCompReviews");
    const revItem = (r) => `<div class="ar-rev"><div class="ar-rev-top"><span class="ar-rev-star ${r.rating >= 4 ? "hi" : (r.rating <= 2 ? "lo" : "mid")}">★ ${String(r.rating).replace(".", ",")}</span><span class="ar-rev-meta">${escapeHtml(r.author || "Anonyme")}${r.timeAgo ? ` · ${escapeHtml(r.timeAgo)}` : ""}</span></div>${r.text ? `<div class="ar-rev-txt">${escapeHtml(r.text)}</div>` : ""}</div>`;
    const sec = (title, arr) => arr.length ? `<div class="ar-adsaud-t">${title}</div>${arr.map(revItem).join("")}` : "";
    window.olympus.siPlaceReviews(b.id, comp.placeId).then((rr) => {
      if (!ov.isConnected || !rout) return;
      if (!rr?.ok || !rr.data) { rout.innerHTML = `<div class="ar-rev-sep"></div><div class="ga-note">${escapeHtml(rr?.error || "Avis indisponibles")}${rr?.budgetBlocked ? " — règle le budget dans Titan." : ""}</div>`; return; }
      const { best = [], worst = [], total } = rr.data;
      rout.innerHTML = `<div class="ar-rev-sep"></div><div class="ga-note" style="margin-bottom:10px;font-size:11px;">Avis Google récents${total ? ` · ${pgFmtN(total)} au total` : ""} — les mieux et les moins bien notés.</div>${sec("😊 Meilleurs avis récents", best)}${worst.length ? `<div style="height:12px;"></div>${sec("😠 Pires avis récents", worst)}` : ""}`;
      mArrive(rout);
    });
  }
  if (opts.reviewsOnly || !domain) { mArrive(ov.querySelector(".modal-body")); return; } // Notoriété = avis seuls, pas de SEA
  const out = ov.querySelector("#arCompSea");
  window.olympus.siCompetitorSea(b.id, domain).then((rr) => {
    if (!ov.isConnected) return;
    if (!rr?.ok) { out.innerHTML = `<div class="ga-note">${escapeHtml(rr?.error || "Échec")}${rr?.budgetBlocked ? " — règle le budget dans Titan." : ""}</div>`; return; }
    const d = rr.data || {}, paid = d.paid || {}, org = d.organic || {}, kws = d.keywords || [];
    const paidBlock = paid.count ? `<div class="ga-cards" style="margin-bottom:14px;">
        ${pgScore("Mots-clés payants", pgFmtN(paid.count))}
        ${pgScore("Budget estimé", "~" + pgFmtN(paid.value || 0) + " €", "", "par mois")}
        ${pgScore("Clics payants", "~" + pgFmtN(paid.etv || 0), "", "par mois")}
      </div>` : `<div class="ga-note" style="margin-bottom:12px;"><b>${escapeHtml(name)}</b> n'investit pas (ou très peu) en Google Ads — aucun mot-clé payant estimé.</div>`;
    const orgBlock = `<div class="ga-note" style="margin-bottom:12px;font-size:11.5px;">Visibilité organique estimée : <b>${org.count != null ? pgFmtN(org.count) : "—"}</b> mots-clés · ${org.etv != null ? "~" + pgFmtN(org.etv) + " visites/mois" : "—"}.</div>`;
    const g = "grid-template-columns:1fr 70px 56px 66px;";
    const kwBlock = kws.length ? `<div class="ar-adsaud-t">Ses mots-clés (top par trafic estimé)</div>
      <div class="ar-adskw-head" style="${g}"><span class="k">Mot-clé</span><span class="c">Volume</span><span class="c">Pos.</span><span class="c">CPC</span></div>
      ${kws.slice(0, 25).map((k) => `<div class="ar-adskw-row" style="${g}"><span class="k">${escapeHtml(k.keyword)}</span><span class="c">${k.volume != null ? pgFmtN(k.volume) : "—"}</span><span class="c">${k.position != null ? k.position + "ᵉ" : "—"}</span><span class="c">${k.cpc != null ? siEurNum(k.cpc) + " €" : "—"}</span></div>`).join("")}` : "";
    out.innerHTML = `<div class="ga-note" style="margin-bottom:10px;font-size:11px;">Estimations DataForSEO (crawl du marché) — pas les chiffres officiels du concurrent.</div>${paidBlock}${orgBlock}${kwBlock}`;
    mArrive(out);
  });
}
function arWireCompModals(box, b, opts) {
  box.querySelectorAll(".ar-comp-row").forEach((row) => row.onclick = (e) => { e.preventDefault(); e.stopPropagation(); arCompetitorSeaModal(b, { name: row.dataset.compName, domain: row.dataset.compDomain || "", rating: row.dataset.compRating ? +row.dataset.compRating : null, reviews: row.dataset.compReviews ? +row.dataset.compReviews : null, category: row.dataset.compCategory || null, placeId: row.dataset.compPlace || null, rank: row.dataset.compRank ? +row.dataset.compRank : null, distance: row.dataset.compDistance ? +row.dataset.compDistance : null }, opts || {}); });
}
// Monte les cartes campagne RICHES (mots-clés/position/marché, audiences, emplacements, géo, concurrents)
// dans `host`, pour la période arAdsPeriod. Partagé par Veille SEA et Publicité (Google).
// opts: { activeOnly, connected, mktBtn (élément), msgEl (élément) }.
function arMountRichCampaigns(host, b, opts) {
  opts = opts || {};
  let _adsData = null, _market = null, _competitors = null, _compMeta = null;
  const renderActive = () => {
    if (!host || !_adsData) return;
    const camps = _adsData.camps;
    let summary = "";
    if (opts.summary) {
      const tClicks = camps.reduce((n, c) => n + (c.clicks || 0), 0), tImpr = camps.reduce((n, c) => n + (c.impressions || 0), 0);
      summary = `<div class="ar-rich-sub">Vue d'ensemble · ${arAdsPeriodLabel()}</div>
        <div class="ga-cards" style="margin-bottom:22px;">
          ${pgScore("Campagnes", camps.length, "", arAdsPeriodLabel())}
          ${pgScore("Dépense", pgFmtN(Math.round(_adsData.totalSpend)) + " €", "", arAdsPeriodLabel())}
          ${pgScore("Clics", pgFmtN(tClicks))}
          ${pgScore("Impressions", pgFmtN(tImpr))}
        </div>
        <div class="ar-rich-sub">Détail par campagne · ${camps.length}</div>`;
    }
    host.innerHTML = summary + camps.map((c) => arAdsCampCard(c, _adsData.kwByCamp[c.name] || [], _adsData.audByCamp[c.name] || [], _adsData.geoByCamp[c.name], _adsData.totalSpend, _market, _competitors, _adsData.plcByCamp[c.name] || [], _compMeta)).join("");
    arWirePlcModals(host, _adsData.plcByCamp);
    arWireCompModals(host, b);
    mArrive(host);
  };
  const loadMktComp = async (peek) => {
    if (!_adsData) return {};
    const kws = [...new Set(_adsData.camps.flatMap((c) => (_adsData.kwByCamp[c.name] || []).map((k) => k.keyword)))];
    const [mkt, comp, ...serps] = await Promise.all([
      kws.length ? window.olympus.siKwMarket(b.id, kws, peek) : Promise.resolve(null),
      window.olympus.siLocalCompetitors(b.id, peek),
      ...kws.map((kw) => window.olympus.siSerp(b.id, kw, peek)),
    ]);
    let changed = false;
    if (mkt?.ok && mkt.data) { _market = {}; for (const it of (mkt.data.items || [])) _market[(it.keyword || "").toLowerCase()] = it; changed = true; }
    kws.forEach((kw, i) => { const s = serps[i]; if (s?.ok && s.data) { const key = (kw || "").toLowerCase(); if (!_market[key]) _market[key] = {}; _market[key].position = s.data.myPosition ?? null; changed = true; } });
    if (comp?.ok && comp.data) { _competitors = comp.data.competitors || []; _compMeta = { keyword: comp.data.keyword, sector: comp.data.sector, zone: comp.data.zone, auto: comp.data.auto, me: comp.data.me }; changed = true; }
    if (changed) renderActive();
    return { mkt, comp };
  };
  (async () => {
    const [campsR, kwsR, audsR, geoR, plcR] = await Promise.all([window.olympus.argosAdsCampaigns(b.id, arAdsPeriod), window.olympus.argosAdsKeywords(b.id, arAdsPeriod), window.olympus.argosAdsAudiences(b.id, arAdsPeriod), window.olympus.argosAdsGeo(b.id), window.olympus.argosAdsPlacements(b.id, arAdsPeriod)]);
    if (!host) return;
    if (campsR?.warning) { host.innerHTML = `<div class="ga-note">${escapeHtml(campsR.warning)}</div>`; return; }
    let camps = campsR?.data?.campaigns || [];
    if (opts.activeOnly) camps = camps.filter((c) => c.current);
    if (!camps.length) { host.innerHTML = `<div class="ga-note">Aucune campagne Google Ads ${opts.activeOnly ? "active " : ""}pour ${escapeHtml(b.name)} sur ${arAdsPeriodLabel()}.</div>`; return; }
    const geoByCamp = {}; for (const gc2 of (geoR?.data?.campaigns || [])) geoByCamp[gc2.campaign] = gc2;
    const kwByCamp = {}, audByCamp = {}, plcByCamp = {};
    for (const k of (kwsR?.data?.keywords || [])) (kwByCamp[k.campaign] = kwByCamp[k.campaign] || []).push(k);
    for (const a of (audsR?.data?.audiences || [])) if (a.name) (audByCamp[a.campaign] = audByCamp[a.campaign] || []).push(a);
    for (const p of (plcR?.data?.placements || [])) (plcByCamp[p.campaign] = plcByCamp[p.campaign] || []).push(p);
    const totalSpend = camps.reduce((n, c) => n + (c.spend || 0), 0);
    _adsData = { camps, kwByCamp, audByCamp, geoByCamp, plcByCamp, totalSpend };
    renderActive();
    if (opts.connected) loadMktComp(true);
  })();
  if (opts.mktBtn) opts.mktBtn.onclick = async (e) => {
    const bt = e.currentTarget; bt.disabled = true; const old = bt.innerHTML; bt.textContent = "Analyse marché & concurrents…";
    const r = await loadMktComp(false);
    bt.disabled = false; bt.innerHTML = old;
    const m = opts.msgEl;
    if (m) {
      const blocked = (r && r.comp && r.comp.budgetBlocked) || (r && r.mkt && r.mkt.budgetBlocked);
      const noSector = r && r.comp && r.comp.noSector;
      if (noSector) { m.className = "msg err"; m.innerHTML = `Définis le <b>secteur + zone</b> du client dans <b data-goto-settings2>Réglages</b> pour les concurrents locaux.`; const g = m.querySelector("[data-goto-settings2]"); if (g) g.onclick = () => goTo("settings"); }
      else if (blocked) { m.className = "msg err"; m.textContent = "Budget atteint — règle-le dans Titan."; }
      else { m.className = "msg ok"; m.textContent = "Marché & concurrents locaux ajoutés aux campagnes."; }
    }
  };
}
// Période choisie pour les données Ads : {days:N} (N derniers jours) OU {from,to} (plage explicite).
let arAdsPeriod = { days: 90 };
function arAdsPeriodLabel() { return (arAdsPeriod.from && arAdsPeriod.to) ? `du ${arAdsPeriod.from} au ${arAdsPeriod.to}` : `${arAdsPeriod.days || 90} derniers jours`; }
function arAdsPeriodControl() {
  const isDays = !(arAdsPeriod.from && arAdsPeriod.to);
  const presets = [[7, "7 j"], [30, "30 j"], [90, "90 j"]];
  return `<div class="ar-adsperiod">
      <div class="ga-period">${presets.map(([n, l]) => `<button class="ga-per${isDays && (arAdsPeriod.days || 90) === n ? " on" : ""}" data-adsdays="${n}">${l}</button>`).join("")}</div>
      <span class="ar-adsperiod-r"><input type="date" class="auth-input" id="arAdsFrom" value="${arAdsPeriod.from || ""}"><span>→</span><input type="date" class="auth-input" id="arAdsTo" value="${arAdsPeriod.to || ""}"><button class="btn sec" id="arAdsRangeApply">OK</button></span>
    </div>`;
}
function arWireAdsPeriod(box) {
  box.querySelectorAll("[data-adsdays]").forEach((bt) => bt.onclick = () => { arAdsPeriod = { days: +bt.dataset.adsdays }; arRenderView(); });
  const ap = box.querySelector("#arAdsRangeApply");
  if (ap) ap.onclick = () => { const f = (box.querySelector("#arAdsFrom") || {}).value, t = (box.querySelector("#arAdsTo") || {}).value; if (f && t) { arAdsPeriod = { from: f, to: t }; arRenderView(); } };
}
// Courbe multi-lignes « intérêt dans le temps » (une ligne par mot-clé, volume mensuel).
const AR_MONTH_FR = ["", "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function arTrendChart(series) {
  const clean = (series || []).filter((s) => (s.monthly || []).length >= 2);
  if (!clean.length) return `<div class="ga-chart-empty">Pas encore de données de tendance.</div>`;
  const maxV = Math.max(1, ...clean.flatMap((s) => s.monthly.map((p) => p.v)));
  const w = 1000, h = 230, padX = 46, padT = 14, padB = 30;
  const X = (i, n) => padX + (i / Math.max(1, n - 1)) * (w - padX - 12);
  const Y = (v) => padT + (1 - v / maxV) * (h - padT - padB);
  const grid = [0, 0.5, 1].map((f) => { const y = padT + f * (h - padT - padB); const v = Math.round(maxV * (1 - f)); return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${w - 12}" y2="${y.toFixed(1)}" class="ga-grid"/><text x="${padX - 6}" y="${(y + 3).toFixed(1)}" class="ga-axis" text-anchor="end">${pgFmtN(v)}</text>`; }).join("");
  const lines = clean.map((s, si) => { const c = PG_PALETTE[si % PG_PALETTE.length]; const n = s.monthly.length; const dd = s.monthly.map((p, i) => `${i ? "L" : "M"}${X(i, n).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(" "); return `<path d="${dd}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`; }).join("");
  const ref = clean.reduce((a, s) => s.monthly.length > a.length ? s.monthly : a, clean[0].monthly);
  const lbl = (p) => p ? AR_MONTH_FR[p.m] + " " + String(p.y).slice(2) : "";
  const legend = `<div class="ar-trend-leg">${clean.map((s, si) => `<span class="ar-trend-lg"><span class="dot" style="background:${PG_PALETTE[si % PG_PALETTE.length]}"></span>${escapeHtml(s.keyword)}</span>`).join("")}</div>`;
  return `<svg viewBox="0 0 ${w} ${h}" class="ga-chart" preserveAspectRatio="xMidYMid meet">${grid}${lines}<text x="${padX}" y="${h - 6}" class="ga-axis">${lbl(ref[0])}</text><text x="${w - 12}" y="${h - 6}" class="ga-axis" text-anchor="end">${lbl(ref[ref.length - 1])}</text></svg>${legend}`;
}
// ── Tendance : « Google Trends maison » (Keyword Planner, gratuit) + test de mot-clé (déplacé de Publicité) ──
async function arViewTendance(box, b, tok) {
  const st = await window.olympus.siStatus().catch(() => null); // pour le composant « Tester un mot-clé » (SI)
  if (tok !== undefined && !arRenderAlive(tok)) return;
  const connected = !!(st?.ok && st.connected);
  const priceOf = (id) => (st?.pricing?.find((p) => p.id === id) || {}).eur;
  let html = arHead("Tendance", "intérêt de recherche dans le temps & mots-clés associés", "", false);
  html += `<div class="ga-panel"><div class="ga-panel-h">Tendance de recherche<span class="ga-panel-x"><span class="pg-pill" style="font-size:11px;">gratuit · Google</span></span></div>
     <p class="desc" style="margin-bottom:12px;">Volume de recherche mensuel sur ~4 ans — l'<b>évolution dans le temps</b>, la <b>saisonnalité</b>, la <b>concurrence</b>, le <b>CPC</b> et les <b>mots-clés associés / en hausse</b>. Compare plusieurs termes en les séparant par une <b>virgule</b>. Source : Google Ads Keyword Planner.</p>
     <div class="ar-seakw-add">
       <input class="auth-input" id="arTrendInput" placeholder="ex. restaurant, brunch, terrasse" style="flex:1;">
       <input class="auth-input" id="arTrendLoc" placeholder="Lieu (ex. Monaco)" value="${escapeHtml(b.zone || "")}" style="width:150px;">
       <button class="btn" id="arTrendBtn">Voir la tendance</button>
     </div>
     <div class="msg" id="arTrendMsg" style="margin:8px 0 0;"></div>
     <div id="arTrendResult" style="margin-top:14px;"><div class="ga-note" style="opacity:.6;">Entre un ou plusieurs mots-clés ci-dessus pour voir leur tendance.</div></div></div>`;
  const testerInner = connected ? `<div id="arTendKwTester"><div class="ga-note" style="opacity:.6;">Chargement…</div></div>`
    : `<div class="ga-note">Connecte un fournisseur de données dans <b data-goconn>Titan → Search Intelligence</b> pour tester un mot-clé (ta position + concurrents).</div>`;
  html += pgPanel("Tester un mot-clé — ta position & tes concurrents", testerInner);
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
  const gc = box.querySelector("[data-goconn]"); if (gc) gc.onclick = () => goTo("titan");
  if (connected) arMountKwTester(box.querySelector("#arTendKwTester"), b, priceOf);
  const out = box.querySelector("#arTrendResult"), msg = box.querySelector("#arTrendMsg");
  const compLbl = (x) => ({ LOW: "faible", MEDIUM: "moyenne", HIGH: "forte" }[x] || (x || "").toLowerCase());
  const delta = (p) => p == null ? "" : `<span class="ar-trend-delta ${p > 5 ? "up" : p < -5 ? "down" : "flat"}">${p > 0 ? "↗ +" : p < 0 ? "↘ " : "→ "}${p} %</span>`;
  const renderTrends = (d) => {
    if (!d) { out.innerHTML = ""; return; }
    if (d.error) {
      const basic = /DEVELOPER_TOKEN_NOT_APPROVED|explorer access|not allowed for use|PERMISSION_DENIED/i.test(d.error);
      out.innerHTML = `<div class="ga-note">${basic ? "📈 <b>Keyword Planner nécessite l'accès « Basic »</b> du token Google Ads (il est en niveau Test/Explorer). Fais la demande dans l'<b>API Center Google Ads</b> (gratuit, ~1-2 j) — cette vue s'activera automatiquement dès l'approbation." : escapeHtml(d.error)}</div>`;
      return;
    }
    const kws = d.keywords || [];
    if (!kws.length) { out.innerHTML = `<div class="ga-note">Aucune donnée de tendance pour ces termes.</div>`; return; }
    const chart = pgPanel("Intérêt dans le temps" + (d.location ? " · " + escapeHtml(d.location) : ""), arTrendChart(kws));
    const kpis = kws.map((k) => `<div class="ar-trend-kpi"><div class="ar-trend-kpi-t">« ${escapeHtml(k.keyword)} »</div><div class="ga-cards">
        ${pgScore("Volume moyen", pgFmtN(k.avgMonthly) + "/mois", "", "tendance " + (delta(k.trendPct) || "—"))}
        ${pgScore("Concurrence", compLbl(k.competition) || "—", "", k.competitionIndex != null ? k.competitionIndex + "/100" : "")}
        ${pgScore("CPC (haut de page)", k.cpcLow != null ? siEurNum(k.cpcLow) + "–" + siEurNum(k.cpcHigh) + " €" : "—")}
        ${pgScore("Pic saisonnier", k.peak ? AR_MONTH_FR[k.peak.m] + " " + k.peak.y : "—", "", k.peak ? pgFmtN(k.peak.v) + " rech." : "")}
      </div></div>`).join("");
    const ideas = d.ideas || [];
    const maxIdea = Math.max(1, ...ideas.map((i) => i.avgMonthly || 0));
    const ideasBlock = ideas.length ? pgPanel("Mots-clés associés & en hausse", `<div class="ga-note" style="margin:0 0 8px;font-size:11px;">Ce que les gens cherchent autour de tes termes (volume mensuel · évolution récente).</div><div class="ga-tbl">${ideas.map((i) => `<div class="ga-tr"><span class="ga-tl">${escapeHtml(i.keyword)}${i.competition ? ` <span style="color:var(--dim);font-size:10px;">conc. ${compLbl(i.competition)}</span>` : ""}</span><span class="ga-tbar"><span class="ga-tbar-f" style="width:${Math.round((i.avgMonthly || 0) / maxIdea * 100)}%;background:#7fb2e8"></span></span><span class="ga-tv">${pgFmtN(i.avgMonthly)}<span class="ga-tpct">/mois</span> ${delta(i.trendPct)}</span></div>`).join("")}</div>`) : "";
    out.innerHTML = chart + kpis + ideasBlock;
    mArrive(out);
  };
  const load = async (force) => {
    const kws = (box.querySelector("#arTrendInput").value || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
    const loc = box.querySelector("#arTrendLoc").value || "";
    if (!kws.length) { msg.className = "msg err"; msg.textContent = "Entre au moins un mot-clé."; return; }
    msg.className = "msg"; msg.textContent = "";
    const rr = await window.olympus.argosTrends(b.id, kws, loc, force);
    if (rr && rr.ok) renderTrends(rr.data);
    else out.innerHTML = `<div class="ga-note">${escapeHtml((rr && rr.error) || "Échec")}</div>`;
    return rr;
  };
  box.querySelector("#arTrendBtn").onclick = async (e) => { const bt = e.currentTarget; bt.disabled = true; const old = bt.innerHTML; bt.textContent = "Analyse…"; await load(false); bt.disabled = false; bt.innerHTML = old; };
  box.querySelector("#arTrendInput").onkeydown = (e) => { if (e.key === "Enter") box.querySelector("#arTrendBtn").click(); };
}
// ── Notoriété : réputation locale (Google Maps) du client vs concurrents + estimation SEA au clic ──
async function arViewNotoriete(box, b, tok) {
  const st = await window.olympus.siStatus().catch(() => null);
  if (tok !== undefined && !arRenderAlive(tok)) return;
  const connected = !!(st?.ok && st.connected);
  const priceOf = (id) => (st?.pricing?.find((p) => p.id === id) || {}).eur;
  const seaCost = priceOf("serp");
  const whoisCost = priceOf("whois"); // par lot de 8 domaines
  const refreshEst = (seaCost || 0) + 8 * (whoisCost || 0); // borne haute d'un refresh complet (concurrents + ancienneté)
  const sandboxBadge = !connected ? "" : (st.sandbox ? `<span class="pg-pill" style="font-size:11px;">🧪 Sandbox (gratuit)</span>` : `<span class="pg-pill" style="font-size:11px;">budget ${siEur(st.budget.spent)} / ${siEur(st.budget.hard)}</span>`);
  let html = arHead("Notoriété", "ta réputation locale vs tes concurrents (Google Maps)", "", false);
  if (!connected) {
    box.innerHTML = html + pgPanel("Notoriété", `<div class="ga-note">Connecte un fournisseur de données dans <b data-goconn>Titan → Search Intelligence</b> pour voir ta notoriété face à tes concurrents locaux.</div>`);
    const g = box.querySelector("[data-goconn]"); if (g) g.onclick = () => goTo("titan"); return;
  }
  html += `<div class="ga-panel flat"><div class="ga-panel-h">Concurrents locaux${sandboxBadge ? `<span class="ga-panel-x">${sandboxBadge}</span>` : ""}</div>
     <p class="desc" style="margin-bottom:12px;">Ta <b>réputation Google Maps</b> (note + avis) face à tes <b>vrais concurrents locaux</b> — secteur + zone déduits automatiquement des campagnes. L'<b>ancienneté</b> au bout de la barre = âge du nom de domaine (<b>NC</b> si pas de site). Clique une ligne pour l'<b>estimation SEA</b> d'un concurrent.</p>
     <div style="margin-bottom:12px;"><button class="btn sec" id="arNotoBtn">Analyser les concurrents locaux${refreshEst ? ` <span class="si-cost">(≈ ${siEur(refreshEst)})</span>` : ""}</button><span class="msg" id="arNotoMsg" style="margin-left:8px;"></span></div>
     <div id="arNotoResult"><div class="ga-note" style="opacity:.6;">Chargement…</div></div></div>`;
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
  // Tri des 100 concurrents les plus proches : distance (proche→loin), avis (+→−), note (mieux→moins bien).
  let notoData = null, notoSort = "distance";
  const NOTO_SORTS = [["distance", "Distance"], ["reviews", "Avis"], ["rating", "Note"]];
  const sortComps = (comps, mode) => {
    const a = comps.slice();
    if (mode === "distance") a.sort((x, y) => (x.distance == null) - (y.distance == null) || (x.distance || 0) - (y.distance || 0));
    else if (mode === "reviews") a.sort((x, y) => (y.reviews || 0) - (x.reviews || 0));
    else if (mode === "rating") a.sort((x, y) => (y.rating || 0) - (x.rating || 0) || (y.reviews || 0) - (x.reviews || 0));
    return a;
  };
  // Le filtre trie le classement : il est rendu DANS la section classement (via arLocalCompetitorsHTML).
  const filterHtml = () => {
    const hasDist = notoData && (notoData.competitors || []).some((c) => c.distance != null);
    return `<div class="ar-seg" role="tablist">${NOTO_SORTS.map(([k, l]) => `<button class="ar-seg-b${notoSort === k ? " on" : ""}${k === "distance" && !hasDist ? " off" : ""}" data-notosort="${k}"${k === "distance" && !hasDist ? " disabled title=\"Distance indisponible (position du client introuvable sur Maps)\"" : ""}><span class="ar-seg-dot" style="background:${AR_SORT_COLORS[k]}"></span>${l}</button>`).join("")}</div>`;
  };
  const render = () => {
    if (tok !== undefined && !arRenderAlive(tok)) return; // ignore les renders périmés (remontage de la vue)
    const out = box.querySelector("#arNotoResult"); if (!out || !notoData) return;
    const sorted = sortComps(notoData.competitors || [], notoSort);
    out.innerHTML = arLocalCompetitorsHTML(sorted, { keyword: notoData.keyword, auto: notoData.auto, me: notoData.me }, 100, notoSort, true, filterHtml()) || `<div class="ga-note">Aucun concurrent local trouvé.</div>`;
    out.querySelectorAll("[data-notosort]").forEach((bt) => bt.onclick = () => { if (notoSort === bt.dataset.notosort) return; notoSort = bt.dataset.notosort; render(); });
    // Modale = AVIS uniquement + en-tête comparaison avec le client (note/avis/classement/distance).
    const others = (notoData.competitors || []).filter((c) => !c.mine);
    // Stats du client pour la comparaison : l'entrée « mine » (note/avis/distance) sinon le lookup me.
    const me = (notoData.competitors || []).find((c) => c.mine) || notoData.me || {};
    const meRank = (me.rating != null || me.reviews != null || me.distance != null) ? others.filter((o) => sortLt(o, me, notoSort)).length + 1 : null;
    arWireCompModals(out, b, { reviewsOnly: true, sortLabel: { distance: "distance", reviews: "avis", rating: "note" }[notoSort], total: others.length + 1, me: { name: (notoData.me && notoData.me.title) || me.title || b.name, rating: me.rating ?? null, reviews: me.reviews ?? null, rank: meRank } });
    mArrive(out);
  };
  // Ancienneté = âge du domaine (whois). undefined = pas chargé, null = NC, nombre = mois.
  const applyAges = (agesMap, meDomain, complete) => {
    const has = (d) => d && Object.prototype.hasOwnProperty.call(agesMap, d);
    for (const c of (notoData.competitors || [])) c.ageMonths = has(c.domain) ? agesMap[c.domain] : (complete ? null : undefined);
    if (notoData.me) notoData.me.ageMonths = has(meDomain) ? agesMap[meDomain] : (complete ? null : undefined);
  };
  const loadAges = async (peek) => {
    if (!notoData) return null;
    const domains = [...new Set((notoData.competitors || []).map((c) => c.domain).filter(Boolean))];
    const ar = await window.olympus.siLocalAges(b.id, domains, peek);
    if (!ar?.ok) return ar;
    if (peek && ar.needFetch) return ar; // pas tout en cache : on laisse vierge, le bouton fera le fetch payant
    applyAges(ar.ages || {}, ar.meDomain, !peek);
    render();
    return ar;
  };
  const loadNoto = async (peek) => {
    const rr = await window.olympus.siLocalCompetitors(b.id, peek, 100); // 100 concurrents les plus proches
    const out = box.querySelector("#arNotoResult"); if (!out) return rr;
    if (rr?.ok && rr.data) { notoData = rr.data; if (!(notoData.competitors || []).some((c) => c.distance != null)) notoSort = "reviews"; render(); await loadAges(peek); return rr; }
    if (peek) { out.innerHTML = `<div class="ga-note">Clique <b>« Analyser les concurrents locaux »</b> pour afficher les <b>100 concurrents les plus proches</b> et les trier par distance, avis ou note.</div>`; return rr; }
    if (rr && rr.noSector) { out.innerHTML = `<div class="ga-note">Impossible de déduire le secteur/zone — renseigne-les dans <b data-goto-settings>Réglages</b> ou lance une campagne géociblée.</div>`; const g = out.querySelector("[data-goto-settings]"); if (g) g.onclick = () => goTo("settings"); }
    else { out.innerHTML = `<div class="ga-note">${escapeHtml(rr?.error || "Échec")}${rr?.budgetBlocked ? " — règle le budget dans Titan." : ""}</div>`; }
    return rr;
  };
  box.querySelector("#arNotoBtn").onclick = async (e) => { const bt = e.currentTarget; bt.disabled = true; const old = bt.innerHTML; bt.textContent = "Analyse…"; await loadNoto(false); bt.disabled = false; bt.innerHTML = old; };
  loadNoto(true); // cache gratuit à l'ouverture
}
// ── Mots-clés Google Ads du client (réel), par campagne — vue à bascule Actives / Passées ──
let arAdsKwScope = "current";
async function arViewAdsKeywords(box, b, tok) {
  const isCurrent = arAdsKwScope === "current";
  const toggle = `<div class="ga-period">${[["current", "Actives"], ["past", "Passées"]].map(([s, l]) => `<button class="ga-per${arAdsKwScope === s ? " on" : ""}" data-adsscope="${s}">${l}</button>`).join("")}</div>`;
  const html = arHead("Mots-clés Google Ads", "tes campagnes, leurs mots-clés, audiences et zones géographiques — " + arAdsPeriodLabel(), toggle + arAdsPeriodControl(), false);
  const wire = () => { box.querySelectorAll("[data-adsscope]").forEach((bt) => bt.onclick = () => { if (arAdsKwScope === bt.dataset.adsscope) return; arAdsKwScope = bt.dataset.adsscope; arRenderView(); }); arWireAdsPeriod(box); };
  if (tok !== undefined && !arRenderAlive(tok)) return;
  const hasAds = (b.assets || []).some((a) => a.network === "google_ads");
  if (!hasAds) {
    box.innerHTML = html + pgPanel("Compte Google Ads non associé", `<div class="ga-note">Associe le compte Google Ads de <b>${escapeHtml(b.name)}</b> dans <b data-goconn>Réglages → Argos — Clients</b> (glisse le chip du compte sur la marque) pour voir ses campagnes et mots-clés.</div>`);
    wire(); const g = box.querySelector("[data-goconn]"); if (g) g.onclick = () => goTo("settings"); return;
  }
  box.innerHTML = html + `<div class="ga-note" style="opacity:.6;">Chargement des campagnes Google Ads…</div>`; wire();
  const [campsR, kwsR, audsR, geoR, plcR] = await Promise.all([window.olympus.argosAdsCampaigns(b.id, arAdsPeriod), window.olympus.argosAdsKeywords(b.id, arAdsPeriod), window.olympus.argosAdsAudiences(b.id, arAdsPeriod), window.olympus.argosAdsGeo(b.id), window.olympus.argosAdsPlacements(b.id, arAdsPeriod)]);
  if (tok !== undefined && !arRenderAlive(tok)) return;
  const allCamps = campsR?.data?.campaigns || [];
  const camps = allCamps.filter((c) => isCurrent ? c.current : !c.current);
  const kws = (kwsR?.data?.keywords || []).filter((k) => isCurrent ? k.current : !k.current);
  const auds = (audsR?.data?.audiences || []).filter((a) => isCurrent ? a.current : !a.current);
  const geoByCamp = {}; for (const gc of (geoR?.data?.campaigns || [])) geoByCamp[gc.campaign] = gc;
  const isDemo = campsR?.data?.demo === true || kwsR?.data?.demo === true;
  const warn = campsR?.warning || kwsR?.warning;
  if (isDemo || warn) {
    box.innerHTML = html + pgPanel("Données Google Ads indisponibles", `<div class="ga-note">${warn ? escapeHtml(warn) : "Le compte est associé mais aucune donnée réelle n'est encore remontée."}</div>`);
    wire(); return;
  }
  if (!camps.length) {
    const note = isCurrent
      ? `Aucune campagne active sur <b>${arAdsPeriodLabel()}</b> pour <b>${escapeHtml(b.name)}</b>.`
      : (allCamps.length ? `Toutes les campagnes de <b>${escapeHtml(b.name)}</b> sont actives — aucune en pause ou arrêtée sur ${arAdsPeriodLabel()}. 👍` : `Aucune campagne sur ${arAdsPeriodLabel()}.`);
    box.innerHTML = html + pgPanel(isCurrent ? "Campagnes actives" : "Campagnes passées", `<div class="ga-note">${note}</div>`);
    wire(); return;
  }
  const matchLbl = (m) => ({ EXACT: "exact", PHRASE: "expression", BROAD: "large" }[m] || (m || "").toLowerCase());
  const kwByCamp = {}; for (const k of kws) (kwByCamp[k.campaign] = kwByCamp[k.campaign] || []).push(k);
  const audByCamp = {}; for (const a of auds) (audByCamp[a.campaign] = audByCamp[a.campaign] || []).push(a);
  const plcByCamp = {}; for (const p of (plcR?.data?.placements || [])) if (isCurrent ? p.current : !p.current) (plcByCamp[p.campaign] = plcByCamp[p.campaign] || []).push(p);
  const totalKw = kws.length, totalSpend = camps.reduce((n, c) => n + (c.spend || 0), 0), totalClicks = camps.reduce((n, c) => n + (c.clicks || 0), 0);
  let out = html + `<div class="ga-cards" style="margin-bottom:16px;">
    ${pgScore("Campagnes", camps.length, "", isCurrent ? "en cours" : "en pause / arrêtées")}
    ${pgScore("Mots-clés", totalKw, "", "sur ces campagnes")}
    ${pgScore("Clics", pgFmtN(totalClicks), "", arAdsPeriodLabel())}
    ${pgScore("Dépense", pgFmtN(Math.round(totalSpend)) + " €", "", arAdsPeriodLabel())}
  </div>`;
  for (const c of camps) {
    out += arAdsCampCard(c, kwByCamp[c.name] || [], (audByCamp[c.name] || []).filter((a) => a.name), geoByCamp[c.name], totalSpend, undefined, undefined, plcByCamp[c.name] || []);
  }
  box.innerHTML = out;
  wire();
  arWirePlcModals(box, plcByCamp);
  mArrive(box);
}
function siEurNum(v) { return (typeof v === "number" ? v : +v || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// « Tester un mot-clé » : monitor manuel (position + concurrents + popularité/concurrence marché par
// lieu). Rendu dans `host`. Nécessite DataForSEO connecté (le caller vérifie). Utilisé par Publicité (Google).
function arMountKwTester(host, b, priceOf) {
  if (!host) return;
  const kwCost = priceOf("serp");
  host.innerHTML = `<p class="desc" style="margin-bottom:12px;">Ajoute un mot-clé qui t'intéresse pour voir <b>ta position</b>, <b>qui te devance</b>, sa <b>popularité</b> (volume de recherche) et la <b>concurrence</b> — de quoi décider s'il vaut le coup. Choisis le <b>lieu</b> pour la popularité. Enregistré et <b>rafraîchi tous les 7 jours</b>.</p>
     <div class="ar-seakw-add">
       <input class="auth-input" id="arSeaKwInput" placeholder="ex. restaurant monaco" style="flex:1;">
       <input class="auth-input" id="arSeaKwLoc" placeholder="Lieu (ex. Monaco)" value="${escapeHtml(b.zone || "")}" style="width:150px;">
       <button class="btn" id="arSeaKwAddBtn">Ajouter${kwCost != null ? ` <span class="si-cost">(${siEur(kwCost)})</span>` : ""}</button>
       <button class="btn sec" id="arSeaKwRefreshAll" title="Rafraîchir tous les mots-clés maintenant">↻ Tout rafraîchir</button>
     </div>
     <div style="margin-top:6px;"><button class="btn sec" id="arSeaKwMktBtn" style="font-size:11px;padding:4px 10px;">Charger popularité & concurrence pour le lieu</button></div>
     <div class="msg" id="arSeaKwMsg" style="margin:8px 0 0;"></div>
     <div id="arSeaKwList" style="margin-top:14px;"><div class="ga-note" style="opacity:.6;">Chargement…</div></div>`;
  const msg = host.querySelector("#arSeaKwMsg");
  const posBadge = (d) => {
    if (!d) return `<span class="ar-seakw-pos none">à analyser</span>`;
    if (d.myPosition != null) return `<span class="ar-seakw-pos top">${d.myPosition}ᵉ organique</span>`;
    return `<span class="ar-seakw-pos out">hors top 20</span>`;
  };
  const ageTxt = (at) => { if (!at) return ""; const days = Math.floor((Date.now() - at) / 86400000); const stale = days >= 7; return `<span class="ar-seakw-age${stale ? " stale" : ""}">${days <= 0 ? "aujourd'hui" : "il y a " + days + " j"}${stale ? " · à rafraîchir" : ""}</span>`; };
  const compLbl2 = (x) => ({ LOW: "faible", MEDIUM: "moyenne", HIGH: "forte" }[x] || (x || "").toLowerCase());
  let _kwMarket = {};
  const mktBadge = (kw) => { const m = _kwMarket[(kw || "").toLowerCase()]; if (!m) return ""; return `<span class="ar-seakw-mkt">${m.volume != null ? pgFmtN(m.volume) + " rech./mois" : ""}${m.competition ? " · conc. " + compLbl2(m.competition) : ""}${m.cpc != null ? " · CPC marché " + siEurNum(m.cpc) + " €" : ""}</span>`; };
  const renderList = (keywords) => {
    const out = host.querySelector("#arSeaKwList"); if (!out) return;
    if (!keywords.length) { out.innerHTML = `<div class="ga-note">Aucun mot-clé encore. Ajoute-en un ci-dessus (ex. « restaurant monaco ») pour suivre ta position et les annonces concurrentes.</div>`; return; }
    out.innerHTML = keywords.map((k) => {
      const d = k.data; const ads = (d && d.ads) || []; const org = (d && d.organic) || [];
      return `<div class="ar-seakw" data-kw="${escapeHtml(k.keyword)}">
        <div class="ar-seakw-h">
          <span class="kw">${escapeHtml(k.keyword)}</span>
          ${posBadge(d)}
          ${mktBadge(k.keyword)}
          ${d && d.adCount > 0 ? `<span class="ar-seakw-ads">${d.iAdvertise ? "✓ tu annonces · " : ""}${d.adCount} annonce${d.adCount > 1 ? "s" : ""}</span>` : ""}
          ${ageTxt(k.at)}
          <span class="ar-seakw-actions">
            <button class="ar-seakw-btn" data-refresh title="Rafraîchir ce mot-clé">↻</button>
            <button class="ar-seakw-btn del" data-del title="Supprimer">✕</button>
          </span>
        </div>
        ${d ? `<div class="ar-seakw-body">
          ${org.length ? `<div class="ar-seakw-sub">Qui se classe devant ${escapeHtml(b.name)}</div>
            <div class="ga-tbl">${org.slice(0, 6).map((o) => { const mine = d.myPosition != null && o.position === d.myPosition; return `<div class="ga-tr"><span class="ga-tl">${mine ? "◂ " : ""}${o.position ?? "—"}. ${escapeHtml(o.domain)}${mine ? " (vous)" : ""}</span></div>`; }).join("")}</div>`
            : `<div class="ga-note" style="margin:4px 0;">Aucun résultat organique capté.</div>`}
          ${ads.length ? `<div class="ar-seakw-sub" style="margin-top:8px;">Annonces Google Ads détectées</div>
            ${ads.slice(0, 6).map((ad) => `<div class="ar-sea-ad sm"><div class="t">${escapeHtml(ad.domain)}${ad.title ? ` — ${escapeHtml(ad.title)}` : ""}</div>${ad.description ? `<div class="d2">${escapeHtml(ad.description)}</div>` : ""}</div>`).join("")}` : ""}
        </div>` : ""}
      </div>`;
    }).join("");
    out.querySelectorAll(".ar-seakw").forEach((row) => {
      const kw = row.dataset.kw;
      row.querySelector("[data-del]").onclick = async () => { await window.olympus.siSeaKwRemove(b.id, kw); reload(); };
      row.querySelector("[data-refresh]").onclick = async (e) => { const bt = e.currentTarget; bt.disabled = true; bt.textContent = "…"; await window.olympus.siSeaKwRefresh(b.id, kw); reload(); };
    });
    mArrive(out);
  };
  const reload = async () => { const r = await window.olympus.siSeaKwList(b.id); if (r && r.ok) { renderList(r.keywords); loadKwMarket(true); } };
  const loadKwMarket = async (peek) => {
    const r = await window.olympus.siSeaKwList(b.id); const kws = (r?.keywords || []).map((k) => k.keyword);
    if (!kws.length) return { ok: true };
    const loc = (host.querySelector("#arSeaKwLoc") || {}).value || "";
    const mk = await window.olympus.siKwMarket(b.id, kws, peek, loc);
    if (mk?.ok && mk.data) { _kwMarket = {}; for (const it of (mk.data.items || [])) _kwMarket[(it.keyword || "").toLowerCase()] = it; renderList(r.keywords); }
    return mk;
  };
  { const mb = host.querySelector("#arSeaKwMktBtn"); if (mb) mb.onclick = async (e) => { const bt = e.currentTarget; bt.disabled = true; const old = bt.innerHTML; bt.textContent = "Chargement…"; const mk = await loadKwMarket(false); bt.disabled = false; bt.innerHTML = old; if (mk && !mk.ok) { msg.className = "msg err"; msg.textContent = mk.budgetBlocked ? "Budget atteint — règle-le dans Titan." : "Échec marché."; } else { msg.className = "msg ok"; msg.textContent = "Popularité & concurrence chargées."; } }; }
  host.querySelector("#arSeaKwAddBtn").onclick = async (e) => {
    const inp = host.querySelector("#arSeaKwInput"); const val = inp.value.trim(); if (!val) return;
    const bt = e.currentTarget; bt.disabled = true; const old = bt.innerHTML; bt.textContent = "Analyse…";
    msg.className = "msg"; msg.textContent = "";
    const rr = await window.olympus.siSeaKwAdd(b.id, val);
    bt.disabled = false; bt.innerHTML = old;
    if (!rr || !rr.ok) { msg.className = "msg err"; msg.textContent = rr && rr.budgetBlocked ? "Budget atteint — règle-le dans Titan." : "Échec : " + ((rr && rr.error) || "réessaie"); }
    else { inp.value = ""; msg.className = "msg ok"; msg.textContent = `« ${rr.keyword} » ajouté et analysé.`; }
    reload();
  };
  host.querySelector("#arSeaKwInput").addEventListener("keydown", (e) => { if (e.key === "Enter") host.querySelector("#arSeaKwAddBtn").click(); });
  host.querySelector("#arSeaKwRefreshAll").onclick = async (e) => {
    const bt = e.currentTarget; bt.disabled = true; const old = bt.innerHTML; bt.textContent = "Rafraîchissement…";
    msg.className = "msg"; msg.textContent = "Rafraîchissement de tous les mots-clés…";
    const rr = await window.olympus.siSeaKwRefresh(b.id);
    bt.disabled = false; bt.innerHTML = old;
    msg.className = "msg ok"; msg.textContent = rr && rr.results ? `${rr.results.length} mot(s)-clé rafraîchi(s).` : "Terminé.";
    reload();
  };
  reload();
}
// ── Veille Meta : benchmark des comptes concurrents suivis (saisie manuelle) ──
async function arViewVeilleMeta(box, b, tok) {
  const r = await arGet(b.id + ":comp", () => window.olympus.argosCompetitors(b.id));
  if (!r.ok) { box.innerHTML = `<div class="ga-note">${escapeHtml(r.error)}</div>`; return; }
  const rows = r.data.rows || [];
  let html = arHead("Veille Meta", "benchmark des comptes suivis (Instagram / Facebook)", `<button class="btn sec" id="arAddComp">＋ Suivre un concurrent</button>`, "Meta ne donne pas accès aux données de comptes que tu ne gères pas — saisie manuelle");
  html += pgPanel("Benchmark", `
    <div class="ar-comp-row head"><span>Compte</span><span class="v">Abonnés</span><span class="v">Croissance</span><span class="v">Engagement</span><span class="v">Posts/30 j</span></div>
    ${rows.map((c) => `<div class="ar-comp-row${c.mine ? " mine" : ""}">
      <span class="n">${escapeHtml(c.name)}${c.mine ? " ◂ vous" : ""}<small>${escapeHtml(c.handle || "")}</small></span>
      <span class="v">${pgFmtN(c.followers)}</span>
      <span class="v" style="color:${c.growth >= 0 ? "var(--ok)" : "#e0868f"};">${c.growth >= 0 ? "▲" : "▼"} ${Math.abs(c.growth)} %</span>
      <span class="v">${String(c.engagement).replace(".", ",")} %</span>
      <span class="v">${c.posts30}</span>
    </div>`).join("")}`);
  const meIdx = rows.findIndex((x) => x.mine);
  if (meIdx >= 0) html += `<div class="ga-note" style="margin-top:12px;">${escapeHtml(b.name)} est <b>${meIdx + 1}ᵉ sur ${rows.length}</b> en abonnés dans son groupe de veille${meIdx > 0 ? " — l'engagement est le levier le plus rapide pour remonter" : " — position de leader à défendre"}.</div>`;
  html += pgPanel("Enrichir la veille Meta", `<div class="desc" style="line-height:1.7;">Meta ne donne pas de données sur les comptes qu'on ne gère pas — d'où la saisie manuelle. Pour aller plus loin :
    <ul style="margin:8px 0 0;padding-left:18px;">
      <li><b>Meta Ad Library</b> (bibliothèque publicitaire publique) : voir les annonces Meta actives de n'importe quel concurrent — à brancher via l'API Ad Library.</li>
      <li><b>Suivi manuel régulier</b> des comptes concurrents (abonnés, cadence de publication) — déjà possible ici.</li>
      <li><b>Croiser avec la Veille SEO/SEA</b> pour une vision 360° du concurrent.</li>
    </ul></div>`);
  if (tok !== undefined && !arRenderAlive(tok)) return;
  box.innerHTML = html;
  $("arAddComp").onclick = async () => {
    const nm = await arMiniInput(box, "Nom du concurrent (ex : Sézane)");
    if (!nm) return;
    const hd = await arMiniInput(box, "Son compte principal (ex : @sezane)");
    const list = [...(b.competitors || []), { name: nm, handle: hd || "" }];
    await window.olympus.argosCompetitorSave(b.id, list);
    b.competitors = list; delete arCache[b.id + ":comp"]; arRenderView();
  };
}
// Modal scrollable : classement Google réel d'un mot-clé — qui est devant le client.
function arSerpModal(b, k) {
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  ov.innerHTML = `<div class="modal-panel" style="width:560px;">
    <div class="modal-head"><h2 style="font-size:15px;">Classement Google — « ${escapeHtml(k.keyword)} »</h2><button class="modal-x" data-x>✕</button></div>
    <div class="modal-body"><div class="ga-note">Chargement du classement…</div></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  const body = ov.querySelector(".modal-body");
  window.olympus.siSerp(b.id, k.keyword).then((rr) => {
    if (!ov.isConnected) return;
    if (!rr?.ok) { body.innerHTML = `<div class="ga-note">${escapeHtml(rr?.error || "Échec du chargement.")}${rr?.budgetBlocked ? " — <b data-goconn>régler le budget (Titan)</b>" : ""}</div>`; const g = body.querySelector("[data-goconn]"); if (g) g.onclick = () => { close(); goTo("titan"); }; return; }
    const cd = (rr.data.domain || "").replace(/^www\./, "");
    const gscPos = k.position != null ? +(+k.position).toFixed(1) : null; // position MOYENNE Search Console (30 j)
    const items = rr.data.items || [];       // classement Google en direct (concurrents)
    const inLive = items.find((x) => x.domain.replace(/^www\./, "") === cd);
    // Lignes du classement : concurrents (position du jour) + la marque à sa position MOYENNE 30 j si absente du live,
    // le tout trié par position → la marque apparaît là où elle se classe réellement (cohérent avec la ligne du tableau).
    const rows = items.map((x) => ({ position: x.position, domain: x.domain.replace(/^www\./, ""), title: x.title, isMine: x.domain.replace(/^www\./, "") === cd, avg: false }));
    if (!inLive && gscPos != null) rows.push({ position: gscPos, domain: cd, title: null, isMine: true, avg: true });
    rows.sort((a, z) => (a.position ?? 999) - (z.position ?? 999));
    const headline = gscPos != null
      ? `<b>${escapeHtml(b.name)}</b> : position moyenne <b>${String(gscPos).replace(".", ",")}ᵉ</b> sur « ${escapeHtml(k.keyword)} » <span style="color:var(--dim);">(Search Console, 30 j)</span>`
      : `<b>${escapeHtml(b.name)}</b> — « ${escapeHtml(k.keyword)} »`;
    const sub = inLive
      ? `Classement Google <b>en direct</b> — ${escapeHtml(b.name)} y est aujourd'hui ${inLive.position}ᵉ :`
      : `Concurrents à leur <b>position du jour</b> ; ${escapeHtml(b.name)} est placé à sa <b>position moyenne 30 j</b> (le live d'un instant peut le sortir du top 20, la moyenne lisse ces variations) :`;
    const fmtPos = (p, avg) => avg ? String(+(+p).toFixed(1)).replace(".", ",") : (p ?? "—");
    body.innerHTML = `<div class="si-serp-i" style="margin-bottom:4px;font-size:14px;">${headline}</div>
      <div class="desc" style="font-size:11.5px;margin-bottom:12px;">${sub}</div>
      ${rows.map((x) => `<div class="si-serprow${x.isMine ? " mine" : ""}"><span class="p">${fmtPos(x.position, x.avg)}</span><span class="dd"><span class="d">${escapeHtml(x.domain)}${x.isMine ? " ◂ vous" : ""}${x.avg ? ` <span style="font-size:9px;font-weight:600;letter-spacing:.04em;color:var(--dim);border:1px solid var(--line);border-radius:4px;padding:1px 4px;vertical-align:1px;">moy. 30 j</span>` : ""}</span>${x.title ? `<span class="tt">${escapeHtml(x.title)}</span>` : ""}</span></div>`).join("") || `<div class="ga-note">Aucun résultat organique.</div>`}`;
    mArrive(body);
  });
}
// Mini-saisie inline (window.prompt n'existe pas sous Electron)
function arMiniInput(box, label) {
  return new Promise((res) => {
    const ov = document.createElement("div"); ov.className = "modal-overlay show";
    ov.innerHTML = `<div class="modal-panel" style="width:420px;"><div class="modal-head"><h2 style="font-size:15px;">${escapeHtml(label)}</h2><button class="modal-x" data-x>✕</button></div>
      <div class="modal-body"><input class="mood-in" id="arMiniIn" autofocus><div class="pg-actrow" style="margin-top:12px;"><button class="cal-btn primary" id="arMiniOk">Valider</button></div></div></div>`;
    document.body.appendChild(ov);
    const done = (v) => { ov.remove(); res(v); };
    ov.querySelector("[data-x]").onclick = () => done(null);
    ov.onclick = (e) => { if (e.target === ov) done(null); };
    ov.querySelector("#arMiniOk").onclick = () => done(ov.querySelector("#arMiniIn").value.trim() || null);
    ov.querySelector("#arMiniIn").addEventListener("keydown", (e) => { if (e.key === "Enter") done(e.target.value.trim() || null); });
    setTimeout(() => ov.querySelector("#arMiniIn").focus(), 60);
  });
}

// ── Rapport : narratif + export PDF ──
async function arViewRapport(box, b, tok) {
  const period = { days: 30 };
  let snap = await window.olympus.argosSnapshot(b.id, period);
  const alive = () => tok === undefined || arRenderAlive(tok);
  const draw = () => { const f = $("arRepFrame"); if (f) f.srcdoc = arReportHTML(b, snap); };
  let html = arHead("Rapport", "rapport client multi-canal · 30 derniers jours",
    `<button class="cal-btn" id="arRepRefresh">⟳ Actualiser les données</button> <button class="cal-btn primary" id="arRepPdf">⤓ Exporter en PDF</button>`);
  html += `<iframe id="arRepFrame" title="Aperçu du rapport" style="width:100%;height:calc(100vh - 200px);min-height:520px;border:1px solid var(--line);border-radius:12px;background:#fff;"></iframe>`;
  if (!alive()) return;
  box.innerHTML = html; draw();
  window.olympus.argosReportSave(b.id, period, snap).catch(() => {});
  $("arRepRefresh").onclick = async (e) => {
    const bt = e.currentTarget; bt.disabled = true; bt.textContent = "Actualisation…";
    snap = await arReportWarm(b);
    if (!alive()) return;
    draw(); window.olympus.argosReportSave(b.id, period, snap).catch(() => {});
    bt.disabled = false; bt.textContent = "⟳ Actualiser les données";
  };
  $("arRepPdf").onclick = async (e) => {
    const bt = e.currentTarget; bt.disabled = true; bt.textContent = "Génération…";
    const r = await window.olympus.pegasusExportPdf(arReportHTML(b, snap), `rapport-${b.id}-${todayIsoNow()}.pdf`);
    bt.disabled = false; bt.textContent = "⤓ Exporter en PDF";
    if (r && !r.ok && r.error !== "Export annulé.") alert("Échec : " + (r.error || ""));
  };
}
// Réchauffe UNIQUEMENT les sources GRATUITES (Google + Meta) puis renvoie un snapshot frais.
// Les sources DataForSEO (payantes) restent en cache — jamais rappelées ici.
async function arReportWarm(b) {
  const days = 30, P = { days };
  await Promise.allSettled([
    window.olympus.argosWeb(b.id, days, true), window.olympus.argosSeo(b.id, days, true), window.olympus.argosSeoIntel(b.id, days, true),
    window.olympus.argosVitals(b.id, true), window.olympus.argosCrawl(b.id, true),
    window.olympus.argosAdsCampaigns(b.id, P, true), window.olympus.argosAdsKeywords(b.id, P, true), window.olympus.argosAdsAudiences(b.id, P, true),
    window.olympus.argosAdsGeo(b.id, true), window.olympus.argosAdsPlacements(b.id, P, true),
    window.olympus.argosOverview(b.id, days, true), window.olympus.argosAudience(b.id, true),
  ]);
  return await window.olympus.argosSnapshot(b.id, P);
}
// Document de rapport client autonome (HTML print-ready) assemblé depuis le snapshot. Sert à la
// fois d'aperçu (iframe) et de source du PDF. Ne montre QUE les sections réelles (demo exclu).
function arReportHTML(b, s) {
  const A = "#7a1b28", INK = "#1c1c1c", MU = "#666", LN = "#e7e4e5", SOFT = "#f7f5f6";
  const TC = { hi: "#2f855a", mid: "#8bbf9a", warn: "#c9821f", lo: "#c0392b", na: "#cfcccd" };
  const g = s.google || {}, m = s.meta || {}, si = s.si || {};
  const real = (x) => (x && x.demo !== true) ? x : null;
  const web = real(g.web), seo = real(g.seo), seoI = real(g.seoIntel), vit = real(g.vitals), crawl = real(g.crawl);
  const camps = real(g.adsCampaigns), plc = real(g.adsPlacements), adsT = real((s.ads || {}).totals);
  const social = real(m.overview), dov = real(si.domainOverview), bl = real(si.backlinks), loc = real(si.localCompetitors);
  const N = (v) => pgFmtN(v || 0), E = (v) => siEurNum(v || 0) + " €", P = (v, d = 1) => (v == null ? "—" : (+v).toFixed(d).replace(".", ",") + " %");
  const dec = (v, d = 1) => (v == null ? "—" : (+v).toFixed(d).replace(".", ","));
  const now = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const spark = (pts) => { pts = (pts || []).filter((v) => v != null); if (pts.length < 2) return ""; const w = 560, h = 46, n = pts.length, mx = Math.max(...pts, 1), mn = Math.min(...pts, 0); const X = (i) => i / (n - 1) * w, Y = (v) => h - ((v - mn) / ((mx - mn) || 1)) * (h - 8) - 4; const d = pts.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" "); return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="display:block"><path d="${d} L${w} ${h} L0 ${h} Z" fill="${A}14"/><path d="${d}" fill="none" stroke="${A}" stroke-width="2"/></svg>`; };
  const bars = (items) => { if (!items || !items.length) return ""; const mx = Math.max(...items.map((x) => x.value || 0), 1); return items.slice(0, 6).map((x) => `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px"><span style="width:150px;color:${MU};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.label || "")}</span><span style="flex:1;height:8px;background:${SOFT};border-radius:5px;overflow:hidden"><span style="display:block;height:100%;width:${Math.round((x.value || 0) / mx * 100)}%;background:${A}"></span></span><span style="width:60px;text-align:right;font-weight:600">${N(x.value)}</span></div>`).join(""); };
  const kpi = (v, l) => `<div style="flex:1;text-align:center;padding:2px 6px"><div style="font-size:22px;font-weight:800;color:${A};line-height:1.1">${v}</div><div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:${MU};margin-top:4px">${l}</div></div>`;
  const kband = (arr) => `<div style="display:flex;gap:8px">${arr.filter(Boolean).join("")}</div>`;
  const sec = (title, inner) => inner ? `<section style="margin:20px 0;break-inside:avoid"><h2 style="font-size:12.5px;color:${A};text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid ${LN};padding-bottom:5px;margin:0 0 10px">${title}</h2>${inner}</section>` : "";
  const panel = (inner) => `<div style="border:1px solid ${LN};border-radius:10px;padding:10px 13px;margin:8px 0">${inner}</div>`;
  const par = (t) => `<p style="font-size:12px;line-height:1.55;color:#333;margin:5px 0">${t}</p>`;

  const kpis = [];
  if (social) kpis.push(kpi(N(social.reach), "portée sociale"));
  if (web) kpis.push(kpi(N(web.totals.sessions), "sessions web"));
  if (seo) kpis.push(kpi(N(seo.totals.clicks), "clics SEO"));
  if (adsT) kpis.push(kpi(E(adsT.totals.spend), "dépense pub"));
  let locRank = null;
  if (loc && loc.me) { const others = (loc.competitors || []).filter((c) => !c.mine); locRank = others.filter((c) => (c.reviews || 0) > (loc.me.reviews || 0)).length + 1; kpis.push(kpi("#" + locRank, "rang notoriété")); }
  const kpiBand = kpis.length ? `<div style="display:flex;gap:8px;border:1px solid ${LN};border-radius:12px;padding:15px 8px;margin:14px 0 4px;background:${SOFT}">${kpis.join(`<div style="width:1px;background:${LN}"></div>`)}</div>` : "";

  let body = "";
  if (social) {
    const best = (social.perNet || []).slice().sort((a, b) => b.engagement - a.engagement)[0];
    body += sec("Réseaux sociaux",
      par(`<b>${N(social.reach)}</b> personnes touchées sur 30 jours pour ${social.published} publication(s), engagement moyen <b>${P(social.engagement)}</b> · <b>${N(social.followers)}</b> abonnés.`)
      + panel(spark((social.byDay || []).map((x) => x.reach)))
      + ((social.perNet || []).length ? `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:4px">${social.perNet.map((k) => `<tr><td style="padding:3px 0;color:${MU}">${escapeHtml(k.network)}</td><td style="text-align:right">${N(k.followers)} abonnés</td><td style="text-align:right">${P(k.engagement)} eng.</td><td style="text-align:right">${k.posts} posts</td></tr>`).join("")}</table>` : "")
      + (best ? par(`${escapeHtml(best.network)} est le réseau le plus engageant (${P(best.engagement)}).`) : ""));
  }
  if (web) body += sec("Site web",
    kband([kpi(N(web.totals.sessions), "sessions"), kpi(N(web.totals.users), "visiteurs"), kpi(N(web.totals.pageviews), "pages vues"), kpi(N(web.totals.conversions), "conversions"), vit ? kpi(vit.mobile.score + "/100", "perf mobile") : ""])
    + panel(spark((web.byDay || []).map((x) => x.sessions)))
    + ((web.channels || []).length ? `<div style="font-size:11px;color:${MU};margin:8px 0 2px">Canaux d'acquisition</div>${bars(web.channels)}` : ""));
  if (seo) body += sec("Référencement (SEO)",
    kband([kpi(N(seo.totals.clicks), "clics"), kpi(N(seo.totals.impressions), "impressions"), kpi(P(seo.totals.ctr * 100, 1), "CTR"), kpi(dec(seo.totals.position), "position moy."), dov ? kpi(N(dov.organic.count), "mots-clés") : "", bl ? kpi(N(bl.referringDomains), "réf. domaines") : ""])
    + panel(spark((seo.byDay || []).map((x) => x.clicks)))
    + ((seo.topQueries || []).length ? `<div style="font-size:11px;color:${MU};margin:8px 0 2px">Requêtes les plus performantes</div><table style="width:100%;border-collapse:collapse;font-size:11px">${seo.topQueries.slice(0, 8).map((q) => `<tr><td style="padding:2px 0">${escapeHtml(q.label)}</td><td style="text-align:right;color:${MU}">pos ${dec(q.position)}</td><td style="text-align:right">${N(q.clicks)} clics</td></tr>`).join("")}</table>` : "")
    + (seoI && (seoI.quickWins || []).length ? par(`Opportunités rapides : ${seoI.quickWins.slice(0, 3).map((q) => "« " + escapeHtml(q.query) + " »").join(", ")} (proches du top, à pousser).`) : ""));
  if (adsT || camps || plc) {
    let inner = "";
    if (adsT) { inner += kband([kpi(E(adsT.totals.spend), "dépense"), kpi(N(adsT.totals.conversions), "conversions"), kpi("×" + (adsT.totals.roas || 0), "ROAS"), kpi((adsT.campaigns || []).length, "campagnes")]); if ((adsT.platformSplit || []).length) inner += `<div style="font-size:11px;color:${MU};margin:8px 0 2px">Répartition par plateforme</div>${bars(adsT.platformSplit.map((x) => ({ label: x.platform, value: x.spend })))}`; }
    else if (camps && camps.campaigns[0]) { const c = camps.campaigns[0]; inner += par(`Campagne « ${escapeHtml(c.name)} » (${escapeHtml(c.channelLabel)}) : <b>${E(c.spend)}</b>, ${N(c.impressions)} impressions, ${N(c.clicks)} clics.`); }
    if (plc && (plc.placements || []).length) {
      arScorePlacements(plc.placements);
      const byT = {}; let tot = 0; for (const pp of plc.placements) { const t = (pp._eff && pp._eff.tier) || "Volume insuffisant"; byT[t] = (byT[t] || 0) + (pp.cost || 0); tot += pp.cost || 0; }
      const order = [["Efficace", "hi"], ["Correct", "mid"], ["Faible", "warn"], ["À exclure", "lo"], ["Volume insuffisant", "na"]];
      const seg = order.filter(([k]) => byT[k] > 0).map(([k, cl]) => `<span style="height:100%;width:${(byT[k] / tot * 100).toFixed(1)}%;background:${TC[cl]}"></span>`).join("");
      const bad = (byT["Faible"] || 0) + (byT["À exclure"] || 0);
      inner += `<div style="font-size:11px;color:${MU};margin:10px 0 3px">Où est parti le budget Display (${N(plc.placements.length)} emplacements)</div><div style="display:flex;height:14px;border-radius:7px;overflow:hidden;gap:1px">${seg}</div>` + (tot > 0 ? par(`Sur ${E(tot)}, <b style="color:${TC.lo}">${E(bad)} (${Math.round(bad / tot * 100)} %)</b> dans des emplacements peu efficaces (« Faible »/« À exclure »).`) : "");
    }
    body += sec("Publicité", inner);
  }
  if (loc && loc.me) {
    const others = (loc.competitors || []).filter((c) => !c.mine);
    body += sec("Notoriété locale",
      par(`<b>${escapeHtml(loc.me.title)}</b> — note ${dec(loc.me.rating)}★ (${N(loc.me.reviews)} avis), classé <b>#${locRank}</b> sur ${others.length + 1} établissements du secteur${loc.sector || loc.keyword ? " « " + escapeHtml(loc.sector || loc.keyword) + " »" : ""}${loc.zone ? " à " + escapeHtml(loc.zone) : ""}.`)
      + (others.length ? `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:4px">${others.slice(0, 5).map((c, i) => `<tr><td style="padding:2px 0;color:${MU}">${i + 1}. ${escapeHtml(c.title)}</td><td style="text-align:right">${dec(c.rating)}★</td><td style="text-align:right">${N(c.reviews)} avis</td></tr>`).join("")}</table>` : ""));
  }
  if (crawl) body += sec("Audit technique du site",
    kband([kpi(crawl.healthScore + "/100", "santé technique"), kpi(N(crawl.pages), "pages"), kpi(N(crawl.indexable), "indexables")])
    + ((crawl.tickets || []).length ? `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px">${crawl.tickets.map((t) => `<tr><td style="padding:2px 0">${escapeHtml(t.label)}</td><td style="text-align:right;color:${t.sev === "high" ? TC.lo : t.sev === "med" ? TC.warn : MU}">${t.count}</td></tr>`).join("")}</table>` : ""));

  const missNames = { "google.web": "Site web", "google.seo": "SEO", "google.adsPlacements": "Emplacements Ads", "google.adsCampaigns": "Campagnes Ads", "meta.overview": "Réseaux sociaux", "si.localCompetitors": "Notoriété", "google.vitals": "Performance", "google.crawl": "Audit technique", "si.domainOverview": "Autorité SEO", "si.backlinks": "Backlinks" };
  const shown = [...new Set((s.missing || []).map((x) => missNames[x]).filter(Boolean))];
  const missNote = shown.length ? `<div style="font-size:10px;color:${MU};margin-top:12px;border-top:1px dashed ${LN};padding-top:8px">Sections non incluses (données non chargées) : ${shown.join(", ")}. Clique « Actualiser les données » ou ouvre les vues correspondantes pour les intégrer.</div>` : "";
  if (!body) body = `<p style="color:${MU};font-size:12px">Aucune donnée réelle en cache pour cette marque. Clique « Actualiser les données », ou ouvre les vues (Site web, SEO, Publicité, Notoriété) pour alimenter le rapport.</p>`;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;color:${INK};padding:26px 30px;background:#fff}h1{font-size:22px;font-weight:700;margin:5px 0 2px}table td{vertical-align:top}@media print{body{padding:0}section{break-inside:avoid}}</style></head><body>
    <header style="border-bottom:3px solid ${A};padding-bottom:12px"><div style="color:${A};font-weight:800;letter-spacing:.16em;font-size:11px">ORPHIC AGENCY · ARGOS</div><h1>Rapport de performance — ${escapeHtml(b.name)}</h1><div style="color:${MU};font-size:11px">30 derniers jours · édité le ${now}</div></header>
    ${kpiBand}${body}${missNote}
    <footer style="margin-top:24px;border-top:1px solid ${LN};padding-top:10px;color:#999;font-size:10px;text-align:center">Généré par Argos · Olympus — Orphic Agency, Monaco</footer>
  </body></html>`;
}

// Champs de clés + libellés par fournisseur (une app peut couvrir plusieurs surfaces)
const AR_PROVIDER_KEYS = {
  meta: [{ k: "app_id", label: "App ID Meta", secret: false }, { k: "app_secret", label: "Clé secrète Meta", secret: true }, { k: "config_id", label: "Configuration ID (Pages + Ads — variante General)", secret: false }, { k: "config_id_instagram", label: "Configuration ID Instagram (variante Instagram Graph API)", secret: false }],
  google: [{ k: "client_id", label: "Client ID", secret: false }, { k: "client_secret", label: "Client secret", secret: true }, { k: "developer_token", label: "Developer token (Ads)", secret: true }],
};
const AR_PROV_LABEL = { meta: "Meta", google: "Google" };
const AR_CONNECTABLE = new Set(["meta", "google"]); // fournisseurs dont le flux OAuth est actif
// Surface utilisée pour déclencher la connexion OAuth d'un fournisseur (n'importe laquelle du
// groupe convient — le connect les branche toutes d'un coup).
const AR_CONNECT_SURFACE = { meta: "facebook", google: "google_analytics" };
// ── Connexions : regroupées par fournisseur (une app développeur → plusieurs surfaces) ──
// ══════════ TITAN — Argos : connexions API (réservé aux gérants) ══════════
async function renderTitanArgosConn() {
  const box = $("titanArgosConn");
  arState = null; const st = await window.olympus.argosState(); if (st.ok) arState = st;
  const conns = Object.values(arState.connections || {});
  // Regroupe les surfaces par fournisseur
  const groups = {};
  conns.forEach((c) => { (groups[c.provider] = groups[c.provider] || []).push(c); });
  let html = `<div class="ar-conns">`;
  for (const [prov, surfaces] of Object.entries(groups)) {
    const keyFields = AR_PROVIDER_KEYS[prov] || [{ k: "app_id", label: "App ID", secret: false }, { k: "app_secret", label: "App Secret", secret: true }];
    const hasKeys = surfaces[0].hasKeys;
    const connectable = AR_CONNECTABLE.has(prov);
    const anyConnected = surfaces.some((s) => s.status === "connected");
    html += `<div class="ar-connc" data-prov="${prov}">
      <div class="ch"><span class="ic">${surfaces.map((s) => s.icon).join(" ")}</span><span class="n">${escapeHtml(AR_PROV_LABEL[prov] || surfaces.map((s) => s.label).join(" · "))}</span>${connectable ? "" : '<span class="tag" style="font-size:9px;color:var(--dim);border:1px solid var(--line);border-radius:20px;padding:2px 8px;">bientôt</span>'}</div>
      <div class="api">${surfaces.map((s) => s.icon + " " + s.label).join("  ·  ")}</div>
      <div class="ar-surfaces">
        ${surfaces.map((s) => `<div class="ar-surf ${s.status === "connected" ? "on" : ""}"><span class="dot"></span>${s.label}${s.status === "connected" ? " — " + escapeHtml(s.account || "connecté") : ""}${s.id === "instagram" && s.status === "connected" ? (s.igScoped ? ' <span style="color:var(--ok);">· données réelles actives</span>' : ' <span style="color:var(--dim);">· connecté mais pas encore de permissions Instagram (voir « Connecter Instagram » ci-dessous)</span>') : ""}</div>`).join("")}
      </div>
      <div class="act">
        <button class="btn sec" data-keys="${prov}" style="padding:6px 14px;font-size:12px;">${hasKeys ? "Modifier les clés" : "Renseigner les clés"}</button>
        ${connectable && hasKeys ? `<button class="cal-btn" data-connect="${prov}" data-surface="${AR_CONNECT_SURFACE[prov] || surfaces[0].id}" style="padding:6px 16px;font-size:12px;">${anyConnected ? "Reconnecter" : "Connecter un compte"}</button>` : ""}
        ${connectable && surfaces[0].hasInstagramConfig ? `<button class="cal-btn" data-connect="${prov}" data-surface="instagram" data-mode="instagram" style="padding:6px 16px;font-size:12px;background:linear-gradient(135deg,#f58529,#dd2a7b,#8134af,#515bd4);">${surfaces.find((s) => s.id === "instagram")?.igScoped ? "Reconnecter Instagram" : "Connecter Instagram"}</button>` : ""}
        <button class="btn sec" data-docs="${surfaces[0].id}" style="padding:6px 14px;font-size:12px;">Voir l'API</button>
        ${anyConnected ? `<button class="btn sec" data-disc="${prov}" style="padding:6px 14px;font-size:12px;">Déconnecter</button>` : ""}
        <span class="msg" data-connmsg="${prov}"></span>
      </div>
      <div class="ar-keys" data-keysform="${prov}" style="display:none;">
        ${keyFields.map((f) => `<input class="mood-in" data-k="${f.k}" placeholder="${f.label}"${f.secret ? ' type="password"' : ""}>`).join("")}
        <div class="pg-actrow"><button class="cal-btn" data-savekeys="${prov}" data-surface="${surfaces[0].id}">Enregistrer</button><span class="msg" data-keymsg="${prov}"></span></div>
      </div>
      <div class="ar-doc" data-docbox="${surfaces[0].id}" style="display:none;"></div>
    </div>`;
  }
  html += `</div>`;
  box.innerHTML = html;
  box.querySelectorAll("[data-keys]").forEach((el) => el.onclick = () => { const f = box.querySelector(`[data-keysform="${el.dataset.keys}"]`); f.style.display = f.style.display === "none" ? "flex" : "none"; });
  box.querySelectorAll("[data-savekeys]").forEach((el) => el.onclick = async () => {
    const prov = el.dataset.savekeys; const f = box.querySelector(`[data-keysform="${prov}"]`);
    const keys = {}; f.querySelectorAll("[data-k]").forEach((i) => { if (i.value.trim()) keys[i.dataset.k] = i.value.trim(); });
    const r = await window.olympus.argosConnSaveKeys(el.dataset.surface, keys);
    const m = box.querySelector(`[data-keymsg="${prov}"]`);
    m.className = "msg " + (r.ok ? "ok" : "err");
    m.textContent = r.ok ? "Clés chiffrées et enregistrées." : (r.error || "Échec.");
    if (r.ok) { arState = null; await renderTitanArgosConn(); }
  });
  box.querySelectorAll("[data-connect]").forEach((el) => el.onclick = async () => {
    const prov = el.dataset.connect; const m = box.querySelector(`[data-connmsg="${prov}"]`);
    el.disabled = true; const label = el.textContent; el.textContent = "En attente…";
    m.className = "msg"; m.textContent = "Le navigateur s'ouvre — autorise l'accès puis reviens ici.";
    const r = await window.olympus.argosConnect(el.dataset.surface, el.dataset.mode);
    el.disabled = false; el.textContent = label;
    if (r.ok) {
      m.className = "msg ok";
      const s = r.summary || {};
      if (el.dataset.connect === "google") {
        m.textContent = `Google connecté${s.email ? " (" + s.email + ")" : ""} : ${s.ga} propriété(s) Analytics, ${s.sc} site(s) Search Console, ${s.ads} compte(s) Ads, ${s.biz} établissement(s) Business.` + ((s.notes && s.notes.length) ? " ⚠ " + s.notes.join(" · ") : "");
      } else {
        m.textContent = el.dataset.mode === "instagram" ? `Instagram connecté : ${s.ig} compte(s) — les vraies données Aperçu/Inbox vont s'activer pour les marques mappées.` : `Connecté : ${s.pages} page(s), ${s.ig} compte(s) Instagram, ${s.ads} compte(s) pub.`;
      }
      arState = null; arInvalidate(); setTimeout(() => renderTitanArgosConn(), 1800);
    } else { m.className = "msg err"; m.textContent = r.error || "Échec de la connexion."; }
  });
  box.querySelectorAll("[data-disc]").forEach((el) => el.onclick = async () => {
    const prov = el.dataset.disc; const surfaces = (arState.connections ? Object.values(arState.connections).filter((s) => s.provider === prov) : []);
    for (const s of surfaces) await window.olympus.argosConnDisconnect(s.id);
    arState = null; arInvalidate(); await renderTitanArgosConn();
  });
  box.querySelectorAll("[data-docs]").forEach((el) => el.onclick = async () => {
    const id = el.dataset.docs; const db = box.querySelector(`[data-docbox="${id}"]`);
    if (db.style.display !== "none") { db.style.display = "none"; return; }
    db.style.display = "block"; db.innerHTML = "Lecture de la documentation…";
    const r = await window.olympus.argosApiDocs(id);
    if (!r.spec) { db.innerHTML = "Documentation à générer."; return; }
    const s = r.spec;
    db.innerHTML = `<div><b>${escapeHtml(s.api_name || "")}</b> ${s.api_version ? "· " + escapeHtml(String(s.api_version).slice(0, 60)) : ""}</div>
      ${s.oauth ? `<div class="ep"><b>OAuth</b> — scopes : ${(s.oauth.scopes || []).slice(0, 8).map((x) => `<code>${escapeHtml(x.scope)}</code>`).join(" ")}</div>` : ""}
      ${(s.endpoints || []).slice(0, 8).map((e) => `<div class="ep"><b>${escapeHtml(e.purpose || e.id).slice(0, 70)}</b><br><code>${escapeHtml(e.method)} ${escapeHtml(e.url_template)}</code></div>`).join("")}
      ${(s.endpoints || []).length > 8 ? `<div class="dim">+ ${(s.endpoints || []).length - 8} autres endpoints documentés</div>` : ""}`;
  });
}

// ══════════ TITAN — Argos : clusters clients par glisser-déposer (réservé aux gérants) ══════════
// Un client = un bouquet d'actifs de N'IMPORTE QUEL réseau (Facebook, Instagram, Meta Ads,
// et demain Google/TikTok/LinkedIn/X — buckets déjà prêts, vides tant que non connectés).
// État de travail local : on glisse/renomme/retire librement, rien n'est persisté tant que
// "Enregistrer" n'est pas cliqué sur la carte du client concerné — SAUF le retrait d'un actif
// d'un client déjà existant (sauvegardé aussitôt en tâche de fond pour ne jamais désynchroniser
// deux clients qui se disputeraient le même compte).
let arClusterBuckets = null, arClusterBrands = null;
function arClusterAssignedMap() {
  const m = new Map();
  (arClusterBrands || []).forEach((b) => (b.assets || []).forEach((a) => m.set(a.network + ":" + a.id, b.name)));
  return m;
}
async function renderTitanArgosClusters() {
  const box = $("titanArgosBrands");
  box.innerHTML = `<div class="msg">Chargement…</div>`;
  const [bucketsR, stateR] = await Promise.all([window.olympus.argosNetworkBuckets(), window.olympus.argosState()]);
  if (!bucketsR.ok || !stateR.ok) { box.innerHTML = `<div class="msg err">${escapeHtml((stateR && stateR.error) || "Échec du chargement.")}</div>`; return; }
  arClusterBuckets = bucketsR.buckets;
  arClusterBrands = JSON.parse(JSON.stringify(stateR.brands || [])); // copie de travail, éditable librement
  arPaintClusters(box);
}
function arPaintClusters(box) {
  const assigned = arClusterAssignedMap();
  const bucketsHtml = arClusterBuckets.map((bucket) => `
    <div class="ar-bucket">
      <div class="ar-bucket-h">${bucket.icon} ${escapeHtml(bucket.label)}${!bucket.connected && !bucket.items.length ? ' <span class="tag" style="font-size:9px;color:var(--dim);border:1px solid var(--line);border-radius:20px;padding:1px 7px;">pas encore connecté</span>' : ""}</div>
      <div class="ar-bucket-items">
        ${bucket.items.length ? bucket.items.map((item) => {
          const owner = assigned.get(bucket.network + ":" + item.id);
          return `<div class="ar-chip${owner ? " owned" : ""}" draggable="true" data-network="${bucket.network}" data-id="${escapeHtml(item.id)}" data-label="${escapeHtml(item.label)}" title="${owner ? "déjà dans « " + escapeHtml(owner) + " » — glisse pour réaffecter" : "glisse vers un client"}${item.sub ? " — " + escapeHtml(item.sub) : ""}">${escapeHtml(item.label)}${item.sub ? ` <span class="ar-chip-sub">${escapeHtml(item.sub)}</span>` : ""}${owner ? ` <span class="ar-chip-owner">· ${escapeHtml(owner)}</span>` : ""}</div>`;
        }).join("") : `<div class="ar-bucket-empty">Aucun compte</div>`}
      </div>
    </div>`).join("");
  const clientsHtml = arClusterBrands.map((b, i) => `
    <div class="ar-cluster-card">
      <div class="ar-cluster-head">
        <input class="ar-cluster-name" data-idx="${i}" value="${escapeHtml(b.name || "")}" placeholder="Nom du client">
        <label class="ar-cluster-vis"><input type="checkbox" data-visidx="${i}" ${!b.hidden ? "checked" : ""}> Visible</label>
        <button class="ga-ic" data-delcluster="${i}" title="Supprimer" style="width:26px;height:26px;font-size:12px;">✕</button>
      </div>
      <div class="ar-cluster-drop" data-dropidx="${i}">
        ${(b.assets || []).length ? b.assets.map((a) => `<div class="ar-chip in-cluster" data-removeasset="${i}" data-network="${a.network}" data-id="${escapeHtml(a.id)}">${arNet(a.network).ic || ""} ${escapeHtml(a.label || a.id)} <span class="ar-chip-x">✕</span></div>`).join("") : `<div class="ar-cluster-empty">Glisse des comptes ici</div>`}
      </div>
      <div class="ar-cluster-actions">
        <button class="cal-btn" data-savecluster="${i}" style="padding:6px 16px;font-size:12px;">Enregistrer</button>
        <span class="msg" data-clustermsg="${i}"></span>
      </div>
    </div>`).join("");
  box.innerHTML = `<div class="ar-buckets-row">${bucketsHtml}</div>
    <div class="ar-clusters-row">${clientsHtml}
      <div class="ar-cluster-card ar-cluster-new" id="arNewClusterCard">＋ Nouveau client</div>
    </div>`;
  arWireClusters(box);
}
// Persiste immédiatement le retrait d'un actif chez un client déjà sauvegardé (id existant) —
// évite qu'un compte reste attribué à deux clients en même temps si l'autre carte n'est jamais
// re-enregistrée.
async function arSilentSyncCluster(brand) {
  if (!brand.id) return;
  await window.olympus.argosBrandSave({ id: brand.id, assets: brand.assets || [] });
  arState = null; arInvalidate(brand.id); // Argos relit l'état, pas de vieux cache pour cette marque
}
function arWireClusters(box) {
  box.querySelectorAll(".ar-bucket-items .ar-chip[draggable]").forEach((chip) => {
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({ network: chip.dataset.network, id: chip.dataset.id, label: chip.dataset.label }));
    });
  });
  const reassign = async (data) => {
    // Retire l'actif de tout client qui l'aurait déjà (et synchronise ce client s'il est déjà persisté)
    for (const bb of arClusterBrands) {
      const before = (bb.assets || []).length;
      bb.assets = (bb.assets || []).filter((a) => !(a.network === data.network && a.id === data.id));
      if (bb.assets.length !== before) await arSilentSyncCluster(bb);
    }
  };
  box.querySelectorAll(".ar-cluster-drop").forEach((zone) => {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault(); zone.classList.remove("drag-over");
      let data; try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
      await reassign(data);
      arClusterBrands[+zone.dataset.dropidx].assets.push(data);
      arPaintClusters(box);
    });
  });
  const newCard = box.querySelector("#arNewClusterCard");
  newCard.addEventListener("dragover", (e) => e.preventDefault());
  newCard.addEventListener("drop", async (e) => {
    e.preventDefault();
    let data; try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { data = null; }
    const name = await arMiniInput(box, "Nom du nouveau client");
    if (!name) return;
    if (data) await reassign(data);
    arClusterBrands.push({ name, secteur: "", networks: {}, assets: data ? [data] : [], hidden: false });
    arPaintClusters(box);
  });
  newCard.addEventListener("click", async () => {
    const name = await arMiniInput(box, "Nom du nouveau client");
    if (!name) return;
    arClusterBrands.push({ name, secteur: "", networks: {}, assets: [], hidden: false });
    arPaintClusters(box);
  });
  box.querySelectorAll("[data-removeasset]").forEach((chip) => chip.onclick = () => {
    const idx = +chip.dataset.removeasset;
    const brand = arClusterBrands[idx];
    brand.assets = (brand.assets || []).filter((a) => !(a.network === chip.dataset.network && a.id === chip.dataset.id));
    arPaintClusters(box);
  });
  box.querySelectorAll(".ar-cluster-name").forEach((inp) => inp.oninput = () => { arClusterBrands[+inp.dataset.idx].name = inp.value; });
  box.querySelectorAll("[data-visidx]").forEach((cb) => cb.onchange = () => { arClusterBrands[+cb.dataset.visidx].hidden = !cb.checked; });
  box.querySelectorAll("[data-delcluster]").forEach((btn) => btn.onclick = async () => {
    const idx = +btn.dataset.delcluster; const brand = arClusterBrands[idx];
    if (brand.id) { if (!confirm(`Supprimer « ${brand.name} » et tout son mapping ?`)) return; await window.olympus.argosBrandDelete(brand.id); }
    arClusterBrands.splice(idx, 1);
    arState = null; arInvalidate(); // Argos doit re-lire la liste au prochain affichage
    arPaintClusters(box);
  });
  box.querySelectorAll("[data-savecluster]").forEach((btn) => btn.onclick = async () => {
    const idx = +btn.dataset.savecluster; const brand = arClusterBrands[idx];
    const m = box.querySelector(`[data-clustermsg="${idx}"]`);
    if (!brand.name || !brand.name.trim()) { m.className = "msg err"; m.textContent = "Nomme le client d'abord."; return; }
    const r = await window.olympus.argosBrandSave({ id: brand.id, name: brand.name.trim(), secteur: brand.secteur || "", networks: brand.networks || {}, assets: brand.assets || [], hidden: !!brand.hidden });
    if (r.ok) {
      brand.id = r.brand.id; m.className = "msg ok"; m.textContent = "Enregistré ✓";
      // Sans ces invalidations, Argos affichait l'ANCIENNE liste jusqu'à un Cmd+R (bug signalé).
      arState = null; arInvalidate(brand.id);
      // La sauvegarde vide le cache de données de cette marque (mapping potentiellement changé)
      // → on re-préchauffe tout de suite en tâche de fond pour que l'arrivée dans Argos soit chaude.
      argosPrewarmAll();
    }
    else { m.className = "msg err"; m.textContent = "Échec de l'enregistrement."; }
  });
}
// Bouton conscient du coût : « Libellé (0,43 €) » — pour toute action déclenchant un appel payant.
const siEur = (n) => (n == null ? "" : (n < 0.01 ? "< 0,01" : n.toFixed(2).replace(".", ",")) + " €");
function siCostBtn(id, label, eur, cls = "btn") { return `<button class="${cls}" id="${id}">${escapeHtml(label)}${eur != null ? ` <span class="si-cost">(${siEur(eur)})</span>` : ""}</button>`; }
// Carte de connexion du fournisseur de données (Titan) : clés chiffrées, test de solde, budget.
async function renderTitanSiConn() {
  const box = $("titanSiConn"); if (!box) return;
  const r = await window.olympus.siStatus();
  if (!r || !r.ok) { box.innerHTML = `<div class="msg err">Search Intelligence indisponible.</div>`; return; }
  const b = r.budget || {};
  const pct = b.hard ? Math.min(100, Math.round((b.spent / b.hard) * 100)) : 0;
  const overSoft = b.soft && b.spent >= b.soft;
  const tarifs = (r.pricing || []).map((p) => `<div class="ga-kv-r"><span>${escapeHtml(p.label)}</span><b>${siEur(p.eur)}</b></div>`).join("");
  const pw = await window.olympus.siPrewarmStatus().catch(() => null);
  const pwp = pw && pw.prewarm;
  const pwCalls = pwp ? (pwp.results || []).reduce((n, x) => n + (x.calls || 0), 0) : 0;
  const pwLast = pwp && pwp.lastAt ? `Dernier : ${new Date(pwp.lastAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${pwCalls} appels` : "jamais lancé";
  box.innerHTML = `
    <div class="ar-conn-card" style="max-width:620px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <b style="font-size:14px;">🔎 ${escapeHtml(r.providerLabel || "DataForSEO")}</b>
        <span class="pg-pill ${r.connected ? "ok" : ""}" style="font-size:11px;">${r.connected ? "connecté · " + escapeHtml(r.login || "") : "non connecté"}</span>
      </div>
      <div class="auth-row2" style="margin-top:6px;">
        <div class="auth-field" style="flex:1"><label>Login (e-mail DataForSEO)</label><input class="auth-input" id="siLogin" value="${escapeHtml(r.login || "")}" placeholder="email@exemple.com"></div>
        <div class="auth-field" style="flex:1"><label>Mot de passe API</label><input class="auth-input" id="siPass" type="password" placeholder="${r.connected ? "•••••••• (inchangé)" : "clé API"}"></div>
      </div>
      <div class="act" style="margin-top:8px;display:flex;gap:8px;align-items:center;">
        <button class="btn" id="siSaveBtn">Enregistrer les clés</button>
        <button class="btn sec" id="siTestBtn">Tester la connexion</button>
        <span class="msg" id="siConnMsg" style="margin:0;"></span>
      </div>
      <label style="display:flex;align-items:center;gap:9px;margin-top:12px;cursor:pointer;font-size:12.5px;color:var(--txt);">
        <input type="checkbox" id="siSandbox" ${r.sandbox ? "checked" : ""}>
        <span>🧪 Mode Sandbox — appels gratuits, données factices (pour tester sans dépenser ni vérifier le compte)</span>
      </label>
      <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
          <b style="font-size:13px;">Budget mensuel</b>
          <span class="desc" style="font-size:12px;">Dépensé : <b style="color:${overSoft ? "#e0868f" : "var(--txt)"}">${siEur(b.spent)}</b> / ${siEur(b.hard)}</span>
        </div>
        <div class="ar-budget" style="margin-bottom:12px;"><i style="width:${pct}%;background:${overSoft ? "#e0868f" : "var(--accent2)"}"></i></div>
        <div class="auth-row2">
          <div class="auth-field" style="flex:1"><label>Alerte à (soft, €)</label><input class="auth-input" id="siSoft" type="number" min="0" step="1" value="${b.soft ?? 20}"></div>
          <div class="auth-field" style="flex:1"><label>Blocage à (hard, €)</label><input class="auth-input" id="siHard" type="number" min="0" step="1" value="${b.hard ?? 50}"></div>
          <div style="display:flex;align-items:flex-end;"><button class="btn sec" id="siBudgetBtn">Enregistrer</button></div>
        </div>
      </div>
      <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <b style="font-size:13px;">Rafraîchissement hebdomadaire</b>
          <span class="desc" style="font-size:11.5px;">${escapeHtml(pwLast)}</span>
        </div>
        <p class="desc" style="font-size:11.5px;margin:0 0 10px;">Chaque <b>lundi à 01:00</b>, toutes les données payantes de chaque client (vue d'ensemble, backlinks, concurrents, et le classement de chaque mot-clé) sont récupérées et mises en cache <b>7 jours</b> — la loupe et les vues s'affichent alors instantanément, sans nouvel appel. Cache répliqué dans Supabase ${pw && pw.cloud ? "(session active ✓)" : "— <b>connecte-toi à Olympus</b> pour la persistance/partage"}.</p>
        <label style="display:flex;align-items:center;gap:9px;margin-bottom:10px;cursor:pointer;font-size:12.5px;color:var(--txt);">
          <input type="checkbox" id="siAuto" ${!pw || pw.auto !== false ? "checked" : ""}>
          <span>Rafraîchir automatiquement (rattrapage au lancement si l'app était fermée à 01:00)</span>
        </label>
        <div class="act" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn sec" id="siPrewarmBtn">Lancer le rafraîchissement maintenant</button>
          <button class="btn sec" id="siCloudSqlBtn">Installer le cache Supabase</button>
          <span class="msg" id="siPwMsg" style="margin:0;"></span>
        </div>
        <div id="siCloudSqlBox" style="display:none;margin-top:12px;"></div>
      </div>
      <details style="margin-top:14px;"><summary class="desc" style="cursor:pointer;font-size:12px;">Voir les tarifs à l'appel</summary>
        <div class="ga-kv" style="margin-top:8px;">${tarifs}</div>
        <p class="desc" style="font-size:11px;margin-top:8px;">Tarifs indicatifs par requête (convertis en €). Chaque action affichera son coût estimé avant exécution.</p>
      </details>
    </div>`;
  const msg = $("siConnMsg");
  $("siSaveBtn").onclick = async () => {
    msg.className = "msg"; msg.textContent = "Enregistrement…";
    const rr = await window.olympus.siSaveKeys($("siLogin").value, $("siPass").value);
    if (rr.ok) { msg.className = "msg ok"; msg.textContent = "Clés enregistrées."; $("siPass").value = ""; renderTitanSiConn(); }
    else { msg.className = "msg err"; msg.textContent = "Échec."; }
  };
  $("siTestBtn").onclick = async () => {
    msg.className = "msg"; msg.textContent = "Test en cours…";
    const rr = await window.olympus.siTest();
    if (rr && rr.ok) { msg.className = "msg ok"; msg.textContent = `Connecté ✓ — solde ${rr.balance != null ? rr.balance + " " + rr.currency : "?"}`; }
    else { msg.className = "msg err"; msg.textContent = "Échec : " + ((rr && rr.error) || "vérifie les identifiants"); }
  };
  $("siBudgetBtn").onclick = async () => {
    const rr = await window.olympus.siSetBudget($("siSoft").value, $("siHard").value);
    msg.className = "msg ok"; msg.textContent = "Budget mis à jour."; if (rr.ok) renderTitanSiConn();
  };
  $("siSandbox").onchange = async (e) => {
    await window.olympus.siSetSandbox(e.target.checked);
    msg.className = "msg ok"; msg.textContent = e.target.checked ? "Sandbox activé — appels gratuits." : "Sandbox désactivé — appels réels facturés.";
  };
  const pwMsg = $("siPwMsg");
  $("siAuto").onchange = async (e) => {
    await window.olympus.siSetPrewarmAuto(e.target.checked);
    pwMsg.className = "msg ok"; pwMsg.textContent = e.target.checked ? "Rafraîchissement auto activé." : "Rafraîchissement auto désactivé.";
  };
  $("siPrewarmBtn").onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Rafraîchissement…";
    pwMsg.className = "msg"; pwMsg.textContent = "En cours (peut prendre 1–2 min)…";
    const rr = await window.olympus.siPrewarmNow();
    btn.disabled = false; btn.textContent = "Lancer le rafraîchissement maintenant";
    if (rr && rr.ok) {
      const calls = (rr.results || []).reduce((n, x) => n + (x.calls || 0), 0);
      const blocked = (rr.results || []).some((x) => x.budgetBlocked);
      pwMsg.className = "msg ok"; pwMsg.textContent = `${(rr.results || []).length} client(s), ${calls} appels${blocked ? " — budget atteint, arrêt" : ""} · budget ${siEur(rr.budget && rr.budget.spent)}`;
      setTimeout(() => renderTitanSiConn(), 900);
    } else { pwMsg.className = "msg err"; pwMsg.textContent = "Échec : " + ((rr && rr.error) || "réessaie"); }
  };
  $("siCloudSqlBtn").onclick = async () => {
    const sb = $("siCloudSqlBox");
    if (sb.style.display === "block") { sb.style.display = "none"; return; }
    const rr = await window.olympus.siCloudSql();
    if (!rr || !rr.ok) { pwMsg.className = "msg err"; pwMsg.textContent = "SQL indisponible."; return; }
    sb.style.display = "block";
    sb.innerHTML = `<p class="desc" style="font-size:11.5px;margin:0 0 8px;">À exécuter <b>une seule fois</b> dans le SQL Editor du Supabase Olympus, puis reviens : le cache sera persistant et partagé.</p>
      <pre style="background:var(--bg-soft,#f4f4f6);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:11px;overflow:auto;max-height:200px;white-space:pre;">${escapeHtml(rr.sql)}</pre>
      <div class="act" style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn" id="siSqlCopy">Copier le SQL</button>
        ${rr.editor ? `<button class="btn sec pg-open" data-url="${escapeHtml(rr.editor)}">Ouvrir le SQL Editor ↗</button>` : ""}
        <span class="msg" id="siSqlMsg" style="margin:0;"></span>
      </div>`;
    $("siSqlCopy").onclick = async () => { await navigator.clipboard.writeText(rr.sql); const m = $("siSqlMsg"); m.className = "msg ok"; m.textContent = "SQL copié — colle-le dans le SQL Editor, exécute, puis reviens."; };
    sb.querySelectorAll(".pg-open").forEach((b) => { b.onclick = () => window.olympus.openExternal(b.dataset.url); });
  };
}
document.querySelector('.nav-item[data-page="titan"]').addEventListener("click", () => { renderTitanArgosConn(); renderTitanArgosClusters(); renderTitanSiConn(); });

// ── Nouvelle marque ──
// Édition légère (nom/secteur/identifiants d'affichage) — le rattachement aux vrais comptes
// réseaux (Facebook, Instagram, Ads, Google…) se fait désormais par glisser-déposer dans
// Titan → Argos — Clients, réservé aux gérants.
function arBrandModal(brand) {
  brand = brand || {};
  const ov = document.createElement("div"); ov.className = "modal-overlay show";
  const nets = ["instagram", "facebook", "tiktok", "linkedin", "x", "youtube"];
  const assetCount = (brand.assets || []).length;
  ov.innerHTML = `<div class="modal-panel" style="width:520px;">
    <div class="modal-head"><h2>${brand.id ? "Modifier le client" : "Nouveau client"}</h2><button class="modal-x" data-x>✕</button></div>
    <div class="modal-body">
      <div class="auth-field"><label>Nom</label><input class="auth-input" id="arBrName" value="${escapeHtml(brand.name || "")}" placeholder="Nom du client"></div>
      <div class="auth-row2" style="margin-top:6px;">
        <div class="auth-field" style="flex:1;"><label>Secteur d'activité <span style="color:var(--dim);font-weight:400;">(optionnel)</span></label><input class="auth-input" id="arBrSect" value="${escapeHtml(brand.secteur || "")}" placeholder="restaurant, hôtellerie, mode…"></div>
        <div class="auth-field" style="flex:1;"><label>Zone <span style="color:var(--dim);font-weight:400;">(optionnel)</span></label><input class="auth-input" id="arBrZone" value="${escapeHtml(brand.zone || "")}" placeholder="Monaco, Nice, Paris 8e…"></div>
      </div>
      <div class="ga-note" style="margin-top:4px;font-size:11px;">Servent à trouver les <b>vrais concurrents locaux</b> (via Google Maps). <b>Laissés vides</b>, ils sont <b>déduits automatiquement</b> de la campagne (zone = géociblage, secteur = mots-clés). À remplir seulement pour affiner.</div>
      <div class="mq-label" style="margin-top:6px;">Identifiants affichés (facultatif — juste pour l'affichage)</div>
      ${nets.map((n) => `<div class="auth-field" style="margin-top:6px;"><label>${arNet(n).ic} ${arNet(n).label}</label><input class="auth-input" data-brnet="${n}" value="${escapeHtml((brand.networks || {})[n] || "")}" placeholder="@compte"></div>`).join("")}
      <div class="ga-note" style="margin-top:14px;">${assetCount ? `${assetCount} compte(s) réseau relié(s)` : "Aucun compte réseau relié"} — pour connecter les vrais comptes (Facebook, Instagram, Ads…), utilise <b>Titan → Argos — Clients</b> (glisser-déposer, réservé aux gérants).</div>
      <div class="pg-actrow" style="margin-top:14px;">
        <button class="cal-btn primary" id="arBrSave">${brand.id ? "Enregistrer" : "Créer le client"}</button>
        ${brand.id ? '<button class="btn sec" id="arBrDel" style="color:#e0868f;">Supprimer</button>' : ""}
      </div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelector("#arBrSave").onclick = async () => {
    const name = ov.querySelector("#arBrName").value.trim();
    if (!name) return;
    const networks = {};
    ov.querySelectorAll("[data-brnet]").forEach((i) => { if (i.value.trim()) networks[i.dataset.brnet] = i.value.trim(); });
    const r = await window.olympus.argosBrandSave({ id: brand.id, name, secteur: ov.querySelector("#arBrSect").value.trim(), zone: ov.querySelector("#arBrZone").value.trim(), networks });
    arState = null; if (r.ok && r.brand) arBrand = r.brand.id; arInvalidate();
    close(); renderArgos();
  };
  const del = ov.querySelector("#arBrDel");
  if (del) del.onclick = async () => {
    if (!confirm(`Supprimer « ${brand.name} » et ses posts programmés ?`)) return;
    await window.olympus.argosBrandDelete(brand.id);
    arState = null; arBrand = null; arInvalidate(); close(); renderArgos();
  };
}
{ const nb = $("setNewBrand"); if (nb) nb.onclick = () => arBrandModal(); }
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

// ══════════ ÉOLE — transfert de fichiers (WeTransfer interne) ══════════
let eolePicked = null; // { files:[{path,name,size}], totalSize }
const eoleFmtSize = (b) => { b = +b || 0; if (b >= 1e9) return (b / 1e9).toFixed(1) + " Go"; if (b >= 1e6) return (b / 1e6).toFixed(1) + " Mo"; if (b >= 1e3) return (b / 1e3).toFixed(0) + " Ko"; return b + " o"; };
const eoleDaysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
async function renderEole() {
  const box = $("eoleBody"); if (!box) return;
  box.innerHTML = `<div class="ga-note">Lecture des transferts…</div>`;
  const list = await window.olympus.eoleList();
  if (!list.ok && list.missing_table) {
    const setup = await window.olympus.eoleSetupSql();
    box.innerHTML = `<div class="pg-setup">
      <p><b>Éole n'est pas encore activé.</b><br>Une table + un espace de stockage doivent être créés une fois dans le Supabase d'Olympus. Colle le SQL <kbd>eole.sql</kbd> dans le SQL Editor, exécute, puis reviens.</p>
      <div class="act">${setup.sql ? '<button class="cal-btn primary" id="eoleSqlCopy">Copier le SQL</button>' : ""}${setup.editor ? `<button class="btn sec pg-open" data-url="${escapeHtml(setup.editor)}" style="padding:8px 16px;font-size:12.5px;">Ouvrir le SQL Editor ↗</button>` : ""}</div>
      <div class="msg" id="eoleSqlMsg"></div></div>`;
    const cp = $("eoleSqlCopy"); if (cp) cp.onclick = async () => { await navigator.clipboard.writeText(setup.sql); const m = $("eoleSqlMsg"); m.className = "msg ok"; m.textContent = "SQL copié — colle-le dans le SQL Editor, exécute, puis reviens."; };
    box.querySelectorAll(".pg-open").forEach((b) => b.onclick = () => window.olympus.openExternal(b.dataset.url));
    return;
  }
  if (!list.ok) { box.innerHTML = `<div class="ga-note">${escapeHtml(list.error || "Indisponible.")}</div>`; return; }
  const transfers = list.transfers || [];
  box.innerHTML = `
    <div class="eole-new">
      <button class="eole-drop" id="eolePick">
        <div class="eole-drop-i">⤒</div>
        <div class="eole-drop-t">Choisir des fichiers à envoyer</div>
        <div class="eole-drop-s">Ils seront zippés et stockés 1 mois</div>
      </button>
      <div class="eole-form">
        <div id="eoleFiles"></div>
        <input class="mood-in" id="eoleTitle" placeholder="Titre (optionnel) — ex : Livraison shoot Riviera">
        <textarea class="mood-in mood-ta" id="eoleNote" placeholder="Message au destinataire (optionnel)"></textarea>
        <div class="pg-actrow"><button class="cal-btn primary" id="eoleSend" disabled>Créer le lien</button><span class="msg" id="eoleMsg"></span></div>
        <div id="eoleResult"></div>
      </div>
    </div>
    <div class="pg-sub">Transferts actifs${transfers.length ? " · " + transfers.length : ""}</div>
    <div id="eoleList"></div>`;
  $("eolePick").onclick = eoleDoPick;
  $("eoleSend").onclick = eoleDoSend;
  eoleRenderPicked();
  eoleFillList(transfers);
}
function eoleRow(t) {
  const n = (t.files || []).length;
  return `<div class="eole-item">
    <div class="eole-item-main">
      <div class="eole-item-t">${escapeHtml(t.title || "Sans titre")}</div>
      <div class="eole-item-s">${n} fichier${n > 1 ? "s" : ""} · ${eoleFmtSize(t.size_total)} · expire dans ${eoleDaysLeft(t.expires_at)} j${t.created_by ? " · " + escapeHtml(t.created_by) : ""}</div>
    </div>
    <button class="btn sec eole-copy" data-url="${escapeHtml(t.signed_url || "")}">Copier le lien</button>
    <button class="ga-ic eole-open" data-url="${escapeHtml(t.signed_url || "")}" title="Ouvrir">↓</button>
    <button class="ga-ic eole-del" data-id="${t.id}" data-obj="${escapeHtml(t.object_path || "")}" title="Supprimer">✕</button>
  </div>`;
}
function eoleFillList(transfers) {
  const box = $("eoleList"); if (!box) return;
  box.innerHTML = transfers.length ? transfers.map(eoleRow).join("") : '<div class="ga-note">Aucun transfert actif. Crée-en un ci-dessus.</div>';
  box.querySelectorAll(".eole-copy").forEach((b) => b.onclick = () => eoleCopy(b));
  box.querySelectorAll(".eole-open").forEach((b) => b.onclick = () => window.olympus.openExternal(b.dataset.url));
  box.querySelectorAll(".eole-del").forEach((b) => b.onclick = () => eoleDel(b.dataset.id, b.dataset.obj));
}
async function eoleRefreshList() { const r = await window.olympus.eoleList(); if (r.ok) eoleFillList(r.transfers || []); }
function eoleRenderPicked() {
  const box = $("eoleFiles"), send = $("eoleSend"); if (!box) return;
  if (!eolePicked || !eolePicked.files.length) { box.innerHTML = ""; if (send) send.disabled = true; return; }
  box.innerHTML = `<div class="eole-chips">${eolePicked.files.map((f, i) => `<span class="eole-chip">${escapeHtml(f.name)} <small>${eoleFmtSize(f.size)}</small><button data-rm="${i}">✕</button></span>`).join("")}<span class="eole-total">${eolePicked.files.length} fichier(s) · ${eoleFmtSize(eolePicked.totalSize)}</span></div>`;
  box.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { eolePicked.files.splice(+b.dataset.rm, 1); eolePicked.totalSize = eolePicked.files.reduce((n, f) => n + f.size, 0); eoleRenderPicked(); });
  if (send) send.disabled = false;
}
async function eoleDoPick() {
  const r = await window.olympus.eolePick();
  if (!r.ok) return;
  const merged = [...(eolePicked?.files || [])];
  for (const f of r.files) if (!merged.some((x) => x.path === f.path)) merged.push(f);
  eolePicked = { files: merged, totalSize: merged.reduce((n, f) => n + f.size, 0) };
  eoleRenderPicked();
}
async function eoleDoSend() {
  if (!eolePicked?.files.length) return;
  const btn = $("eoleSend"), msg = $("eoleMsg");
  btn.disabled = true; btn.textContent = "Envoi…"; msg.className = "msg"; msg.textContent = "Compression + envoi… (selon la taille)";
  const r = await window.olympus.eoleSend({ paths: eolePicked.files.map((f) => f.path), title: $("eoleTitle").value.trim(), note: $("eoleNote").value.trim(), days: 30 });
  btn.disabled = false; btn.textContent = "Créer le lien";
  if (!r.ok) { msg.className = "msg err"; msg.textContent = r.error || "Échec."; return; }
  msg.className = "msg ok"; msg.textContent = "Lien créé — valable 1 mois.";
  const url = r.transfer.signed_url;
  $("eoleResult").innerHTML = `<div class="eole-link"><input class="mood-in" id="eoleLinkIn" readonly value="${escapeHtml(url)}"><button class="cal-btn primary" id="eoleLinkCopy">Copier</button></div>`;
  $("eoleLinkCopy").onclick = async () => { await navigator.clipboard.writeText(url); const m = $("eoleMsg"); m.className = "msg ok"; m.textContent = "Lien copié dans le presse-papier."; };
  $("eoleLinkIn").onclick = (e) => e.target.select();
  eolePicked = null; $("eoleTitle").value = ""; $("eoleNote").value = "";
  eoleRenderPicked(); eoleRefreshList();
}
async function eoleCopy(b) { await navigator.clipboard.writeText(b.dataset.url); const t = b.textContent; b.textContent = "Copié ✓"; setTimeout(() => b.textContent = t, 1400); }
async function eoleDel(id, obj) {
  if (!confirm("Supprimer ce transfert ? Le lien ne fonctionnera plus.")) return;
  await window.olympus.eoleDelete(id, obj);
  eoleRefreshList();
}
document.querySelector('.nav-item[data-page="eole"]').addEventListener("click", renderEole);

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
    { id: "n4", title: "Process livraison client", body: "1. Sélection dans Apollon (48 h après le shoot)\n2. Retouche fine (5 j ouvrés)\n3. Upload Atlas → dossier client\n4. Mail Athéna avec lien + suivi d'ouverture\n5. Événement « Rendu » dans Chronos\n6. Facture à J+3 après livraison", when: d(9), pinned: false, people: ["Lucas Dubois", "Astrid Berges"], event: null },
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

// ══════════ Iris — accueil / assistante IA ══════════
// (Renommage 2026 : l'assistant s'appelle « Iris » à l'écran. Préfixes internes `at*` + ids `rbAthena*`/`ic-athena`
//  conservés pour éviter un refactor risqué. « Athéna » désigne désormais le MAIL, dont le code reste préfixé `ir*`/`page-iris`.)
let atMessages = [];   // historique multi-tours envoyé à l'API [{role, content}]
let atBusy = false;
// Sélecteur de modèle façon Claude Code (choix réel du modèle Claude utilisé par Athéna).
const AT_MODELS = [
  { id: "claude-opus-4-8", name: "Opus 4.8", sub: "Le plus puissant" },
  { id: "claude-sonnet-5", name: "Sonnet 5", sub: "Équilibré" },
  { id: "claude-haiku-4-5", name: "Haiku 4.5", sub: "Rapide & économique" },
];
let atModel = localStorage.getItem("athenaModel") || "claude-sonnet-5";
if (!AT_MODELS.some((m) => m.id === atModel)) atModel = "claude-sonnet-5";
function atModelLabel(id) { const m = AT_MODELS.find((x) => x.id === id); return m ? m.name : "Sonnet 5"; }
function atRenderModel() { const el = $("atModelName"); if (el) el.textContent = atModelLabel(atModel); }
function atModelMenu(anchor) {
  document.querySelectorAll(".at-modelmenu").forEach((m) => m.remove());
  const menu = document.createElement("div"); menu.className = "at-modelmenu";
  menu.innerHTML = AT_MODELS.map((m) => `<div class="at-mm-item${m.id === atModel ? " on" : ""}" data-model="${m.id}"><span class="mm-check">✓</span><span>${m.name}</span><span class="mm-sub">${m.sub}</span></div>`).join("");
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(10, Math.min(r.left, window.innerWidth - menu.offsetWidth - 10)) + "px";
  menu.style.top = (r.top - menu.offsetHeight - 8) + "px";
  menu.querySelectorAll("[data-model]").forEach((it) => it.onclick = () => { atModel = it.dataset.model; localStorage.setItem("athenaModel", atModel); atRenderModel(); menu.remove(); });
  setTimeout(() => { const close = (e) => { if (!e.target.closest(".at-modelmenu") && e.target !== anchor && !anchor.contains(e.target)) { menu.remove(); document.removeEventListener("mousedown", close, true); } }; document.addEventListener("mousedown", close, true); }, 0);
}
function atGreeting() {
  const h = new Date().getHours();
  const g = h < 5 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
  const first = (currentUserName || "").trim().split(/\s+/)[0] || "";
  const el = $("atHello"); if (el) el.textContent = first ? `${g} ${first}` : g;
}
function atMd(t) { return escapeHtml(String(t || "")).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"); }
function atScrollBottom() { const s = $("atScroll"); if (s) s.scrollTop = s.scrollHeight; }
function atAutosize() { const t = $("atInput"); if (!t) return; t.style.height = "auto"; t.style.height = Math.min(160, t.scrollHeight) + "px"; }
function atAddMsg(role, text) {
  $("atWrap").classList.add("chatting");
  const el = document.createElement("div");
  el.className = "at-msg " + (role === "user" ? "user" : "ai");
  el.innerHTML = (role === "user" ? "" : `<div class="at-av">✦</div>`) + `<div class="at-bubble">${atMd(text)}</div>`;
  $("atThread").appendChild(el); atScrollBottom();
}
function atTyping(on) {
  let t = document.getElementById("atTypingRow");
  if (on) { if (t) return; t = document.createElement("div"); t.id = "atTypingRow"; t.className = "at-msg ai"; t.innerHTML = `<div class="at-av">✦</div><div class="at-bubble"><span class="at-typing"><i></i><i></i><i></i></span></div>`; $("atThread").appendChild(t); atScrollBottom(); }
  else if (t) t.remove();
}
// Contexte temps réel injecté dans le prompt : agenda du jour + à venir, chats non lus, mails à traiter.
async function atGatherContext() {
  const lines = [], now = new Date();
  const iso = (d) => isoD(d.getFullYear(), d.getMonth(), d.getDate());
  const today = iso(now);
  lines.push("Date : " + now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + ".");
  try {
    const far = new Date(now.getTime() + 8 * 864e5);
    const r = await window.olympus.chronosList(today, iso(far));
    const evs = (r.ok ? r.events : []).filter((e) => !e.done);
    const todayEv = evs.filter((e) => e.date === today).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    const soon = evs.filter((e) => e.date > today).sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "")).slice(0, 8);
    lines.push(`\nAGENDA D'AUJOURD'HUI (${todayEv.length}) :`);
    lines.push(todayEv.length ? todayEv.map((e) => ` - ${e.time ? e.time.slice(0, 5) : "journée"}${e.end_time ? "–" + e.end_time.slice(0, 5) : ""} · ${e.title}${e.location ? " (" + e.location + ")" : ""}`).join("\n") : " (rien de prévu)");
    if (soon.length) lines.push("\nÀ VENIR (prochains jours) :\n" + soon.map((e) => ` - ${rbDM(e.date)}${e.time ? " " + e.time.slice(0, 5) : ""} · ${e.title}`).join("\n"));
  } catch {}
  try {
    const un = (typeof hmConvs !== "undefined" ? hmConvs : []).filter((c) => c.unread > 0);
    if (un.length) lines.push("\nCHATS NON LUS (Hermès) :\n" + un.map((c) => ` - ${c.name} (${c.unread} message${c.unread > 1 ? "s" : ""})`).join("\n"));
  } catch {}
  try {
    const unread = (typeof irMails !== "undefined" ? irMails : []).filter((m) => m.dir === "in" && m.unread && !m.trash).slice(0, 8);
    if (unread.length) lines.push("\nE-MAILS À TRAITER (Athéna) :\n" + unread.map((m) => ` - ${m.toName || m.to} — « ${m.subject} »${m.client ? " [" + m.client + "]" : ""}`).join("\n"));
  } catch {}
  return lines.join("\n");
}
async function atSend(text) {
  text = (text != null ? text : $("atInput").value).trim();
  if (!text || atBusy) return;
  if (!(await aiEnsureKey())) return;
  atBusy = true; $("atSend").disabled = true;
  $("atInput").value = ""; atAutosize();
  atAddMsg("user", text);
  atMessages.push({ role: "user", content: text });
  atTyping(true);
  const context = await atGatherContext();
  const r = await window.olympus.aiChat({ messages: atMessages, context, userName: currentUserName, model: atModel }).catch((e) => ({ ok: false, error: String(e) }));
  atTyping(false); atBusy = false; $("atSend").disabled = false;
  if (!r || !r.ok) {
    atMessages.pop();
    if (r && r.needKey) { if (await aiKeyModal()) return atSend(text); return; }
    atAddMsg("ai", "⚠️ " + ((r && r.error) || "Je n'ai pas pu répondre pour le moment."));
    return;
  }
  atMessages.push({ role: "assistant", content: r.text });
  atAddMsg("ai", r.text);
  atPersist();   // sauvegarde la conversation (reprise possible depuis la colonne de droite)
  if (r.cost) { const c = $("atCost"); if (c) { c.textContent = "Dernière requête : " + aiFmtCost(r.cost); c.title = `Entrée ${r.cost.inTok} · sortie ${r.cost.outTok} tokens (estimé)`; } }
  $("atInput").focus();
}
function atNewConversation() {
  atConvId = null; atMessages = []; $("atThread").innerHTML = ""; $("atWrap").classList.remove("chatting");
  const c = $("atCost"); if (c) c.textContent = "";
  $("atInput").value = ""; atAutosize(); $("atInput").focus();
}
// ── Persistance des conversations Athéna (localStorage) : reprendre / démarrer ──
let atConvId = null;
function atLoadConvs() { try { return JSON.parse(localStorage.getItem("athenaConvs") || "[]"); } catch { return []; } }
function atSaveConvs(list) { try { localStorage.setItem("athenaConvs", JSON.stringify(list.slice(0, 80))); } catch {} }
function atConvTitle(msgs) { const f = msgs.find((m) => m.role === "user"); const t = ((f ? f.content : "Conversation") || "Conversation").replace(/\s+/g, " ").trim() || "Conversation"; return t.length > 48 ? t.slice(0, 48) + "…" : t; }
function atRelTime(ts) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return "il y a " + min + " min";
  if (min < 1440) return "il y a " + Math.floor(min / 60) + " h";
  const days = Math.floor(min / 1440);
  if (days === 1) return "hier";
  if (days < 7) return "il y a " + days + " j";
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function atPersist() {
  if (!atMessages.length) return;
  const list = atLoadConvs();
  if (!atConvId) atConvId = "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const conv = { id: atConvId, title: atConvTitle(atMessages), messages: atMessages.slice(), updated: Date.now() };
  const idx = list.findIndex((c) => c.id === atConvId);
  if (idx >= 0) list[idx] = conv; else list.unshift(conv);
  list.sort((a, b) => b.updated - a.updated);
  atSaveConvs(list);
  if (typeof rbView !== "undefined" && rbView === 3) rbRenderAthenaConvs();
}
function atOpenConv(id) {
  const conv = atLoadConvs().find((c) => c.id === id); if (!conv) return;
  atConvId = conv.id; atMessages = (conv.messages || []).slice();
  $("atThread").innerHTML = ""; $("atWrap").classList.add("chatting");
  for (const m of atMessages) atAddMsg(m.role === "assistant" ? "ai" : "user", m.content);
  const c = $("atCost"); if (c) c.textContent = "";
  goTo("home"); setTimeout(atScrollBottom, 60);
}
function atStartNew() { atNewConversation(); goTo("home"); setTimeout(() => $("atInput").focus(), 40); }
// Vue « Conversations Athéna » de la colonne droite (4e onglet)
function rbRenderAthenaConvs() {
  const el = $("rbAthenaConvs"); if (!el) return;
  const list = atLoadConvs();
  el.innerHTML = list.length ? list.map((c) => {
    const n = (c.messages || []).filter((m) => m.role === "user").length;
    return `<div class="rb-conv${c.id === atConvId ? " on" : ""}" data-atconv="${escapeHtml(c.id)}">
      <div class="rb-conv-main"><div class="rb-conv-t">${escapeHtml(c.title)}</div>
      <div class="rb-conv-m">${escapeHtml(atRelTime(c.updated))} · ${n} message${n > 1 ? "s" : ""}</div></div>
      <button class="rb-conv-del" data-atdel="${escapeHtml(c.id)}" title="Supprimer">✕</button>
    </div>`;
  }).join("") : '<div class="rb-empty">Aucune conversation pour l\'instant.</div>';
}
(function wireAthena() {
  const inp = $("atInput"); if (!inp) return;
  inp.addEventListener("input", atAutosize);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); atSend(); } });
  $("atSend").onclick = () => atSend();
  $("atSugs").addEventListener("click", (e) => { const b = e.target.closest("[data-sug]"); if (b) atSend(b.dataset.sug); });
  $("atNew").onclick = atNewConversation;
  $("atModelBtn").onclick = (e) => atModelMenu(e.currentTarget);
  atRenderModel();
})();

// ══════════ Bouton version / mise à jour (bas de la barre latérale) ══════════
(function initUpdateBtn() {
  const btn = $("navUpdate"); if (!btn) return;
  const sub = $("nuSub"), ic = $("nuIc");
  let available = false, updating = false;
  window.olympus.appInfo().then((i) => { if (i && !available) sub.textContent = "v" + i.version + " · à jour"; }).catch(() => {});
  async function check(manual) {
    if (updating) return;
    btn.classList.add("checking"); if (manual) sub.textContent = "Vérification…";
    const r = await window.olympus.appCheckUpdate().catch(() => ({ ok: false }));
    btn.classList.remove("checking");
    if (r && r.ok && r.updateAvailable) {
      available = true; btn.classList.add("available"); ic.textContent = "↑";
      sub.textContent = "Mise à jour dispo" + (r.latest ? " · v" + r.latest : "");
    } else {
      available = false; btn.classList.remove("available"); ic.textContent = "✓";
      const cur = r && r.current; sub.textContent = cur ? "v" + cur + " · à jour" : "à jour";
      if (manual && r && !r.ok) { ic.textContent = "⟳"; sub.textContent = "Vérif. impossible"; }
    }
  }
  async function doUpdate() {
    if (!available || updating) return;
    updating = true; btn.classList.remove("available"); btn.classList.add("updating", "checking"); ic.textContent = "⟳";
    sub.textContent = "Mise à jour…";
    const r = await window.olympus.appDoUpdate().catch((e) => ({ ok: false, error: String(e) }));
    if (!r || !r.ok) {   // si ok, l'app redémarre toute seule
      updating = false; btn.classList.remove("updating", "checking"); available = true; btn.classList.add("available"); ic.textContent = "↑"; sub.textContent = "Échec — réessayer";
      if (typeof atToast === "function") atToast("Échec de la mise à jour : " + ((r && r.error) || "inconnu"));
    }
  }
  btn.onclick = () => { if (available) doUpdate(); else check(true); };
  btn.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); btn.click(); } };
  setTimeout(() => check(false), 1800);                 // 1er contrôle peu après le lancement
  setInterval(() => check(false), 20 * 60 * 1000);      // puis toutes les 20 min
})();

function enterHub(user) {
  currentRole = user.role || "classic";
  currentUserId = user.id || null;
  $("auth").classList.add("hidden");
  $("hub").classList.remove("hidden");
  const name = ((user.first_name || "") + " " + (user.last_name || "")).trim() || user.email;
  currentUserName = name;
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
  refreshLocks(); refreshEnv(); refreshTitan(); startChat(); renderChronos(); renderWheel(); startPresence(); refreshIris(); refreshClaude(); refreshConnections(); argosPrewarmAll();
  renderArgos(); renderAtlas(); renderApollon(); renderMnemosyne();   // pré-rendu des apps de l'espace de travail
  if (currentRole === "super_admin") refreshMembers();
  atGreeting();
  goTo("home");
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
