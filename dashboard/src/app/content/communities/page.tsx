import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import Notice from "@/components/page/Notice";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import CommunitiesEditor from "@/components/content/CommunitiesEditor";
import { getSession } from "@/lib/auth";
import { canManageSiteContent } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { getSiteCommunities } from "@/lib/siteCommunities";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({ title: "Спільноти на сайті", description: "Картки спільнот на головній сторінці сайту.", path: "/content/communities" });
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CommunitiesPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!canManageSiteContent(user)) redirect(await getOwnProfilePath(user));
  const state = await getSiteCommunities().catch(() => null);
  const siteUrl = (process.env.PUBLIC_SITE_URL || "https://lihvodruida.pp.ua").replace(/\/+$/, "");
  return <PageContainer label="Спільноти на сайті" navigation={<DashboardIdentity user={user} activeSection="content" />}>
    <PageHeader eyebrow="Лігво Друїда / Сайт" title="Спільноти на сайті"
      breadcrumbs={[{ label: "Контент", href: "/content" }, { label: "Спільноти" }]}
      description="Блок «01 / Спільноти» на головній: назви, опис, позначки, посилання й логотипи."
      actions={<Link className="btn subtle" href="/content" prefetch={false}>До матеріалів</Link>} />
    {state ? <PageErrorBoundary><CommunitiesEditor initialItems={state.items} initialRevision={state.revision} customized={state.customized} siteUrl={siteUrl} /></PageErrorBoundary>
      : <Notice title="Сховище недоступне" tone="warning">Не вдалося завантажити спільноти. Онови сторінку пізніше; сайт тим часом показує останні збережені дані.</Notice>}
  </PageContainer>;
}
