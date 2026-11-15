import { buildPageMetadata } from "@/lib/seo";
import { loadProfileSettings } from "@/services/profileSettings";
import ProfileSettingsView from "@/components/profile/settings/ProfileSettingsView";

export const metadata = buildPageMetadata({ title: "Налаштування профілю", description: "Особисті дані, звертання, Discord і рейдова роль.", path: "/profile" });
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfileSettingsPage(props: Parameters<typeof loadProfileSettings>[0]) {
  return <ProfileSettingsView {...await loadProfileSettings(props)} />;
}
