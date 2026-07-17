// Edge Function « track » — pixel de suivi d'ouverture des mails (Iris CRM).
// Publique (le client mail du destinataire la charge). À chaque chargement du
// pixel, on incrémente le compteur d'ouverture du mail correspondant.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// GIF transparent 1×1
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get("t");
  if (t) {
    try {
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      const { data } = await admin.from("emails").select("id,open_count,first_opened_at").eq("tracking_id", t).maybeSingle();
      if (data) {
        const now = new Date().toISOString();
        await admin.from("emails").update({
          open_count: (data.open_count || 0) + 1,
          last_opened_at: now,
          first_opened_at: data.first_opened_at || now,
        }).eq("id", data.id);
      }
    } catch (_) { /* on renvoie le pixel quoi qu'il arrive */ }
  }
  return new Response(GIF, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(GIF.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
    },
  });
});
