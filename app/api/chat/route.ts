import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { embedOne } from "@/lib/embeddings";
import { vertex, GEN_MODEL } from "@/lib/vertex";
import { chatLimiter, getClientIp, check } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const TOP_K = 5;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_HISTORY_TURNS = 10; // last N messages sent to Vertex — caps cost + context window risk
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface MatchRow {
  id: number;
  document_id: string;
  filename: string;
  page_number: number;
  content: string;
  similarity: number;
}

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await check(chatLimiter, ip);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: "Daily chat limit reached (20/day). Try again tomorrow." }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const messages: ChatMessage[] = body.messages ?? [];
    const documentId: string | undefined = body.documentId;

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser?.content?.trim()) {
      return new Response(JSON.stringify({ error: "No user message" }), { status: 400 });
    }
    if (!documentId || !UUID_RE.test(documentId)) {
      return new Response(JSON.stringify({ error: "Missing or invalid documentId" }), { status: 400 });
    }

    const queryEmbedding = await embedOne(lastUser.content);

    const { data: matches, error } = await supabaseAdmin.rpc("match_chunks", {
      query_embedding: queryEmbedding,
      match_count: TOP_K,
      doc_id: documentId,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const rows = (matches ?? []) as MatchRow[];

    const contextBlock = rows.length
      ? rows
          .map(
            (r, i) =>
              `[Source ${i + 1}] (page ${r.page_number})\n${r.content}`,
          )
          .join("\n\n---\n\n")
      : "No matching passages found in the document.";

    const systemInstruction = `You are a helpful assistant that answers strictly from the provided CONTEXT.
Rules:
- Cite supporting passages inline as [Source N] using the numbers from the CONTEXT block.
- If the context does not contain the answer, say you don't know. Do not invent facts.
- Be concise. Reply in the user's language.

CONTEXT:
${contextBlock}`;

    // Cap conversation history before sending. Otherwise a long thread accumulates
    // unbounded tokens — the rate limit counts requests, not tokens.
    const trimmed = messages.slice(-MAX_HISTORY_TURNS);
    const contents = trimmed.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const sources = rows.map((r, i) => ({
      n: i + 1,
      page: r.page_number,
      content: r.content,                                                       // full chunk for PDF highlight
      snippet: r.content.length > 280 ? r.content.slice(0, 280) + "…" : r.content,
      similarity: r.similarity,
    }));

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(sseLine("sources", sources)));
        try {
          const stream = await vertex.models.generateContentStream({
            model: GEN_MODEL,
            contents,
            config: {
              systemInstruction,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              temperature: 0.2,
            },
          });
          for await (const chunk of stream) {
            const text = chunk.text;
            if (text) controller.enqueue(encoder.encode(sseLine("delta", text)));
          }
          controller.enqueue(encoder.encode(sseLine("done", {})));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "stream error";
          controller.enqueue(encoder.encode(sseLine("error", { message: msg })));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "chat failed";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
