"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function transformChildren(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      const parts = child.split(/(\[Source \d+\])/g);
      if (parts.length === 1) return child;
      return parts.map((part, i) => {
        const m = part.match(/^\[Source (\d+)\]$/);
        if (m) {
          return (
            <sup
              key={i}
              className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-semibold leading-none text-canvas"
              aria-label={`Source ${m[1]}`}
            >
              {m[1]}
            </sup>
          );
        }
        return part;
      });
    }
    if (React.isValidElement(child)) {
      const props = child.props as { children?: React.ReactNode };
      const newChildren = transformChildren(props.children);
      return React.cloneElement(child, child.props as object, newChildren);
    }
    return child;
  });
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown text-[15px] leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="mb-2 mt-5 text-xl font-bold tracking-tight text-ink first:mt-0">
              {transformChildren(children)}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-5 text-lg font-bold tracking-tight text-ink first:mt-0">
              {transformChildren(children)}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1.5 mt-4 text-base font-semibold text-ink first:mt-0">
              {transformChildren(children)}
            </h4>
          ),
          h4: ({ children }) => (
            <h5 className="mb-1 mt-3 text-[15px] font-semibold text-ink first:mt-0">
              {transformChildren(children)}
            </h5>
          ),
          p: ({ children }) => (
            <p className="my-2.5 first:mt-0 last:mb-0">{transformChildren(children)}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-ink">{transformChildren(children)}</strong>
          ),
          em: ({ children }) => <em className="italic">{transformChildren(children)}</em>,
          ul: ({ children }) => <ul className="my-2.5 space-y-1.5 pl-1">{children}</ul>,
          ol: ({ children, start }) => (
            <ol
              start={start ?? undefined}
              className="my-2.5 list-inside list-decimal space-y-1.5 marker:font-mono marker:text-xs marker:text-muted"
            >
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="flex gap-2.5 leading-relaxed">
              <span className="mt-[0.55em] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span className="flex-1">{transformChildren(children)}</span>
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 rounded-r-md border-l-2 border-accent bg-accentSoft/30 py-2 pl-3.5 pr-3 italic text-ink2">
              {transformChildren(children)}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
              {transformChildren(children)}
            </a>
          ),
          hr: () => <hr className="my-5 border-0 border-t border-line" />,
          code: ({ children, className }) => {
            const isBlock = /language-/.test(className || "");
            if (isBlock) {
              return (
                <code className={`font-mono text-[12.5px] leading-relaxed ${className || ""}`}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded-md border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[0.85em] text-ink2">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg border border-line bg-ink px-4 py-3 text-canvas">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-line bg-surface text-left">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
              {transformChildren(children)}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-t border-line px-3 py-2 align-top">
              {transformChildren(children)}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
