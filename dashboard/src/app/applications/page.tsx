import { buildPageMetadata } from "@/lib/seo";
import { loadApplicationWorkspace } from "@/services/applicationWorkspace";
import ApplicationWorkspaceView from "@/components/applications/ApplicationWorkspaceView";
export const metadata = buildPageMetadata({
  title: "Заявки до гільдії",
  description: "Перегляд заявок до Mistblossom Vanguard, статусів кандидатів, персонажів і коротких підказок для офіцерів.",
  path: "/applications",
  keywords: ["заявки до гільдії", "кандидати WoW", "офіцерська панель"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ApplicationsPage(props: {searchParams: Promise<Record<string, string | undefined>>}) {
  return <ApplicationWorkspaceView {...await loadApplicationWorkspace(props)} />;
}
