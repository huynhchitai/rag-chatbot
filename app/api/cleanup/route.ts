import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Triggered by Vercel cron (vercel.json). Auth via Bearer token.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pass no args — SQL function default is `interval '24 hours'`.
  // Passing a string requires PostgREST text→interval cast, which silently 500s on some setups.
  const { data, error } = await supabaseAdmin.rpc("cleanup_old_documents");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: data ?? 0, at: new Date().toISOString() });
}
