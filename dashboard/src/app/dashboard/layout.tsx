import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessManagement } from "@/lib/navigation/management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ManagementLayout({ children }: { children: ReactNode }) {
  const session = await getSession({ live: true });
  if (!session) redirect("/login?next=%2Fdashboard");
  if (!canAccessManagement(session)) redirect("/access-denied?reason=admin&from=/dashboard");
  return children;
}
