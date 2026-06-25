import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { fetchDiscordRoles, fetchDiscordTextChannels, hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { canManageRaids } from "@/lib/permissions";
import { getRaid, hasRaidStorage } from "@/lib/raids";
import { RaidForm, RaidPageShell, RaidUnavailableState, RosterSideList, StatusNotice } from "@/components/RaidViews";
import RaidEditorLivePreview from "@/components/RaidEditorLivePreview";
import { buildPageMetadata } from "@/lib/seo";
import { getOwnProfilePath } from "@/lib/profiles";

export const metadata = buildPageMetadata({
  title: "Редагування рейду",
  description: "Оновлення рейду Mistblossom Vanguard: дата, опис, склад, ліміти, ролі й Discord-оголошення для учасників.",
  path: "/raids/edit",
  keywords: ["редагування рейду", "рейдовий склад", "Discord оголошення"],
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EditRaidPage({
  params, searchParams }: { params: Promise<{ raidId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canManageRaids(user)) redirect(await getOwnProfilePath(user));

  const { raidId } = await params;
  const query = await searchParams;
  const raid = await getRaid(raidId);
  const discordEnabled = hasDiscordEmbedConfig();
  let channels: Array<{ id: string; name: string }> = [];
  let roles: Array<{ id: string; name: string; color: number; position: number; managed: boolean }> = [];
  let channelWarning = "";
  if (discordEnabled) {
    const [channelsResult, roleData] = await Promise.all([
      fetchDiscordTextChannels().catch(() => null),
      fetchDiscordRoles().catch(() => []),
    ]);
    const suggestedChannelId = channelsResult?.suggestedChannelId || "";
    const rawChannels = channelsResult?.channels || [];
    channels = suggestedChannelId
      ? [
          ...rawChannels.filter((channel) => channel.id === suggestedChannelId),
          ...rawChannels.filter((channel) => channel.id !== suggestedChannelId),
        ]
      : rawChannels;
    channelWarning = channelsResult?.warning || "";
    roles = roleData;
  }

  return (
    <RaidPageShell
      user={user}
      title="Редагування рейду"
      description="Редагуй дані рейду, склад, ліміти й Discord-оголошення. Сторінка рейду для учасників залишається окремою."
    >
      <StatusNotice params={query} />
      {!hasRaidStorage() ? <div className="notice panel error-note raid-notice">Збереження рейдів тимчасово недоступне. Спробуй пізніше або звернись до гільдмайстра.</div> : null}
      {!discordEnabled ? <div className="notice panel error-note raid-notice">Публікація в Discord тимчасово недоступна. Зміни можна зберегти й опублікувати пізніше.</div> : null}
      {discordEnabled && channelWarning ? <div className="notice panel warning-note raid-notice">Список Discord-каналів прочитано з попередженням: {channelWarning}</div> : null}

      {raid ? (
        <section className="raid-editor-layout">
          <RaidForm raid={raid} channels={channels} roles={roles} discordEnabled={discordEnabled} />
          <div className="raid-preview-column">
            <RaidEditorLivePreview initialRaid={raid} />
            <RosterSideList raid={raid} />
          </div>
        </section>
      ) : <RaidUnavailableState canManage />}
    </RaidPageShell>
  );
}
