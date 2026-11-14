import "server-only";

function getSecret() {
  const secret =
    process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set and at least 32 characters long.",
    );
  }
  return secret;
}

export function base64UrlEncode(input: string | Uint8Array) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (c) => c.charCodeAt(0)),
  );
}

export async function sign(data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

export function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** Cheap cryptographic gate; membership, revocation and RBAC are checked by getSession. */
export async function verifySessionEnvelope(token?: string | null): Promise<Record<string, unknown> | null> {
  if (!token || token.length > 8192) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !/^[A-Za-z0-9_-]{43}$/.test(signature || "") || extra) return null;
  try {
    if (!constantTimeEqual(await sign(payload), signature)) return null;
    const parsed = JSON.parse(base64UrlDecode(payload));
    const now = Math.floor(Date.now() / 1000);
    if (!parsed || parsed.aud !== "mistblossom-dashboard" ||
        !["discord", "token"].includes(parsed.provider) ||
        !["admin", "moderator", "mentor", "member"].includes(parsed.role) ||
        typeof parsed.id !== "string" || !parsed.id.trim() ||
        !Number.isSafeInteger(parsed.iat) || !Number.isSafeInteger(parsed.exp) ||
        parsed.iat > now + 60 || parsed.exp <= now || parsed.exp <= parsed.iat ||
        parsed.exp - parsed.iat > 30 * 24 * 60 * 60) return null;
    return parsed;
  } catch {
    return null;
  }
}
