/**
 * Спільні хелпери для cookie з nonce-ами OAuth.
 *
 * `start` і `callback` тримали ідентичні копії всіх трьох функцій, а це
 * симетрична пара: одна сторона пише cookie, друга його читає. Розходження
 * копій означало б, що користувач із двома паралельно відкритими вкладками
 * не може завершити вхід — і зловити це можна тільки в проді.
 */

/**
 * Скільки паралельних спроб входу памʼятаємо. Людина може почати вхід у
 * двох вкладках; без буфера друга затирала б nonce першої.
 */
export const MAX_PARALLEL_OAUTH_FLOWS = 8;

export function normalizeOAuthNonces(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter((item): item is string => Boolean(item)),
    ),
  ).slice(-MAX_PARALLEL_OAUTH_FLOWS);
}

export function parseRememberedOAuthNonces(value?: string | null): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed
          && typeof parsed === "object"
          && Array.isArray((parsed as { nonces?: unknown }).nonces)
        ? (parsed as { nonces: unknown[] }).nonces
        : [];
    return normalizeOAuthNonces(list);
  } catch {
    // Сумісність зі старим cookie на один state: там лежить цілий токен,
    // тому лишаємо його кандидатом, а не видаляємо.
    return [raw];
  }
}

export function serializeRememberedOAuthNonces(nonces: string[]) {
  return JSON.stringify({ v: 1, nonces: normalizeOAuthNonces(nonces) });
}
