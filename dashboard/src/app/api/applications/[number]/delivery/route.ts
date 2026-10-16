import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageApplications } from "@/lib/permissions";
import { getIssue } from "@/lib/applicationsStore";
import { processApplicationDelivery, readApplicationDelivery } from "@/lib/applicationDelivery";
import { getDiscordGuildId, parseDiscordMessageRef } from "@/lib/discordAdmin";
import { checkRateLimit, noStoreHeaders, unauthorizedResponse, forbiddenResponse, verifyTrustedOrigin } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStoreHeaders() });
async function identity(context: { params: Promise<{ number: string }> }) {
  const number = Number((await context.params).number);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  const issue = await getIssue(number);
  return { number, options: { resourceId: String(issue.id || `application-${number}`) } };
}
export async function GET(_request: NextRequest, context: { params: Promise<{ number: string }> }) {
  const session = await getSession(); if (!session) return unauthorizedResponse(); if (!canManageApplications(session)) return forbiddenResponse();
  try {
    const id = await identity(context); if (!id) return reply({ error: "Невірний номер заявки." }, 400);
    return reply({ ok: true, delivery: await readApplicationDelivery(id.number, id.options) });
  } catch { return reply({ error: "Стан доставки тимчасово недоступний." }, 503); }
}
export async function POST(request: NextRequest, context: { params: Promise<{ number: string }> }) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();
  const session = await getSession(); if (!session) return unauthorizedResponse(); if (!canManageApplications(session)) return forbiddenResponse();
  if (!checkRateLimit(`application-delivery:${session.id}`, 12, 60_000).ok) return reply({ error: "Забагато запитів. Зачекай хвилину." }, 429);
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({ error: "Потрібен JSON." }, 415);
    const reader = request.body?.getReader(); if (!reader) return reply({ error: "Порожній запит." }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2048) { await reader.cancel(); return reply({ error: "Запит завеликий." }, 413); } chunks.push(value); } } finally { reader.releaseLock(); }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply({ error: "Некоректний JSON." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["messageUrl"].includes(key)) || body.messageUrl !== undefined && typeof body.messageUrl !== "string") return reply({ error: "Некоректні параметри." }, 400);
    if (body.messageUrl) {
      let url; try { url = new URL(body.messageUrl); } catch { return reply({ error: "Некоректне посилання Discord." }, 400); }
      if (url.protocol !== "https:" || !["discord.com", "www.discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^\/channels\/\d{16,25}\/\d{16,25}\/\d{16,25}\/?$/.test(url.pathname)) return reply({ error: "Потрібне повне HTTPS-посилання на повідомлення Discord." }, 400);
    }
    const manualRef = body.messageUrl ? parseDiscordMessageRef(body.messageUrl) : null;
    if (body.messageUrl && (!manualRef || manualRef.guildId !== getDiscordGuildId())) return reply({ error: "Потрібне посилання на повідомлення Discord." }, 400);
    const id = await identity(context); if (!id) return reply({ error: "Невірний номер заявки." }, 400);
    const delivery = await processApplicationDelivery(id.number, { ...id.options, force: true, manualRef });
    return reply({ ok: true, delivery });
  } catch { return reply({ error: "Доставку не підтверджено. Перевір збережений стан перед повторною дією." }, 503); }
}
