"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Stats {
  totals: { documents: number; chunks: number; avgChunksPerDoc: number };
  cron: {
    schedule: string;
    scheduleHuman: string;
    retentionHours: number;
    nextRunAt: string;
    now: string;
  };
  documents: Array<{
    label: string;
    idHash: string;
    pages: number;
    chunks: number;
    ageMinutes: number;
    expiresInMinutes: number;
  }>;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "imminent";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const s = Math.floor((ms % 60_000) / 1000);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export default function HowItWorks() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(json.error || "failed");
        setStats(json);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "load failed");
      }
    }
    load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cronCountdownMs = stats ? new Date(stats.cron.nextRunAt).getTime() - now : 0;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-5 sm:px-6">
      {/* Header */}
      <header className="reveal flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-medium text-ink2 transition-colors hover:border-line2 hover:bg-surface"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <p className="eyebrow">Architecture · Live demo</p>
      </header>

      {/* Hero */}
      <section className="reveal delay-1 mt-12">
        <p className="eyebrow mb-5 text-accent">Behind the curtain</p>
        <h1 className="text-display-1 font-bold tracking-tight text-balance">
          Six steps, <span className="text-accent">one cited answer.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted text-pretty">
          A live look at the pipeline you just used — the embeddings, the vector store, the cron
          that quietly throws everything out after a day. What you see here is what's actually
          running in production.
        </p>
      </section>

      {/* Live ticker */}
      <section className="reveal delay-2 mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active documents" value={stats?.totals.documents ?? "—"} />
        <Stat label="Embedded chunks" value={stats?.totals.chunks ?? "—"} />
        <Stat label="Avg / document" value={stats?.totals.avgChunksPerDoc ?? "—"} />
        <Stat
          label="Next cleanup"
          value={stats ? fmtCountdown(cronCountdownMs) : "—"}
          accent
        />
      </section>

      {/* Pipeline */}
      <section className="reveal delay-3 mt-16">
        <SectionTitle eyebrow="Pipeline" title="How a question becomes a cited answer" />
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <Step
            n="01"
            title="Upload"
            verb="POST /api/upload"
            body="Client guards the 5 MB cap; server re-verifies size, MIME, and the %PDF magic bytes. Upstash holds a per-IP fixed window — 3 uploads per day, no exceptions."
            specs={["≤ 5 MB", "≤ 50 pages", "3 / IP / day"]}
          />
          <Step
            n="02"
            title="Chunk"
            verb="pdf-parse · per page"
            body="pdf-parse walks the document one page at a time. Each page is normalised and sliced into ~500-token blocks with 50-token overlap, snapping to sentence boundaries when it can."
            specs={["≈ 500 tok / chunk", "50-tok overlap", "soft breaks"]}
          />
          <Step
            n="03"
            title="Embed"
            verb="Vertex · text-embedding-004"
            body="Chunks pack into batches under Vertex's 20k-token limit, pessimistically estimated at chars/2. Retries on 429 with exponential backoff, plus a 250 ms breath between batches."
            specs={["768-dim vectors", "8k tok / batch", "5× retry"]}
          />
          <Step
            n="04"
            title="Store"
            verb="Supabase · pgvector"
            body="Vectors land in a dedicated rag schema with RLS enabled (anon role bounced at the door). An ivfflat cosine index handles approximate-nearest-neighbour search."
            specs={["schema rag", "ivfflat · lists=100", "RLS on"]}
          />
          <Step
            n="05"
            title="Ask"
            verb="POST /api/chat"
            body="The question is embedded once, fed to the match_chunks RPC scoped to the active document. Top 5 passages return as context, each keeping its page number for citations."
            specs={["top 5 · cosine", "doc-scoped", "20 / IP / day"]}
          />
          <Step
            n="06"
            title="Stream"
            verb="Vertex · Gemini 2.5 Flash"
            body="A system prompt enforces 'cite [Source N] or refuse'. Tokens stream back as Server-Sent Events. The client renders citation footnotes inline as the text arrives."
            specs={["max 1024 tok", "T=0.2", "SSE"]}
          />
        </div>
      </section>

      {/* Cleanup */}
      <section className="reveal delay-3 mt-16">
        <SectionTitle eyebrow="Auto-cleanup" title="The 24-hour eviction" />
        <div className="mt-5 rounded-xl border border-line bg-canvas p-5 shadow-soft">
          <div className="grid gap-5 md:grid-cols-3">
            <KV label="Schedule" value={stats?.cron.scheduleHuman ?? "—"} sub={stats?.cron.schedule} />
            <KV label="Retention" value={stats ? `${stats.cron.retentionHours} hours` : "—"} sub="cascade delete" />
            <KV
              label="Next run in"
              value={stats ? fmtCountdown(cronCountdownMs) : "—"}
              sub={stats ? new Date(stats.cron.nextRunAt).toUTCString().replace("GMT", "UTC") : ""}
              accent
            />
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted">
            A Vercel cron hits <code className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-[0.85em] text-ink2">/api/cleanup</code> daily
            with a Bearer token. The endpoint calls{" "}
            <code className="rounded bg-surface2 px-1.5 py-0.5 font-mono text-[0.85em] text-ink2">rag.cleanup_old_documents('24 hours')</code> —
            a single SQL function that drops anything older than the cutoff and lets the
            foreign-key cascade do the rest. No filename logs are kept.
          </p>
        </div>
      </section>

      {/* Live docs */}
      <section className="reveal delay-4 mt-16">
        <SectionTitle eyebrow="Live data" title="Currently in the demo" />
        <p className="mt-2 text-sm text-muted">
          Filenames are redacted — fellow visitors uploaded these, and that's their business.
        </p>
        <div className="mt-5 overflow-hidden rounded-xl border border-line bg-canvas shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left">
                  <Th>Label</Th>
                  <Th>ID</Th>
                  <Th right>Pages</Th>
                  <Th right>Chunks</Th>
                  <Th right>Age</Th>
                  <Th right>Deletes in</Th>
                </tr>
              </thead>
              <tbody>
                {stats?.documents.length ? (
                  stats.documents.map((d) => (
                    <tr key={d.idHash} className="border-t border-line">
                      <Td>{d.label}</Td>
                      <Td><span className="font-mono text-xs text-muted">{d.idHash}…</span></Td>
                      <Td right><span className="tabular-nums">{d.pages}</span></Td>
                      <Td right><span className="tabular-nums">{d.chunks}</span></Td>
                      <Td right><span className="tabular-nums">{fmtDuration(d.ageMinutes)}</span></Td>
                      <Td right>
                        <span className={`tabular-nums ${d.expiresInMinutes < 120 ? "font-semibold text-danger" : "text-ink2"}`}>
                          {fmtDuration(d.expiresInMinutes)}
                        </span>
                      </Td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-muted">
                      {stats ? "Nothing in the index. Be the first." : "Loading…"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Specification */}
      <section className="reveal delay-4 mt-16">
        <SectionTitle eyebrow="Stack" title="Specification" />
        <div className="mt-5 grid gap-2 md:grid-cols-2">
          {[
            ["Framework", "Next.js 14 · App Router · TS"],
            ["Styling", "Tailwind CSS"],
            ["Generation", "Vertex AI · Gemini 2.5 Flash"],
            ["Embeddings", "Vertex AI · text-embedding-004 · 768d"],
            ["Vector store", "Supabase Postgres + pgvector"],
            ["Rate limit", "Upstash Redis · fixed window"],
            ["PDF viewer", "react-pdf · client-side highlights"],
            ["Local cache", "IndexedDB blobs · idb wrapper"],
            ["Host", "Vercel · daily cron"],
            ["Source", "github.com/chitai-dev (private demo)"],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-sm shadow-soft"
            >
              <span className="eyebrow">{k}</span>
              <span className="font-mono text-xs text-ink2">{v}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Hire-me CTA */}
      <section className="reveal delay-5 mt-20 overflow-hidden rounded-2xl border border-ink bg-ink text-canvas">
        <div className="p-6 sm:p-10">
          <p className="eyebrow mb-4 text-accent">For hire</p>
          <h2 className="text-display-2 font-bold tracking-tight text-balance">
            Want this on <span className="text-accent">your</span> stack?
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-canvas/75">
            One-time build. I scope it with you, build it on your GCP project, hand over the
            code and the keys. <span className="font-semibold text-canvas">No retainer, no
            monthly fee, no &ldquo;tier&rdquo; you have to stay subscribed to.</span> The
            infrastructure is yours from day one — I just got it shipped.
          </p>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <PitchBlock
              heading="What's included"
              items={[
                "Production-grade build of this exact pattern, hardened for your data",
                "Deployed to your GCP project — you own billing, models, infrastructure",
                "Hybrid retrieval (BM25 + dense + reranker) and a proper eval harness",
                "VPC / CMEK / VPC-SC if you need it. Auth (IAP, OIDC) wired through",
                "Observability — Cloud Logging, Trace, per-tenant cost dashboards",
                "Handover doc + a runbook your ops team can actually use",
              ]}
            />
            <PitchBlock
              heading="What I don't do"
              items={[
                "Monthly retainers or seat-based pricing",
                "Lock-in via a hosted layer you can't remove",
                "Black-box pipelines you'd have to rebuild to extend",
                "Fluffy 'AI strategy' decks",
              ]}
            />
          </div>

          <div className="mt-10 flex flex-wrap items-end justify-between gap-5 border-t border-canvas/15 pt-6">
            <div className="max-w-md">
              <p className="eyebrow text-canvas/60">Scope a project</p>
              <p className="mt-2 text-base text-canvas/85">
                Send me the rough idea — document count, target users, deadline — and I'll come
                back with a fixed scope, fixed price, and a build window.
              </p>
            </div>
            <a
              href="mailto:chitaidev@gmail.com?subject=RAG%20build%20-%20one-time%20engagement&body=Hi%20Chi%20Tai%2C%0A%0AI%20saw%20your%20RAG%20demo.%20Here's%20what%20I'm%20trying%20to%20build%3A%0A%0A-%20Use%20case%3A%0A-%20Document%20count%20%2F%20size%3A%0A-%20Target%20users%3A%0A-%20Timeline%3A%0A%0AThanks!"
              className="group inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-semibold text-canvas transition-all hover:bg-accentDim"
            >
              chitaidev@gmail.com
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {err && (
        <p className="mt-8 font-mono text-xs text-danger">stats fetch · {err}</p>
      )}

      <footer className="reveal delay-5 mt-12 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
        <span>© chitai.dev · 2026</span>
        <span className="inline-flex items-center gap-2">
          <span className="live-dot" /> Auto-refresh · 15s
        </span>
      </footer>
    </main>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="eyebrow mb-2 text-accent">{eyebrow}</p>
      <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h2>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-canvas p-4 shadow-soft">
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-2 text-3xl font-bold tracking-tight tabular-nums ${
          accent ? "text-accent" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Step({
  n, title, verb, body, specs,
}: {
  n: string; title: string; verb: string; body: string; specs: string[];
}) {
  return (
    <article className="group rounded-xl border border-line bg-canvas p-5 shadow-soft transition-all hover:border-line2 hover:shadow-lift">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accentSoft font-mono text-xs font-bold text-accent">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold tracking-tight">{title}</h3>
          <p className="font-mono text-[11px] text-muted">{verb}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink2 text-pretty">{body}</p>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
        {specs.map((s) => (
          <span
            key={s}
            className="rounded-full bg-surface2 px-2 py-0.5 font-mono text-[10px] text-muted"
          >
            {s}
          </span>
        ))}
      </div>
    </article>
  );
}

function KV({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mt-2 text-2xl font-bold tracking-tight tabular-nums ${accent ? "text-accent" : "text-ink"}`}>
        {value}
      </p>
      {sub && <p className="mt-1 font-mono text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted ${
        right ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={`px-4 py-2.5 text-ink2 ${right ? "text-right" : ""}`}>{children}</td>
  );
}

function PitchBlock({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-canvas/15 bg-canvas/5 p-5">
      <p className="eyebrow mb-3 text-accent">{heading}</p>
      <ul className="space-y-2.5">
        {items.map((it) => (
          <li key={it} className="flex gap-2.5">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="text-sm leading-relaxed text-canvas/85">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
