import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// LAZY initialization. The old code instantiated the client at module load
// and threw if env vars were missing — which broke `next build` (and any
// production build that runs without runtime env present). The client is now
// created on first property access via a Proxy, so `import { supabaseAdmin }`
// is side-effect-free and only requires env vars when the client is actually
// used (at request time, when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// guaranteed to be set on Cloud Run via Secret Manager).
let cached: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "rag" },
  });
  return cached;
}

// Proxy preserves the existing `supabaseAdmin.rpc(...)` / `.from(...)` call
// sites without forcing every route to switch to a function call.
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
