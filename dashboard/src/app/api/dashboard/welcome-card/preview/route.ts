import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { renderDiscordWelcomeCard } from "@/lib/discordWelcomeCard";
import { getDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { normalizeDiscordWelcomeCardTestInput, resolveDiscordWelcomeCardTestMember } from "@/lib/discordWelcomeCardTesting";
import { noStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: noStoreHeaders() });
  }
  if (!session.isServerOwner) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: noStoreHeaders() });
  }

  const url = new URL(request.url);
  const testInput = normalizeDiscordWelcomeCardTestInput({
    testUserId: url.searchParams.get("testUserId"),
    testDisplayName: url.searchParams.get("testDisplayName"),
    testUsername: url.searchParams.get("testUsername"),
    testGreeting: url.searchParams.get("testGreeting"),
    testNumber: url.searchParams.get("testNumber"),
    testNickname: url.searchParams.get("testNickname"),
  });
  const [settings, resolved] = await Promise.all([
    getDiscordWelcomeCardSettings(),
    resolveDiscordWelcomeCardTestMember(testInput),
  ]);

  const result = await renderDiscordWelcomeCard(resolved.member, settings, {
    greetingOverride: testInput.greeting || settings.greetings[0] || "Ishnu-alah!",
    numberOverride: testInput.number,
  });

  const bytes = new Uint8Array(result.buffer.byteLength);
  bytes.set(result.buffer);

  return new NextResponse(bytes.buffer, {
    status: 200,
    headers: {
      ...noStoreHeaders(),
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="${result.fileName || "welcome-preview.png"}"`,
      "X-Welcome-Preview-Live-Member": resolved.liveMember ? "1" : "0",
    },
  });
}
