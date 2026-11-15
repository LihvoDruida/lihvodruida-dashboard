import {buildPageMetadata} from "@/lib/seo";
import {loadPollDirectoryWorkspace} from "@/services/pollWorkspace";
import PollDirectoryView from "@/components/polls/PollDirectoryView";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Рейд-пули",
  description: "Голосування за доступність гравців для рейдів Mistblossom Vanguard із Discord та сайтом.",
  path: "/polls",
  keywords: ["рейд-пул", "голосування рейдів", "Discord голосування"],
});

export default async function PollsPage() {
  return <PollDirectoryView {...await loadPollDirectoryWorkspace()} />;
}
