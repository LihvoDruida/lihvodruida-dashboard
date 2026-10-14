import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRaidReminderPreference } from "@/lib/discordNotificationPreferences";
import { noStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSession();
  if (user?.provider !== "discord" || user.impersonatedBy || !/^\d{16,25}$/.test(user.id)) {
    return NextResponse.json({ error: "discord_login_required" }, { status: 401, headers: noStoreHeaders() });
  }
  try {
    const preference = await getRaidReminderPreference(user.id);
    return NextResponse.json({ enabled: preference.enabled }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "preference_unavailable" }, { status: 503, headers: noStoreHeaders() });
  }
}
