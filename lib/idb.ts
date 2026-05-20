// Tiny IndexedDB wrapper for caching uploaded PDFs in the browser.
// Keyed by content hash → so re-opening the page restores the library
// without re-uploading or re-downloading from the server.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface StoredDoc {
  hash: string;          // sha256 hex — primary key
  filename: string;
  size: number;
  pages: number;
  chunks: number;
  docId: string;         // server-side document id
  addedAt: number;       // unix ms
  blob: Blob;            // the PDF file itself
}

interface RagDB extends DBSchema {
  docs: {
    key: string;
    value: StoredDoc;
    indexes: { "by-added": number };
  };
}

const DB_NAME = "rag-chatbot";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<RagDB>> | null = null;

function getDB(): Promise<IDBPDatabase<RagDB>> {
  if (!dbPromise) {
    dbPromise = openDB<RagDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore("docs", { keyPath: "hash" });
        store.createIndex("by-added", "addedAt");
      },
    });
  }
  return dbPromise;
}

export async function putDoc(doc: StoredDoc): Promise<void> {
  const db = await getDB();
  await db.put("docs", doc);
}

export async function getDoc(hash: string): Promise<StoredDoc | undefined> {
  const db = await getDB();
  return db.get("docs", hash);
}

export async function listDocs(): Promise<StoredDoc[]> {
  const db = await getDB();
  const tx = db.transaction("docs");
  const index = tx.store.index("by-added");
  const docs: StoredDoc[] = [];
  let cursor = await index.openCursor(null, "prev");
  while (cursor) {
    docs.push(cursor.value);
    cursor = await cursor.continue();
  }
  return docs;
}

export async function deleteDoc(hash: string): Promise<void> {
  const db = await getDB();
  await db.delete("docs", hash);
}

export async function clearAll(): Promise<void> {
  const db = await getDB();
  await db.clear("docs");
}
