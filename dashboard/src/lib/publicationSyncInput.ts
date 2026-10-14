export async function readPublicationSyncInput(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 2048) throw new Error("Запит завеликий.");
  const body: unknown = text.trim() ? JSON.parse(text) : {};
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Некоректний запит.");
  const value = (body as Record<string, unknown>).publicationMessageUrl;
  if (value !== undefined && typeof value !== "string") throw new Error("Некоректне посилання Discord.");
  const url = (value || "").trim();
  if (url.length > 300) throw new Error("Посилання задовге.");
  if (url && !/^https:\/\/(?:www\.)?(?:discord\.com|discordapp\.com)\/channels\/\d{16,25}\/\d{16,25}\/\d{16,25}\/?$/.test(url)) throw new Error("Вкажи повне посилання на повідомлення Discord.");
  return url;
}
