import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";

const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_REGION ?? "us-central1";

if (!project) throw new Error("Missing GOOGLE_CLOUD_PROJECT");

// Three accepted formats, in priority order:
//   1. GOOGLE_APPLICATION_CREDENTIALS       — file path (best for local dev)
//   2. GOOGLE_APPLICATION_CREDENTIALS_B64   — base64-encoded JSON (best for Vercel/cloud)
//   3. GOOGLE_APPLICATION_CREDENTIALS_JSON  — raw inline JSON on a single line
function loadCredentials(): Record<string, unknown> | undefined {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    try {
      return JSON.parse(fs.readFileSync(path, "utf-8"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new Error(`Could not load GOOGLE_APPLICATION_CREDENTIALS at "${path}": ${msg}`);
    }
  }

  const b64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_B64;
  if (b64) {
    try {
      return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
    } catch {
      throw new Error("GOOGLE_APPLICATION_CREDENTIALS_B64 is not valid base64-encoded JSON.");
    }
  }

  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(
        "GOOGLE_APPLICATION_CREDENTIALS_JSON could not be parsed. " +
          "It must be a SINGLE LINE of valid JSON (the `\\n` inside private_key are escape sequences, not real newlines). " +
          "For local dev, prefer GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json instead.",
      );
    }
  }

  // No explicit credentials — fall back to ADC (gcloud auth application-default login, GCE metadata, etc.)
  return undefined;
}

const credentials = loadCredentials();

export const vertex = new GoogleGenAI({
  vertexai: true,
  project,
  location,
  googleAuthOptions: credentials ? { credentials } : undefined,
});

export const GEN_MODEL = "gemini-2.5-flash";
export const EMBED_MODEL = "text-embedding-004"; // 768 dims
