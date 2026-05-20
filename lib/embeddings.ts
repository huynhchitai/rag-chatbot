import { vertex, EMBED_MODEL } from "@/lib/vertex";

// ~500 tokens with 50-token overlap. Approximate 1 token ≈ 4 chars for English.
const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    let slice = clean.slice(start, end);

    if (end < clean.length) {
      const lastPeriod = slice.lastIndexOf(". ");
      const lastSpace = slice.lastIndexOf(" ");
      const breakAt = lastPeriod > size * 0.6 ? lastPeriod + 1 : lastSpace > size * 0.6 ? lastSpace : -1;
      if (breakAt > 0) slice = slice.slice(0, breakAt);
    }

    chunks.push(slice.trim());
    if (end >= clean.length) break;
    start += Math.max(slice.length - overlap, 1);
  }
  return chunks.filter((c) => c.length > 0);
}

// Vertex text-embedding-005 limits:
//   - 250 inputs per request
//   - ~20,000 tokens per request (whole batch)
// Pessimistic estimate: chars/2 covers Vietnamese / CJK / dense technical text.
// English is ~chars/4, so this over-counts and stays well under the cap.
const MAX_BATCH_TOKENS = 8_000;
const MAX_BATCH_ITEMS = 10;

function estTokens(s: string): number {
  return Math.ceil(s.length / 2);
}

const RETRY_MAX = 5;
const RETRY_BASE_MS = 1500;
const INTER_BATCH_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callEmbed(batch: string[], attempt = 0): Promise<number[][]> {
  try {
    const res = await vertex.models.embedContent({
      model: EMBED_MODEL,
      contents: batch,
    });
    const embeddings = res.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Vertex returned ${embeddings.length} embeddings for ${batch.length} inputs`);
    }
    return embeddings.map((e) => {
      if (!e.values) throw new Error("Vertex embedding missing values");
      return e.values;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const transient = /429|RESOURCE_EXHAUSTED|Quota exceeded|UNAVAILABLE|DEADLINE_EXCEEDED/i.test(msg);
    if (transient && attempt < RETRY_MAX) {
      const wait = RETRY_BASE_MS * 2 ** attempt + Math.random() * 500;
      await sleep(wait);
      return callEmbed(batch, attempt + 1);
    }
    throw err;
  }
}

export async function embed(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];

  let batch: string[] = [];
  let budget = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await callEmbed(batch);
    out.push(...result);
    batch = [];
    budget = 0;
    onProgress?.(out.length, texts.length);
  };

  for (const t of texts) {
    const tk = estTokens(t);
    if (batch.length > 0 && (budget + tk > MAX_BATCH_TOKENS || batch.length >= MAX_BATCH_ITEMS)) {
      await flush();
      await sleep(INTER_BATCH_DELAY_MS);
    }
    batch.push(t);
    budget += tk;
  }
  await flush();

  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embed([text]);
  return v;
}
