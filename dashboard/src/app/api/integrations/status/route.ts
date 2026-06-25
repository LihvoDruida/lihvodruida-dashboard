import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isDashboardStaff } from "@/lib/permissions";
import { getIntegrationStatusSummary } from "@/lib/integrationStatus";
import { noStoreHeaders, unauthorizedResponse } from "@/lib/security";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await getSession();
  if (!isDashboardStaff(session)) return unauthorizedResponse();

  try {
    const summary = await getIntegrationStatusSummary();
    return NextResponse.json(summary, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося перевірити інтеграції.";
    return NextResponse.json({ error: message }, { status: 500, headers: noStoreHeaders() });
  }
}
