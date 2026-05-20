// Client-side SHA-256 via the Web Crypto API. ArrayBuffer-in, hex-out.
// (Narrowed to ArrayBuffer because TS 5.7+ treats Uint8Array as Uint8Array<ArrayBufferLike>
// which can't be passed to crypto.subtle.digest's BufferSource parameter.)
export async function sha256Hex(input: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
