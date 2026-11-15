import {buildPageMetadata} from "@/lib/seo";
import {loadPollDetailsWorkspace} from "@/services/pollWorkspace";
import PollDetailsView from "@/components/polls/PollDetailsView";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ pollId: string }> }) {
  const { pollId } = await params;
  return buildPageMetadata({
    title: "Рейд-пул",
    description: "Детальні результати рейд-пулу Mistblossom Vanguard.",
    path: `/polls/${encodeURIComponent(pollId)}`,
    keywords: ["рейд-пул", "результати голосування", "Discord poll"],
  });
}

export default async function PollDetailsPage(props: {params: Promise<{pollId: string}>}) {
  return <PollDetailsView {...await loadPollDetailsWorkspace(props)} />;
}
