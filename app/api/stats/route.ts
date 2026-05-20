import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_HOURS = 24;
// vercel.json cron: "0 3 * * *"  -> daily 03:00 UTC
const CRON_HOUR_UTC = 3;

function nextCronAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(CRON_HOUR_UTC);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function GET() {
  const { data: docs, error: docsErr } = await supabaseAdmin
    .from("documents")
    .select("id, num_pages, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (docsErr) return NextResponse.json({ error: docsErr.message }, { status: 500 });

  const { count: docCount } = await supabaseAdmin
    .from("documents")
    .select("id", { count: "exact", head: true });
  const { count: chunkCount } = await supabaseAdmin
    .from("chunks")
    .select("id", { count: "exact", head: true });

  const ids = (docs ?? []).map((d) => d.id);
  const chunkByDoc = new Map<string, number>();
  if (ids.length) {
    const { data: rows } = await supabaseAdmin
      .from("chunks")
      .select("document_id")
      .in("document_id", ids);
    for (const r of rows ?? []) {
      chunkByDoc.set(r.document_id, (chunkByDoc.get(r.document_id) ?? 0) + 1);
    }
  }

  const now = new Date();
  const retentionMs = RETENTION_HOURS * 3600_000;

  // Redact filenames entirely. Show only a short opaque id and lifecycle data.
  const documents = (docs ?? []).map((d, i) => {
    const created = new Date(d.created_at);
    const ageMin = Math.max(0, Math.floor((now.getTime() - created.getTime()) / 60_000));
    const expiresInMin = Math.max(0, Math.floor((created.getTime() + retentionMs - now.getTime()) / 60_000));
    return {
      label: `PDF #${i + 1}`,
      idHash: String(d.id).slice(0, 8),
      pages: d.num_pages ?? 0,
      chunks: chunkByDoc.get(d.id) ?? 0,
      ageMinutes: ageMin,
      expiresInMinutes: expiresInMin,
    };
  });

  return NextResponse.json({
    totals: {
      documents: docCount ?? 0,
      chunks: chunkCount ?? 0,
      avgChunksPerDoc: docCount ? Number(((chunkCount ?? 0) / docCount).toFixed(1)) : 0,
    },
    cron: {
      schedule: "0 3 * * *",
      scheduleHuman: "Daily at 03:00 UTC",
      retentionHours: RETENTION_HOURS,
      nextRunAt: nextCronAt(now).toISOString(),
      now: now.toISOString(),
    },
    documents,
  });
}
