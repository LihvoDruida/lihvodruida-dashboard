import { buildPageMetadata } from "@/lib/seo";
import { loadProfileDirectory } from "@/services/profileDirectory";
import ProfileDirectoryView from "@/components/profile/directory/ProfileDirectoryView";

export const metadata = buildPageMetadata({ title: "Профілі учасників", description: "Каталог учасників, персонажів і Battle.net-підключень.", path: "/profiles" });
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function ProfilesPage(props: Parameters<typeof loadProfileDirectory>[0]) {
  return <ProfileDirectoryView {...await loadProfileDirectory(props)} />;
}
