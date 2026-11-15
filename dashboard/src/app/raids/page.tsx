import {buildPageMetadata} from "@/lib/seo";
import {loadRaidDirectoryWorkspace} from "@/services/raidDirectoryWorkspace";
import RaidDirectoryView from "@/components/raids/RaidDirectoryView";
export const runtime = "nodejs";
export const metadata = buildPageMetadata({
  title: "Рейди",
  description:
    "Публічний список рейдів, склад, правила та архів. Запис відбувається тільки в Discord.",
  path: "/raids",
  keywords: ["рейди WoW", "запис на рейд", "архів рейдів"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RaidsListPage(props: {searchParams: Promise<Record<string, string | undefined>>}) {
  return <RaidDirectoryView {...await loadRaidDirectoryWorkspace(props)} />;
}
