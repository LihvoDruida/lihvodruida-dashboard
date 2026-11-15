import { buildPageMetadata } from "@/lib/seo";
import { loadProfileOverview } from "@/services/profileOverview";
import ProfileOverviewView from "@/components/profile/ProfileOverviewView";

export const metadata = buildPageMetadata({ title: "Профіль учасника", description: "Персонажі, Battle.net та рейдові записи учасника.", path: "/profile" });
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfilePage(props: Parameters<typeof loadProfileOverview>[0]) {
  return <ProfileOverviewView {...await loadProfileOverview(props)} />;
}
