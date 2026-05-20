// Client-side SHA-256 via the Web Crypto API. Buffer-in, hex-out.
export async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = input instanceof Uint8Array ? input.buffer : input;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
