function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getProfileIdSecret() {
  const secret = process.env.PROFILE_ID_SECRET || process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (secret.length < 32) {
    throw new Error("PROFILE_ID_SECRET або SESSION_SECRET має бути налаштований і містити щонайменше 32 символи.");
  }
  return secret;
}

export async function createStableProfileId(provider: string, providerUserId: string) {
  const cleanProvider = String(provider || "discord").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "discord";
  const cleanUserId = String(providerUserId || "").trim();
  if (!cleanUserId) throw new Error("Cannot create profile id without user id.");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getProfileIdSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${cleanProvider}:${cleanUserId}`));
  return `id${bytesToHex(new Uint8Array(signature)).slice(0, 24)}`;
}
