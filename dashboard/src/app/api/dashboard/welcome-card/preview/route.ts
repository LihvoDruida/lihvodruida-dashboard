import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { createDiscordWelcomeArtifact } from "@/lib/discordWelcomeArtifact";
import { getDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { normalizeDiscordWelcomeCardTestInput, resolveDiscordWelcomeCardTestMember } from "@/lib/discordWelcomeCardTesting";
import { checkRateLimit, getClientIp, noStoreHeaders, safeErrorMessage } from "@/lib/security";

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

  const rate = checkRateLimit(`welcome-preview:${session.id}:${getClientIp(request)}`, 120, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: noStoreHeaders() });
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
  try {
    const [settings, resolved] = await Promise.all([
      getDiscordWelcomeCardSettings(),
      resolveDiscordWelcomeCardTestMember(testInput),
    ]);

    const artifact = await createDiscordWelcomeArtifact(resolved.member, settings, {
      greetingOverride: testInput.greeting || settings.greetings[0] || "Ishnu-alah!",
      numberOverride: testInput.number,
      mentionOverride: resolved.liveMember && testInput.userId ? `<@${testInput.userId}>` : "@тестовий-учасник",
    });

    const bytes = Uint8Array.from(artifact.buffer);
    return new NextResponse(bytes.buffer, {
      status: 200,
      headers: {
        ...noStoreHeaders(),
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${artifact.fileName || "welcome-preview.png"}"`,
        "X-Welcome-Preview-Live-Member": resolved.liveMember ? "1" : "0",
        "X-Welcome-Renderer": "server-sharp",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "preview_failed", message: safeErrorMessage(error, "Не вдалося згенерувати preview welcome-картки.") },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
