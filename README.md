# RAG Chatbot

Upload a PDF, ask questions, get streamed answers with `[Source N]` citations (click a citation to see the snippet and page number).

**Stack:** Next.js 14 (App Router, TS, Tailwind) · **Gemini 2.5 Flash** via **Vertex AI** for generation · **Vertex `text-embedding-004`** (768d) for embeddings · Supabase Postgres + pgvector · Upstash Redis for rate limit · Vercel for deploy + cron.

## Flow

```
PDF → /api/upload (rate-limit + validate: ≤5MB, ≤50 pages, PDF magic bytes)
    → pdf-parse per page → chunkText → Vertex embed → Supabase (documents + chunks)

question + documentId → /api/chat (rate-limit) → Vertex embed query
                       → match_chunks RPC (top 5, scoped to document)
                       → Vertex Gemini stream w/ [Source N]  → SSE to client
```

## Setup

### 1. Google Cloud (Vertex AI)

1. Create a GCP project (new accounts get **$300 free credit**).
2. Enable APIs: **Vertex AI API**, **Cloud Resource Manager API**.
3. Create a **Service Account** with role **Vertex AI User**. Download the JSON key.
4. Set a **Billing Budget alert** (Billing → Budgets → cap at $20/month).
5. Pick a region where Gemini 2.5 Flash is available — `us-central1` is the safe default.

### 2. Supabase

1. Create a project → SQL editor → paste [supabase/schema.sql](supabase/schema.sql) → **Run**. All tables and RPCs live in a dedicated `rag` schema.
2. **Project Settings → API → Exposed schemas**: add `rag` to the list (defaults to just `public`). PostgREST won't reach the schema otherwise.
3. **Project Settings → API**: copy `Project URL` and the `service_role` key.

### 3. Upstash Redis (rate limit)

1. https://upstash.com → create a Redis database (free tier).
2. Copy the **REST URL** and **REST token**.

> The app degrades gracefully without Upstash — if `UPSTASH_REDIS_*` are unset, rate limiting is skipped (useful in local dev).

### 4. Environment variables

Copy [.env.example](.env.example) → `.env.local` and fill in:

| Var | Notes |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | Project ID (not number) |
| `GOOGLE_CLOUD_REGION` | e.g. `us-central1` |
| GCP credentials | Pick **one** of the three options below |
| `SUPABASE_URL` | From Supabase settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only — never expose |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Optional locally; required for production |
| `CRON_SECRET` | Random string; Vercel cron uses it as `Authorization: Bearer …` |

#### GCP credentials — choose one

[lib/vertex.ts](lib/vertex.ts) checks these env vars in order; first match wins.

**(a) File path — easiest for local dev** ⭐ recommended locally

```bash
mv ~/Downloads/your-project-xxx.json /home/you/Desktop/rag-chatbot/gcp-key.json
```
```env
GOOGLE_APPLICATION_CREDENTIALS=/home/you/Desktop/rag-chatbot/gcp-key.json
```
Use an **absolute path** (`/home/...`), not `./gcp-key.json`. The file is gitignored by default — see [.gitignore](.gitignore).

**(b) Base64 — easiest for Vercel UI** ⭐ recommended on Vercel

```bash
base64 -w 0 < gcp-key.json   # macOS: base64 -i gcp-key.json | tr -d '\n'
```
Paste the resulting single-line string as:
```env
GOOGLE_APPLICATION_CREDENTIALS_B64=eyJ0eXBlIjoi...
```

**(c) Inline JSON — only if you can keep it on one line**

```env
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",...}
```

> ⚠️ dotenv reads line-by-line — if you wrap a multi-line JSON object across lines it will only see the first line and you'll get `GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON` at startup. Use option (a) or (b) instead, or collapse to one line.

### 5. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 → upload a PDF, or click **Try with sample PDF** (drop one at [public/sample.pdf](public/) first).

### 6. Deploy to Vercel

```bash
vercel --prod
```

Add all `.env.local` vars in **Project Settings → Environment Variables**. The included [vercel.json](vercel.json) registers a daily cron at 03:00 UTC that hits `/api/cleanup` to drop docs older than 24h.

## Files

| Path | Purpose |
|---|---|
| [supabase/schema.sql](supabase/schema.sql) | `rag` schema: `documents`, `chunks(vector(768))`, `match_chunks` RPC, `cleanup_old_documents`, service_role grants |
| [lib/supabase.ts](lib/supabase.ts) | Server-only service-role client, default schema = `rag` |
| [lib/vertex.ts](lib/vertex.ts) | `@google/genai` Vertex client, model constants |
| [lib/embeddings.ts](lib/embeddings.ts) | `chunkText()` (~500 tok/50 overlap) + batched `embed()` |
| [lib/pdf.ts](lib/pdf.ts) | `pdf-parse` wrapper, magic-byte check, 50-page guard |
| [lib/ratelimit.ts](lib/ratelimit.ts) | Upstash fixed-window: 3 uploads/day, 20 chats/day per IP |
| [app/api/upload/route.ts](app/api/upload/route.ts) | Validate → parse → embed → insert |
| [app/api/chat/route.ts](app/api/chat/route.ts) | Embed query → vector search → Gemini SSE stream |
| [app/api/cleanup/route.ts](app/api/cleanup/route.ts) | Daily Vercel cron, Bearer-auth, calls `cleanup_old_documents` |
| [app/page.tsx](app/page.tsx) | Upload zone → chat view, sample button, clickable citations |
| [vercel.json](vercel.json) | Cron schedule |

## Limits & guardrails

- **Upload:** PDF only, ≤ 5 MB, ≤ 50 pages. Server re-checks size + magic bytes (`%PDF`) + MIME — don't trust the client.
- **Rate limit:** 3 uploads/day/IP, 20 chats/day/IP.
- **Generation:** `maxOutputTokens` = 1024.
- **Retention:** docs + chunks auto-deleted after 24 h via Vercel cron.

## Notes

- **Streaming protocol:** real SSE (`text/event-stream`). Events: `sources` (array with `n`, `page`, `snippet`, `similarity`), `delta` (text), `done`, `error`. See parser in [app/page.tsx](app/page.tsx).
- **Per-document scope:** the chat endpoint requires `documentId` and the `match_chunks` RPC filters to that document — answers never leak across uploads.
- **Why Vertex over direct API:** new GCP accounts get $300 credit, one bill for both LLM and embeddings, and Vertex Gemini is currently the cheapest path. Switching to Claude later: add `@anthropic-ai/vertex-sdk`, swap the call in [lib/vertex.ts](lib/vertex.ts), and pick a region where Claude is enabled (`us-east5` typically).
- **ivfflat tuning:** `lists = 100` is fine to start. For >10k chunks: `ALTER INDEX chunks_embedding_idx SET (lists = sqrt(rows))` and `ANALYZE chunks;`.
