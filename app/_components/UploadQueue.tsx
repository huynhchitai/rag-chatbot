"use client";

export type QueueStatus =
  | "queued"
  | "hashing"
  | "uploading"
  | "parsing"
  | "embedding"
  | "storing"
  | "done"
  | "cached"
  | "error";

export interface QueueItem {
  clientId: string;
  filename: string;
  size: number;
  status: QueueStatus;
  progress: number;
  stage?: string;
  pages?: number;
  chunks?: number;
  error?: string;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function badge(s: QueueStatus): { label: string; bg: string; fg: string; dot: string } {
  switch (s) {
    case "queued":    return { label: "Queued",    bg: "bg-surface2",   fg: "text-muted", dot: "bg-mute2" };
    case "hashing":   return { label: "Hashing",   bg: "bg-surface2",   fg: "text-muted", dot: "bg-mute2" };
    case "uploading": return { label: "Uploading", bg: "bg-warnSoft",   fg: "text-warn",  dot: "bg-warn" };
    case "parsing":   return { label: "Parsing",   bg: "bg-warnSoft",   fg: "text-warn",  dot: "bg-warn animate-pulse" };
    case "embedding": return { label: "Embedding", bg: "bg-warnSoft",   fg: "text-warn",  dot: "bg-warn animate-pulse" };
    case "storing":   return { label: "Storing",   bg: "bg-warnSoft",   fg: "text-warn",  dot: "bg-warn animate-pulse" };
    case "done":      return { label: "Indexed",   bg: "bg-liveSoft",   fg: "text-live",  dot: "bg-live" };
    case "cached":    return { label: "Cached",    bg: "bg-liveSoft",   fg: "text-live",  dot: "bg-live" };
    case "error":     return { label: "Error",     bg: "bg-dangerSoft", fg: "text-danger", dot: "bg-danger" };
  }
}

export function UploadQueue({
  items,
  onDismiss,
}: {
  items: QueueItem[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="reveal rounded-xl border border-line bg-canvas shadow-soft">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">Upload queue</p>
          <span className="rounded-full bg-surface2 px-2 py-0.5 font-mono text-[10px] text-muted">
            {items.length}
          </span>
        </div>
        <span className="text-xs text-muted">Sequential · polite to quota</span>
      </header>

      <ul className="divide-y divide-line">
        {items.map((it) => {
          const b = badge(it.status);
          const isWorking = !["done", "cached", "error"].includes(it.status);
          const fill =
            it.status === "error" ? "bg-danger" :
            it.status === "cached" ? "bg-live" :
            it.status === "done" ? "bg-live" :
            "bg-accent";
          return (
            <li key={it.clientId} className="px-4 py-3">
              <div className="flex items-start gap-3">
                {/* File icon */}
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface text-muted">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                </div>

                {/* Body */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="truncate text-sm font-medium text-ink">{it.filename}</p>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${b.bg} ${b.fg}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />
                      {b.label}
                    </span>
                  </div>

                  <p className="mt-0.5 text-xs text-muted">
                    {it.error ? (
                      <span className="text-danger">{it.error}</span>
                    ) : (
                      <>
                        <span>{fmtSize(it.size)}</span>
                        {it.pages != null && <> · {it.pages} pages</>}
                        {it.chunks != null && <> · {it.chunks} chunks</>}
                        {it.stage && <> · {it.stage}</>}
                      </>
                    )}
                  </p>

                  {/* Progress bar */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface2">
                      <div
                        className={`absolute inset-y-0 left-0 transition-[width] duration-300 ${fill} ${
                          isWorking ? "shadow-[0_0_8px_rgba(255,107,0,0.45)]" : ""
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, it.progress))}%` }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">
                      {Math.round(it.progress)}%
                    </span>
                    {(it.status === "done" || it.status === "cached" || it.status === "error") && (
                      <button
                        type="button"
                        onClick={() => onDismiss(it.clientId)}
                        className="text-mute2 hover:text-danger"
                        aria-label="Dismiss"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
