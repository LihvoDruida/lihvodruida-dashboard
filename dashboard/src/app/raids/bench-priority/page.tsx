import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageRaids } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { loadStoredGuildRosterData } from "@/lib/guildRoster";
import {
  getRaidBenchPrioritySettings,
  hasRaidStorage,
} from "@/lib/raids";
import { buildBattleNetCharacterKey, normalizeCharacterKey } from "@/lib/wowCharacters";
import { RaidPageShell, StatusNotice } from "@/components/RaidViews";
import RaidBenchPriorityManager, {
  type RaidBenchPriorityRosterMember,
} from "@/components/RaidBenchPriorityManager";
import { buildPageMetadata } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Сірий список рейдів",
  description:
    "Глобальний список персонажів, які поступаються місцем у рейдовому складі та переходять на лаву запасних при вичерпанні лімітів.",
  path: "/raids/bench-priority",
  keywords: ["сірий список рейдів", "лава запасних", "рейдовий склад"],
});

export default async function RaidBenchPriorityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canManageRaids(user)) redirect(await getOwnProfilePath(user));

  const params = await searchParams;
  const [settings, roster] = await Promise.all([
    getRaidBenchPrioritySettings({ bypassCache: true }).catch(() => null),
    loadStoredGuildRosterData().catch(() => null),
  ]);
  const rosterMembers = (roster?.members || [])
    .filter((member) => member.name && (member.key || member.realmSlug))
    .sort((a, b) =>
      a.name.localeCompare(b.name, "uk") ||
      String(a.realmName || a.realmSlug).localeCompare(
        String(b.realmName || b.realmSlug),
        "uk",
      ),
    );
  const benchRosterMembers = rosterMembers
    .map<RaidBenchPriorityRosterMember | null>((member) => {
      const canonicalKey =
        buildBattleNetCharacterKey(
          member.region || "eu",
          member.realmSlug || member.realmName,
          member.name,
        ) || normalizeCharacterKey(member.key);
      if (!canonicalKey) return null;
      return {
        key: canonicalKey,
        sourceKey: member.key || null,
        name: member.name,
        region: member.region,
        realmName: member.realmName,
        realmSlug: member.realmSlug,
        className: member.className,
        specName: member.specName,
        itemLevel: member.itemLevel,
        avatarUrl: member.avatarUrl,
        ownerDisplayName: member.ownerDisplayName,
      } satisfies RaidBenchPriorityRosterMember;
    })
    .filter((member): member is RaidBenchPriorityRosterMember => member !== null);
  const rosterKeySet = new Set(benchRosterMembers.map((member) => member.key));
  const missingSelectedKeys = (settings?.characterKeys || []).filter(
    (key) => !rosterKeySet.has(normalizeCharacterKey(key) || key),
  );

  return (
    <RaidPageShell
      user={user}
      title="Сірий список рейдів"
      description="Глобальна лава пріоритету: ці персонажі не видаляються із запису, але при заповненому ліміті першими поступаються місцем і переходять у лаву запасних."
    >
      <StatusNotice params={params} />
      {!hasRaidStorage() ? (
        <div className="notice panel error-note raid-notice">
          Збереження сірого списку тимчасово недоступне: Firebase не відповідає
          або не налаштований.
        </div>
      ) : null}

      <section className="panel raid-list-page-panel raid-greylist-panel">
        <div className="raid-list-page-head raid-greylist-head">
          <div>
            <h2>Глобальні правила лави запасних</h2>
            <p>
              Список застосовується до всіх рейдів. Коли `maxPlayers` уже
              заповнений, звичайний учасник може зайняти місце, а персонаж із
              цього списку піде на лаву запасних. Якщо місць вистачає — він
              залишається у складі.
            </p>
            <div className="raid-list-summary">
              <span>Зі складу: {settings?.characterKeys.length || 0}</span>
              <span>Вручну: {settings?.manualNames.length || 0}</span>
              <span>{settings?.enabled === false ? "Вимкнено" : "Увімкнено"}</span>
            </div>
          </div>
          <a className="btn subtle" href="/raids">
            ← До рейдів
          </a>
        </div>

        <RaidBenchPriorityManager
          enabled={settings?.enabled !== false}
          rosterMembers={benchRosterMembers}
          selectedKeys={settings?.characterKeys || []}
          missingSelectedKeys={missingSelectedKeys}
          manualNames={settings?.manualNames || []}
          rosterError={roster?.error || null}
        />
      </section>
    </RaidPageShell>
  );
}
