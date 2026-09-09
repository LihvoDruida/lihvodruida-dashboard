import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Перевірка живості процесу.
 *
 * Навмисно НЕ ходить у Firebase, Discord чи Battle.net і не читає сесію:
 * це liveness, а не readiness. Якщо додати сюди зовнішні виклики, то
 * недоступність Raider.IO почне перезапускати контейнер панелі.
 * Стан інтеграцій дивись на `/dashboard` — там для цього окрема панель.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "mistblossom-dashboard",
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    },
    { headers: noStoreHeaders() },
  );
}
