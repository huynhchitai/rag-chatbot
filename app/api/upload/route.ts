import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { parsePdf, isPdfMagic, PdfTooLargeError, MAX_PAGES } from "@/lib/pdf";
import { chunkText, embed } from "@/lib/embeddings";
import { uploadLimiter, getClientIp, check } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function sseStream(): {
  body: ReadableStream<Uint8Array>;
  emit: (event: string, data: unknown) => void;
  close: () => void;
  error: (msg: string) => void;
} {
  const enc = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const emit = (event: string, data: unknown) =>
    controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  return {
    body,
    emit,
    close: () => controller.close(),
    error: (msg) => {
      emit("error", { message: msg });
      controller.close();
    },
  };
}

function sseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: NextRequest) {
  // ── Rate limit ──────────────────────────────────────────────────────────
  const ip = getClientIp(req);
  const rl = await check(uploadLimiter, ip);
  if (!rl.allowed) {
    return jsonError("Daily upload limit reached (3/day). Try again tomorrow.", 429);
  }

  // ── Validate ────────────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Invalid form data", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Missing file", 400);
  if (file.size > MAX_BYTES) return jsonError("File exceeds 5 MB", 413);
  if (file.type && file.type !== "application/pdf") {
    return jsonError("Only PDF files are accepted", 415);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isPdfMagic(buffer)) return jsonError("File is not a valid PDF", 415);

  const hash = createHash("sha256").update(buffer).digest("hex");

  // ── Cache check (server-side, by content hash) ──────────────────────────
  {
    const { data: existing } = await supabaseAdmin
      .from("documents")
      .select("id, filename, num_pages")
      .eq("content_hash", hash)
      .maybeSingle();

    if (existing) {
      const { count } = await supabaseAdmin
        .from("chunks")
        .select("id", { count: "exact", head: true })
        .eq("document_id", existing.id);

      const sse = sseStream();
      queueMicrotask(() => {
        sse.emit("cached", {
          documentId: existing.id,
          filename: existing.filename,
          pages: existing.num_pages ?? 0,
          chunks: count ?? 0,
          hash,
        });
        sse.close();
      });
      return sseResponse(sse.body);
    }
  }

  // ── New upload — stream progress events back to the client ──────────────
  const sse = sseStream();

  (async () => {
    try {
      sse.emit("status", { stage: "parsing" });

      let parsed;
      try {
        parsed = await parsePdf(buffer);
      } catch (err) {
        if (err instanceof PdfTooLargeError) {
          sse.error(`PDF has ${err.pages} pages, exceeds the ${MAX_PAGES}-page limit`);
          return;
        }
        throw err;
      }
      sse.emit("parsed", { pages: parsed.numPages });

      const baseRows: { page_number: number; chunk_index: number; content: string }[] = [];
      for (const p of parsed.pages) {
        const pieces = chunkText(p.text);
        pieces.forEach((content, idx) => {
          baseRows.push({ page_number: p.page, chunk_index: idx, content });
        });
      }

      if (baseRows.length === 0) {
        sse.error("No extractable text — scanned PDF?");
        return;
      }

      sse.emit("chunked", { chunks: baseRows.length });

      // Embed FIRST. If this fails (quota, network, etc.) we never touched the
      // documents table — no orphan row, no content_hash lock-out on retry.
      const vectors = await embed(
        baseRows.map((r) => r.content),
        (done, total) => sse.emit("embed", { done, total }),
      );

      sse.emit("status", { stage: "storing" });

      // Insert document, then chunks. If chunk insert fails we hard-delete
      // the document and verify the cleanup actually happened.
      const { data: doc, error: docErr } = await supabaseAdmin
        .from("documents")
        .insert({ filename: file.name, num_pages: parsed.numPages, content_hash: hash })
        .select("id")
        .single();
      if (docErr || !doc) {
        sse.error(docErr?.message ?? "Failed to create document");
        return;
      }
      const documentId = doc.id as string;

      const embedded = baseRows.map((r, i) => ({
        document_id: documentId,
        ...r,
        embedding: vectors[i],
      }));

      const { error: insertErr } = await supabaseAdmin.from("chunks").insert(embedded);
      if (insertErr) {
        const { error: rollbackErr } = await supabaseAdmin
          .from("documents")
          .delete()
          .eq("id", documentId);
        if (rollbackErr) {
          sse.error(
            `chunks insert failed (${insertErr.message}); rollback also failed (${rollbackErr.message}) — document ${documentId} may need manual cleanup`,
          );
        } else {
          sse.error(insertErr.message);
        }
        return;
      }

      sse.emit("done", {
        documentId,
        filename: file.name,
        pages: parsed.numPages,
        chunks: embedded.length,
        hash,
      });
      sse.close();
    } catch (err) {
      sse.error(err instanceof Error ? err.message : "Upload failed");
    }
  })();

  return sseResponse(sse.body);
}
