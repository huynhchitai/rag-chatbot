"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface ChunkHighlight {
  page: number;
  content: string;
}

interface Props {
  file: Blob | null;
  highlight: ChunkHighlight | null;
  filename: string;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

export function PdfViewer({ file, highlight, filename }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const [data, setData] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (!file) {
      setData(null);
      return;
    }
    let cancelled = false;
    file.arrayBuffer().then((buf) => {
      if (!cancelled) setData(new Uint8Array(buf));
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const fileProp = useMemo(() => (data ? { data } : null), [data]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setWidth(Math.max(200, Math.floor(w - 16)));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setPage(1);
    setNumPages(null);
  }, [file]);

  useEffect(() => {
    if (highlight) setPage(highlight.page);
  }, [highlight]);

  const customTextRenderer = useCallback(
    (textItem: { str: string }) => {
      if (!highlight || highlight.page !== page) return escapeHtml(textItem.str);
      const s = textItem.str.trim();
      if (s.length < 2) return escapeHtml(textItem.str);
      const normalizedChunk = normalize(highlight.content);
      const normalizedItem = normalize(s);
      if (normalizedItem.length > 0 && normalizedChunk.includes(normalizedItem)) {
        return `<mark style="background:rgba(255,107,0,0.32);color:inherit;padding:0.05em 0;border-radius:2px;">${escapeHtml(textItem.str)}</mark>`;
      }
      return escapeHtml(textItem.str);
    },
    [highlight, page],
  );

  if (!file) {
    return (
      <div className="grid h-full place-items-center bg-surface text-center">
        <div>
          <svg className="mx-auto text-mute2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <p className="mt-3 text-sm font-medium text-ink2">No document open</p>
          <p className="mt-1 text-xs text-muted">Pick a document from the library</p>
        </div>
      </div>
    );
  }

  const canPrev = page > 1;
  const canNext = numPages !== null && page < numPages;

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{filename}</p>
          {highlight && (
            <p className="font-mono text-[10px] text-accent">
              ● highlight on page {highlight.page}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-line bg-canvas p-0.5 shadow-soft">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!canPrev}
            className="grid h-7 w-7 place-items-center rounded text-ink2 hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Previous page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="px-2 font-mono text-xs tabular-nums text-ink2">
            {page} / {numPages ?? "—"}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={!canNext}
            className="grid h-7 w-7 place-items-center rounded text-ink2 hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Next page"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 overflow-auto p-4">
        {fileProp && (
          <Document
            file={fileProp}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            loading={
              <div className="grid place-items-center py-12 text-sm text-muted">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                  Loading PDF…
                </div>
              </div>
            }
            error={
              <div className="grid place-items-center py-12 text-sm text-danger">
                Failed to render PDF
              </div>
            }
            className="flex flex-col items-center"
          >
            {width > 0 && (
              <div className="rounded-md border border-line bg-canvas shadow-lift">
                <Page
                  pageNumber={page}
                  width={width}
                  renderAnnotationLayer={false}
                  customTextRenderer={customTextRenderer}
                />
              </div>
            )}
          </Document>
        )}
      </div>
    </div>
  );
}
