"use client";

export interface LibraryDoc {
  hash: string;
  docId: string;
  filename: string;
  pages: number;
  chunks: number;
  addedAt: number;
}

function ago(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function DocLibrary({
  docs,
  activeHash,
  onSelect,
  onRemove,
}: {
  docs: LibraryDoc[];
  activeHash: string | null;
  onSelect: (hash: string) => void;
  onRemove: (hash: string) => void;
}) {
  if (docs.length === 0) return null;

  return (
    <section className="reveal">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">Your library</p>
          <span className="rounded-full bg-surface2 px-2 py-0.5 font-mono text-[10px] text-muted">
            {docs.length}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14a9 3 0 0 0 18 0V5" />
            <path d="M3 12a9 3 0 0 0 18 0" />
          </svg>
          Stored locally in your browser
        </span>
      </div>

      <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2">
        {docs.map((d) => {
          const active = d.hash === activeHash;
          return (
            <div key={d.hash} className="group relative shrink-0">
              <button
                type="button"
                onClick={() => onSelect(d.hash)}
                className={`flex w-60 flex-col gap-1.5 rounded-xl border p-3 text-left transition-all ${
                  active
                    ? "border-accent bg-accent text-canvas shadow-soft"
                    : "border-line bg-canvas text-ink hover:border-line2 hover:shadow-soft"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
                      active ? "bg-canvas/15" : "bg-surface2"
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </svg>
                  </div>
                  {active && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-canvas/15 px-2 py-0.5 text-[10px] font-semibold">
                      <span className="h-1.5 w-1.5 rounded-full bg-canvas" /> Active
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{d.filename}</p>
                <div
                  className={`flex items-center justify-between text-[11px] ${
                    active ? "text-canvas/75" : "text-muted"
                  }`}
                >
                  <span className="font-mono">{d.pages}p · {d.chunks}c</span>
                  <span>{ago(d.addedAt)}</span>
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(d.hash);
                }}
                aria-label="Remove from library"
                className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-line bg-canvas text-danger shadow-soft hover:border-danger group-hover:flex"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
