import type {RaidPollItem} from "@/lib/raidPolls";
import {buildRaidPollCardModel} from "@/lib/raidPollPresentation";
import RaidPollBrowser from "@/components/RaidPollBrowser";
export default function PollDirectoryList({polls,relatedPolls,canManage = false,navigationScope,createHref}: {polls: RaidPollItem[];relatedPolls?: RaidPollItem[];canManage?: boolean;navigationScope: string;createHref?: string}) {
  const related = relatedPolls?.length ? relatedPolls : polls;
  const cards = polls.map(poll => buildRaidPollCardModel(poll,related));
  return <RaidPollBrowser key={navigationScope} cards={cards} canManage={canManage} navigationScope={navigationScope} createHref={createHref} />;
}
