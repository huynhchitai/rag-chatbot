// Copy the pdfjs-dist worker into /public so PdfViewer can load it
// from the same origin (no CDN dependency). Runs in dev + build via npm scripts.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsPkg = require.resolve("pdfjs-dist/package.json");
const src = join(dirname(pdfjsPkg), "build", "pdf.worker.min.mjs");
const dest = join(process.cwd(), "public", "pdf.worker.min.mjs");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`✓ pdfjs worker → ${dest}`);
