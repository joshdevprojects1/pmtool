// Refresh-token encryption at rest (AES-256-GCM) and OAuth state signing.
// TOKEN_ENC_KEY: 64 hex chars (32 bytes). Generate one:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Production upgrades this to per-tenant keys from a KMS; the interface
// stays the same.

import {
  createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual,
} from "node:crypto";

function key(): any {
  const hex = process.env.TOKEN_ENC_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error("TOKEN_ENC_KEY must be 64 hex chars - see .env.example");
  }
  return Buffer.from(hex, "hex");
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"),
          enc.toString("hex")].join(".");
}

export function decryptToken(stored: string): string {
  const [ivHex, tagHex, encHex] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(),
                                    Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")),
                        decipher.final()]).toString("utf8");
}

// Signed OAuth state: carries context through the redirect round-trip and
// proves the callback came from a flow we started.
export function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", key()).update(body).digest("hex");
  return `${body}.${mac}`;
}

export function verifyState(state: string): Record<string, unknown> | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const body = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = createHmac("sha256", key()).update(body).digest("hex");
  const a = Buffer.from(expected); const b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}
