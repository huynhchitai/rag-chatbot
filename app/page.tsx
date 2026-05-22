"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./_components/Markdown";
import { UploadQueue, type QueueItem } from "./_components/UploadQueue";
import { DocLibrary, type LibraryDoc } from "./_components/DocLibrary";
import { sha256Hex } from "@/lib/hash";
import { getDoc, listDocs, putDoc, deleteDoc, type StoredDoc } from "@/lib/idb";

const PdfViewer = dynamic(
  () => import("./_components/PdfViewer").then((m) => m.PdfViewer),
  { ssr: false, loading: () => <div className="h-full rounded-lg bg-surface2" /> },
);

interface Source {
  n: number;
  page: number;
  content: string;
  snippet: string;
  similarity: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

const MAX_BYTES = 5 * 1024 * 1024;

export default function Page() {
  const [library, setLibrary] = useState<LibraryDoc[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeHash, setActiveHash] = useState<string | null>(null);
  const [activeBlob, setActiveBlob] = useState<Blob | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [openSource, setOpenSource] = useState<{ msgIdx: number; n: number } | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"chat" | "pdf">("chat");
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── IDB → library on first paint ───────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const docs = await listDocs();
        setLibrary(docs.map(toLibrary));
        if (docs.length > 0 && !activeHash) {
          await activate(docs[0].hash, docs[0].blob);
        }
      } catch {
        /* IDB unavailable — ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const activeDoc = useMemo(
    () => library.find((d) => d.hash === activeHash) ?? null,
    [library, activeHash],
  );

  const activeSource: Source | null = useMemo(() => {
    if (!openSource) return null;
    const m = messages[openSource.msgIdx];
    return m?.sources?.find((s) => s.n === openSource.n) ?? null;
  }, [openSource, messages]);

  async function activate(hash: string, blobMaybe?: Blob) {
    setActiveHash(hash);
    setMessages([]);
    setOpenSource(null);
    const blob = blobMaybe ?? (await getDoc(hash))?.blob ?? null;
    setActiveBlob(blob);
  }

  // ── Multi-file ingest ──────────────────────────────────────────────────
  const enqueueFiles = useCallback(
    async (files: File[]) => {
      setTopError(null);
      const valid: { file: File; clientId: string }[] = [];
      const initial: QueueItem[] = [];
      for (const f of files) {
        const clientId = crypto.randomUUID();
        if (f.size > MAX_BYTES) {
          initial.push({
            clientId, filename: f.name, size: f.size,
            status: "error", progress: 0, error: "File exceeds 5 MB",
          });
          continue;
        }
        if (f.type && f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
          initial.push({
            clientId, filename: f.name, size: f.size,
            status: "error", progress: 0, error: "Not a PDF",
          });
          continue;
        }
        valid.push({ file: f, clientId });
        initial.push({
          clientId, filename: f.name, size: f.size,
          status: "queued", progress: 0,
        });
      }
      setQueue((q) => [...q, ...initial]);
      setProcessing(true);
      for (const { file, clientId } of valid) {
        await processOne(file, clientId);
      }
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function updateItem(clientId: string, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((it) => (it.clientId === clientId ? { ...it, ...patch } : it)));
  }

  async function processOne(file: File, clientId: string) {
    try {
      updateItem(clientId, { status: "hashing", stage: "Computing hash", progress: 4 });
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);

      // Local cache short-circuit
      const local = await getDoc(hash);
      if (local) {
        updateItem(clientId, {
          status: "cached", stage: "Already in your library", progress: 100,
          pages: local.pages, chunks: local.chunks,
        });
        setLibrary((lib) =>
          lib.some((d) => d.hash === hash) ? lib : [toLibrary(local), ...lib],
        );
        if (!activeHash) await activate(hash, local.blob);
        return;
      }

      updateItem(clientId, { status: "uploading", stage: "Sending to server", progress: 8 });

      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });

      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !res.body || !ct.includes("text/event-stream")) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Upload failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let bufStr = "";
      let result: {
        documentId: string; filename: string; pages: number; chunks: number; hash: string; cached?: boolean;
      } | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bufStr += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = bufStr.indexOf("\n\n")) !== -1) {
          const raw = bufStr.slice(0, sep);
          bufStr = bufStr.slice(sep + 2);
          const evM = raw.match(/^event: (.+)$/m);
          const dM = raw.match(/^data: (.+)$/m);
          if (!evM || !dM) continue;
          const ev = evM[1];
          let data: any;
          try { data = JSON.parse(dM[1]); } catch { continue; }
          if (ev === "parsed") {
            updateItem(clientId, { status: "parsing", progress: 15, pages: data.pages, stage: `Parsed ${data.pages} pages` });
          } else if (ev === "chunked") {
            updateItem(clientId, { status: "embedding", progress: 20, chunks: data.chunks, stage: `${data.chunks} chunks ready` });
          } else if (ev === "embed") {
            const pct = 20 + Math.floor((data.done / data.total) * 70);
            updateItem(clientId, {
              status: "embedding", progress: pct,
              stage: `Embedding ${data.done} / ${data.total} chunks`,
            });
          } else if (ev === "status" && data.stage === "storing") {
            updateItem(clientId, { status: "storing", progress: 94, stage: "Storing in vector DB" });
          } else if (ev === "cached") {
            result = { ...data, cached: true };
            updateItem(clientId, {
              status: "cached", progress: 100, pages: data.pages, chunks: data.chunks,
              stage: "Server already had this — skipped embedding",
            });
          } else if (ev === "done") {
            result = data;
            updateItem(clientId, {
              status: "done", progress: 100, pages: data.pages, chunks: data.chunks,
              stage: "Indexed",
            });
          } else if (ev === "error") {
            throw new Error(data.message ?? "Upload error");
          }
        }
      }

      if (!result) throw new Error("Upload finished without a result");

      const stored: StoredDoc = {
        hash: result.hash,
        filename: result.filename,
        size: file.size,
        pages: result.pages,
        chunks: result.chunks,
        docId: result.documentId,
        addedAt: Date.now(),
        blob: file,
      };
      await putDoc(stored);
      setLibrary((lib) => {
        const without = lib.filter((d) => d.hash !== stored.hash);
        return [toLibrary(stored), ...without];
      });
      if (!activeHash) await activate(stored.hash, stored.blob);
    } catch (err) {
      updateItem(clientId, {
        status: "error",
        progress: 100,
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await enqueueFiles(Array.from(fileList));
  }

  async function loadSample() {
    try {
      const res = await fetch("/sample.pdf");
      if (!res.ok) throw new Error("sample.pdf missing from /public");
      const blob = await res.blob();
      await enqueueFiles([new File([blob], "sample.pdf", { type: "application/pdf" })]);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Could not load sample");
    }
  }

  function dismiss(id: string) {
    setQueue((q) => q.filter((it) => it.clientId !== id));
  }

  async function removeFromLibrary(hash: string) {
    await deleteDoc(hash);
    setLibrary((lib) => lib.filter((d) => d.hash !== hash));
    if (activeHash === hash) {
      const remaining = library.filter((d) => d.hash !== hash);
      if (remaining.length > 0) {
        await activate(remaining[0].hash);
      } else {
        setActiveHash(null);
        setActiveBlob(null);
        setMessages([]);
      }
    }
  }

  // ── Drag and drop ──────────────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback(() => setDragOver(false), []);
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
      );
      if (files.length > 0) await enqueueFiles(files);
    },
    [enqueueFiles],
  );

  // ── Chat ───────────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.trim();
    if (!text || sending || !activeDoc) return;
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, documentId: activeDoc.docId }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Chat failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantText = "";
      let sources: Source[] | undefined;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const evM = raw.match(/^event: (.+)$/m);
          const dM = raw.match(/^data: (.+)$/m);
          if (!evM || !dM) continue;
          const ev = evM[1];
          let data: any;
          try { data = JSON.parse(dM[1]); } catch { continue; }
          if (ev === "sources") sources = data as Source[];
          else if (ev === "delta") {
            assistantText += String(data);
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: "assistant", content: assistantText, sources };
              return copy;
            });
          } else if (ev === "error") {
            throw new Error((data as { message?: string }).message || "Stream error");
          }
        }
      }
    } catch (err) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content: `Error — ${err instanceof Error ? err.message : "chat failed"}`,
        };
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  const hasAnything = library.length > 0 || queue.length > 0;

  return (
    <main
      className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 pb-6 pt-5 sm:px-6"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="reveal flex items-center justify-between">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-ink text-canvas">
            <span className="font-mono text-[11px] font-semibold">R</span>
          </span>
          <span className="text-base font-semibold tracking-tight">chitai/rag</span>
        </Link>
        <div className="flex items-center gap-2">
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-canvas shadow-soft transition-all hover:bg-ink2 focus-ring ${
              processing ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {processing ? "Uploading…" : "Upload PDF"}
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={handleFiles}
              disabled={processing}
            />
          </label>
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-medium text-ink2 transition-colors hover:border-line2 hover:bg-surface"
          >
            How it works
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </header>

      {/* Notice */}
      <div className="reveal delay-1 flex items-start gap-3 rounded-lg border border-warnSoft bg-warnSoft/40 px-4 py-3 text-sm">
        <svg className="mt-0.5 shrink-0 text-warn" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <p className="text-ink2">
          <span className="font-semibold">Free-tier demo.</span>{" "}
          <span className="text-muted">
            Uploads/chats may 429 from per-IP caps or Vertex quotas. Retry after ~30s. PDFs are cached in your browser via IndexedDB.
          </span>
        </p>
      </div>

