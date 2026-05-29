import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy init via Proxy — env vars are only required at request time, not at
// module load. Generics widened to `any` because schema: "rag" makes the
// returned client's SchemaName generic incompatible with the default "public".
type AnySupabase = SupabaseClient<any, any, any>;

let cached: AnySupabase | null = null;

function getClient(): AnySupabase {
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

export const supabaseAdmin: AnySupabase = new Proxy({} as AnySupabase, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
