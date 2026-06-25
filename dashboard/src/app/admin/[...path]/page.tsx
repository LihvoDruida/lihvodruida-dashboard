import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type LegacyAdminPageProps = {
  params: Promise<{ path?: string[] }>;
};

export default async function LegacyAdminPage({ params }: LegacyAdminPageProps) {
  const { path = [] } = await params;
  const suffix = path.map((part) => encodeURIComponent(part)).join("/");
  redirect(suffix ? `/dashboard/${suffix}` : "/dashboard");
}