      {topError && (
        <div className="reveal flex items-start gap-3 rounded-lg border border-dangerSoft bg-dangerSoft/40 px-4 py-3 text-sm text-danger">
          <span className="font-semibold">Error</span> {topError}
        </div>
      )}

      {queue.length > 0 && <UploadQueue items={queue} onDismiss={dismiss} />}

      {library.length > 0 && (
        <DocLibrary
          docs={library}
          activeHash={activeHash}
          onSelect={(h) => activate(h)}
          onRemove={removeFromLibrary}
        />
      )}

      {!hasAnything ? (
        // ── Empty state ──────────────────────────────────────────────────
        <section className="reveal delay-2 relative flex flex-1 flex-col items-center justify-center py-12">
          <div className="dot-grid absolute inset-0 -z-10 opacity-60" />
          <div className="max-w-2xl text-center">
            <p className="eyebrow mb-6">A working demonstration</p>
            <h1 className="text-display-1 font-bold tracking-tight text-balance">
              Ask your PDFs <span className="text-accent">anything.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted text-pretty">
              Drop in one or more PDFs. They're parsed, chunked, embedded once, then cached — both
              on the server and in your browser. Click a citation to see the exact passage
              highlighted on the page.
            </p>
          </div>

          <div
            className={`mt-10 w-full max-w-2xl rounded-2xl border-2 border-dashed bg-canvas p-8 text-center shadow-soft transition-all ${
              dragOver ? "border-accent bg-accentSoft/30" : "border-line2"
            }`}
          >
            <div className="grid place-items-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-mute2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <path d="M14 2v6h6"/>
                <path d="M12 18v-6"/>
                <path d="M9 15l3-3 3 3"/>
              </svg>
              <p className="mt-3 text-lg font-semibold">Drop PDFs here</p>
              <p className="mt-1 text-sm text-muted">≤ 5 MB · ≤ 50 pages each · multiple files OK</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-canvas shadow-soft transition-all hover:bg-accentDim focus-ring">
                  Choose files
                  <input type="file" accept="application/pdf" multiple className="hidden" onChange={handleFiles} />
                </label>
                <button
                  type="button"
                  onClick={loadSample}
                  className="inline-flex items-center gap-2 rounded-md border border-line bg-canvas px-4 py-2.5 text-sm font-semibold text-ink2 transition-colors hover:border-line2 hover:bg-surface"
                >
                  Try sample
                </button>
              </div>
            </div>
          </div>

          <div className="mt-12 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
            <Spec label="Vector DB" value="Supabase + pgvector" />
            <Spec label="Embeddings" value="text-embedding-004 · 768d" />
            <Spec label="Generation" value="Gemini 2.5 Flash" />
          </div>
        </section>
      ) : activeDoc ? (
        // ── Split: PDF + Chat ────────────────────────────────────────────
        <>
          {/* Mobile tab toggle */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface2 p-1 lg:hidden">
            {(["chat", "pdf"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={`rounded-md py-2 text-sm font-semibold transition-all ${
                  viewMode === m ? "bg-canvas text-ink shadow-soft" : "text-muted hover:text-ink2"
                }`}
              >
                {m === "chat" ? "Chat" : "PDF"}
              </button>
            ))}
          </div>

          <section className="flex flex-1 flex-col gap-4 lg:flex-row lg:gap-4">
            {/* PDF pane */}
            <div
              className={`flex h-[70vh] flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-soft lg:h-auto lg:max-h-[calc(100vh-220px)] lg:min-h-[620px] lg:flex-[1.2] ${
                viewMode === "pdf" ? "" : "hidden lg:flex"
              }`}
            >
              <PdfViewer
                file={activeBlob}
                filename={activeDoc.filename}
                highlight={
                  activeSource
                    ? { page: activeSource.page, content: activeSource.content }
                    : null
                }
              />
            </div>

            {/* Chat pane */}
            <div
              className={`flex flex-1 flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-soft ${
                viewMode === "chat" ? "" : "hidden lg:flex"
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{activeDoc.filename}</p>
                  <p className="font-mono text-[11px] text-muted">
                    {activeDoc.pages} pages · {activeDoc.chunks} chunks
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {messages.length === 0 ? (
                  <div className="grid h-full place-items-center text-center">
                    <div>
                      <p className="text-base font-semibold text-ink2">
                        Ask anything about this document
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        Answers come with page-level citations you can click into.
                      </p>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-5">
                    {messages.map((m, i) => (
                      <li key={i}>
                        {m.role === "user" ? (
                          <div className="flex justify-end">
                            <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-ink px-4 py-2.5 text-sm text-canvas">
                              {m.content}
                            </div>
                          </div>
                        ) : (
                          <div className="max-w-[92%]">
                            {m.content ? (
                              <Markdown content={m.content} />
                            ) : (
                              <div className="flex items-center gap-2 text-sm text-muted">
                                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                                Composing…
                              </div>
                            )}
                            {m.sources && m.sources.length > 0 && (
                              <div className="mt-3 border-t border-line pt-3">
                                <p className="eyebrow mb-2">Sources</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {m.sources.map((s) => {
                                    const open = openSource?.msgIdx === i && openSource?.n === s.n;
                                    return (
                                      <button
                                        key={s.n}
                                        type="button"
                                        onClick={() => {
                                          setOpenSource(open ? null : { msgIdx: i, n: s.n });
                                          setViewMode("pdf");
                                        }}
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                                          open
                                            ? "border-accent bg-accent text-canvas"
                                            : "border-line bg-canvas text-ink2 hover:border-accent hover:text-accent"
                                        }`}
                                      >
                                        <span className="font-mono text-[10px]">#{s.n}</span>
                                        <span>p.{s.page}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                                {openSource?.msgIdx === i && (() => {
                                  const s = m.sources?.find((x) => x.n === openSource.n);
                                  return s ? (
                                    <div className="mt-3 rounded-md border border-line bg-surface px-3 py-2.5 text-sm">
                                      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted">
                                        Source #{s.n} · page {s.page} · similarity {s.similarity.toFixed(3)}
                                      </p>
                                      <p className="text-ink2">{s.snippet}</p>
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                    <div ref={messagesEndRef} />
                  </ul>
                )}
              </div>

              {/* Composer */}
              <form
                className="border-t border-line bg-surface p-3"
                onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
              >
                <div className="flex items-end gap-2 rounded-lg border border-line bg-canvas p-1.5 shadow-soft focus-within:border-accent focus-within:shadow-ring">
                  <input
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-ink placeholder:text-mute2 focus:outline-none"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your question…"
                    disabled={sending}
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={sending || !input.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-canvas transition-all hover:bg-ink2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {sending ? (
                      <>
                        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                        Sending
                      </>
                    ) : (
                      <>
                        Send
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M13 5l7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </>
      ) : (
        <section className="reveal flex flex-1 items-center justify-center py-12">
          <p className="text-base font-medium text-muted">Preparing your documents…</p>
        </section>
      )}

      {/* Footer */}
      <footer className="reveal delay-5 mt-auto flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
        <span>© Tai Huynh · 2026</span>
        <span className="inline-flex items-center gap-2">
          <span className="live-dot" /> demo live
        </span>
      </footer>

      {/* Drop overlay */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent/8 backdrop-blur-sm">
          <div className="rounded-2xl border-4 border-dashed border-accent bg-canvas px-12 py-8 shadow-lift">
            <p className="text-2xl font-bold text-accent">Drop to upload</p>
          </div>
        </div>
      )}
    </main>
  );
}

function toLibrary(d: StoredDoc): LibraryDoc {
  return {
    hash: d.hash,
    docId: d.docId,
    filename: d.filename,
    pages: d.pages,
    chunks: d.chunks,
    addedAt: d.addedAt,
  };
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-3 text-left shadow-soft">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 font-mono text-xs text-ink">{value}</p>
    </div>
  );
}
