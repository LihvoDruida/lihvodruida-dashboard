/** Shared by browser reports, console logging, ingestion and historical log reads. */
export function redactLogText(value: unknown): string {
  let text = String(value ?? "").slice(0, 65536);
  // Logs are presentation data, never URLs reused for requests. Decode ASCII
  // escapes before masking, including nested return URLs and encoded key names.
  for (let pass = 0; pass < 3; pass++) text = text.replace(/%([0-9a-f]{2})/gi, (whole, hex: string) => {
    const code = parseInt(hex, 16);
    return code < 128 ? String.fromCharCode(code) : whole;
  });
  return text
    .replace(/(?:https?:\/\/|\/)[^\s"'<>`]*/gi, (location) => {
      const query = location.search(/[?#]/);
      if (query < 0) return location;
      return location.slice(0, query) + (location[query] === "?" ? "?[redacted-query]" : "#[redacted-fragment]");
    })
    .replace(/\b(rt|code|state|access_token|refresh_token|id_token|[a-z0-9_]*token|[a-z0-9_]*secret|password|client_secret|proof|signature)\s*=\s*[^\s&;#"'<>]+/gi, "$1=[redacted]")
    .replace(/ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|mfa\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/\b(Bot|Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [redacted]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+(@)/gi, "$1[redacted]$2")
    .replace(/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
}

export function isSensitiveLogKey(key: string): boolean {
  return /token|secret|password|authorization|cookie|signature|private.?key|raw.?body/i.test(key) || /^(rt|oauth_?state|authorization_?code|proof)$/i.test(key);
}

export function safeClientLogLocation(value: unknown): string {
  const text = String(value ?? "");
  // Strip before truncating: an incomplete token can still expose its claims.
  return redactLogText(text.split(/[?#]/, 1)[0]).slice(0, 500);
}

/** Bounded diagnostic codes only; error messages and causes never become payloads. */
export function diagnosticErrorSummary(error: unknown) {
  const data = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = data.cause && typeof data.cause === "object" ? data.cause as Record<string, unknown> : {};
  const allowed = new Set(["40001", "40P01", "08000", "08003", "08006", "53300", "53400", "57P01", "55P03", "57014", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
  const code = [data.code, cause.code].find(value => typeof value === "string" && allowed.has(value)) as string | undefined;
  const errorCode = code || null;
  const errorKind = code === "40001" || code === "40P01" ? "transaction_conflict"
    : code === "55P03" ? "database_busy"
    : code === "57014" || code === "ETIMEDOUT" || code?.includes("TIMEOUT") || /timeout|timed out/i.test(String(data.message || "").slice(0, 1200)) ? "timeout"
    : code?.startsWith("08") || ["53300", "53400", "57P01"].includes(code || "") ? "database_unavailable"
    : code ? "network"
    : data.name === "AbortError" ? "aborted" : "unexpected";
  return { errorKind, errorCode };
}
