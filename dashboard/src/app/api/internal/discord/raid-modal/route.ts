import { NextRequest, NextResponse } from "next/server";
import { verifyDiscordInteractionSignature, getDiscordGuildId } from "@/lib/discordAdmin";
import { prepareRaidSignupModal } from "@/lib/raids";
import { assertRequestBodySize, noStoreHeaders, verifyInternalBearerToken, safeErrorMessage } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Stateless, signed, read-only form preparation. Discord requires a native
 * MODAL (type 9) as the immediate interaction response, before the 3s ACK.
 * The write itself still travels through the durable ingress/outbox pipeline.
 */
export async function POST(request: NextRequest) {
  const tooLarge = assertRequestBodySize(request, 64 * 1024);
  if (tooLarge) return tooLarge;
  const auth = await verifyInternalBearerToken(request, ["INTERNAL_API_TOKEN"], { minLength: 24 });
  if (!auth.ok || request.headers.get("x-mistblossom-source") !== "bot") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStoreHeaders() });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 64 * 1024 || !(await verifyDiscordInteractionSignature(request, rawBody))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401, headers: noStoreHeaders() });
  }
  try {
    const interaction = JSON.parse(rawBody);
    const userId = String(interaction.member?.user?.id || interaction.user?.id || "");
    if (interaction.type !== 3 || interaction.guild_id !== getDiscordGuildId() || !/^\d{16,25}$/.test(userId) || !(Number(interaction.message?.flags || 0) & 64)) throw new Error("invalid_interaction");
    const result = await prepareRaidSignupModal({ customId: String(interaction.data?.custom_id || ""), userId, guildId: interaction.guild_id });
    return NextResponse.json(result, { headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 400, headers: noStoreHeaders() });
  }
}
