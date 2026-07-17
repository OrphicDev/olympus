// Edge Function « admin » — gestion des membres Olympus (côté serveur).
// La clé service reste ici (env Supabase), jamais distribuée à l'app.
// Seul un super admin (vérifié via son JWT) peut gérer les membres ;
// le bootstrap du 1er super admin n'est possible que s'il n'en existe aucun.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  let p: any = {};
  try { p = await req.json(); } catch {}
  const action = p.action;

  // Identité de l'appelant (via son jeton)
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  let callerRole: string | null = null;
  if (token) {
    const { data } = await admin.auth.getUser(token);
    callerRole = data?.user?.user_metadata?.role ?? null;
  }

  const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const users = listData?.users ?? [];
  const hasSuperAdmin = users.some((u: any) => u.user_metadata?.role === "super_admin");

  // Bootstrap (sans auth, seulement si aucun super admin)
  if (action === "bootstrap") {
    if (hasSuperAdmin) return json({ error: "Un super admin existe déjà." }, 400);
    const { email, password, first_name, last_name } = p;
    if (!email || !password || !first_name || !last_name) return json({ error: "Champs requis." }, 400);
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name, last_name, role: "super_admin", must_reset_password: false } });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }
  if (action === "needsBootstrap") return json({ possible: !hasSuperAdmin });

  // Toutes les autres actions : super admin uniquement
  if (callerRole !== "super_admin") return json({ error: "Réservé au super admin." }, 403);

  if (action === "list") {
    return json({ ok: true, members: users.map((u: any) => ({ id: u.id, email: u.email, first_name: u.user_metadata?.first_name || "", last_name: u.user_metadata?.last_name || "", role: u.user_metadata?.role || "classic", last_sign_in: u.last_sign_in_at || null })) });
  }
  if (action === "create") {
    const { email, password, first_name, last_name, role } = p;
    if (!email || !password || !first_name || !last_name) return json({ error: "Champs requis." }, 400);
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name, last_name, role: role === "super_admin" ? "super_admin" : "classic", must_reset_password: true } });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }
  if (action === "delete") {
    const { error } = await admin.auth.admin.deleteUser(p.id);
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }
  if (action === "setRole") {
    const u = users.find((x: any) => x.id === p.id);
    const meta = { ...(u?.user_metadata || {}), role: p.role === "super_admin" ? "super_admin" : "classic" };
    const { error } = await admin.auth.admin.updateUserById(p.id, { user_metadata: meta });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }
  if (action === "resetPassword") {
    const u = users.find((x: any) => x.id === p.id);
    const temp = "Orphic-" + Math.random().toString(36).slice(2, 8).toUpperCase() + "!";
    const meta = { ...(u?.user_metadata || {}), must_reset_password: true };
    const { error } = await admin.auth.admin.updateUserById(p.id, { password: temp, user_metadata: meta });
    return error ? json({ error: error.message }, 400) : json({ ok: true, tempPassword: temp });
  }
  return json({ error: "Action inconnue." }, 400);
});
