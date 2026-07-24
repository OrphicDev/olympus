// Client Anthropic (Claude) natif d'Olympus — autonome, sans dépendance au projet Zevs.
// SDK officiel + client réutilisé entre les appels (keep-alive HTTP : évite de renégocier
// une connexion TLS à chaque requête). La clé API est fournie par l'appelant (jamais stockée ici).
const AnthropicPkg = require("@anthropic-ai/sdk");
const Anthropic = AnthropicPkg.default || AnthropicPkg;     // interop ESM/CJS selon la version du SDK

// Identifiants de modèles (mêmes que la plateforme Anthropic).
const MODELS = { sonnet: "claude-sonnet-5", opus: "claude-opus-4-8", haiku: "claude-haiku-4-5" };

let _client = null, _key = null;
function clientFor(apiKey) {
  if (!apiKey) throw new Error("Clé API Claude manquante.");
  if (!_client || _key !== apiKey) { _client = new Anthropic({ apiKey }); _key = apiKey; }
  return _client;
}

// Tarifs API (USD par million de tokens) — pour estimer le coût d'une requête.
const PRICING = {
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};
const USD_EUR = 0.92;
function costOf(model, usage) {
  const p = PRICING[model] || PRICING["claude-sonnet-5"];
  const inTok = (usage && usage.input_tokens) || 0, outTok = (usage && usage.output_tokens) || 0;
  const usd = (inTok * p.in + outTok * p.out) / 1e6;
  return { usd, eur: usd * USD_EUR, inTok, outTok };
}

// Appel générique « un tour » : system + message utilisateur → { text, usage, cost, model }.
async function message({ apiKey, model = MODELS.sonnet, system, user, maxTokens = 800 }) {
  const client = clientFor(apiKey);
  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: "user", content: String(user || "") }],
  });
  const text = (resp.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  return { text, usage: resp.usage || null, cost: costOf(model, resp.usage), model };
}

// Conversation multi-tours : system + historique [{role:"user"|"assistant", content}] → { text, usage, cost, model }.
async function chat({ apiKey, model = MODELS.sonnet, system, messages, maxTokens = 1024 }) {
  const client = clientFor(apiKey);
  const msgs = (messages || [])
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") }))
    .filter((m) => m.content.trim());
  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: msgs.length ? msgs : [{ role: "user", content: "Bonjour" }],
  });
  const text = (resp.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  return { text, usage: resp.usage || null, cost: costOf(model, resp.usage), model };
}

module.exports = { message, chat, clientFor, MODELS, costOf, PRICING };
