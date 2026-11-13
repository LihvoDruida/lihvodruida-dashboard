import { NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Site raid attendance has been retired. Only signed Discord interactions
 * handled by the bot may change raid signup state. */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "discord_only", message: "Запис на рейд доступний лише через Discord." },
    { status: 410, headers: noStoreHeaders() },
  );
}
