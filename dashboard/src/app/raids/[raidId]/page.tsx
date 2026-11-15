import {buildPageMetadata} from "@/lib/seo";
import {loadRaidDetailsWorkspace} from "@/services/raidDetailsWorkspace";
import RaidDetailsView from "@/components/raids/RaidDetailsView";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ raidId: string }> }) {
  const { raidId } = await params;
  const path = `/raids/${encodeURIComponent(raidId)}`;

  return buildPageMetadata({
    title: "Сторінка рейду",
    description: "Публічний перегляд рейду та складу. Запис на участь відбувається в Discord.",
    path,
    keywords: ["сторінка рейду", "запис на рейд", "рейд WoW"],
  });
}

export default async function RaidDetailsPage(props: {params: Promise<{raidId: string}>; searchParams: Promise<Record<string,string | undefined>>}) {
  return <RaidDetailsView {...await loadRaidDetailsWorkspace(props)} />;
}
