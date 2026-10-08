import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listStaticDiscipline, staticPermission } from "@/lib/staticRules";
import { noStoreHeaders } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const session = await getSession({ live: true });
    const access = await staticPermission(session);
    if (!access.view) return NextResponse.json({ ok: false, error: "Немає доступу." }, { status: 403, headers: noStoreHeaders() });
    return NextResponse.json({ ok: true, permissions: access, members: await listStaticDiscipline() }, { headers: noStoreHeaders() });
  } catch { return NextResponse.json({ ok: false, error: "Банліст тимчасово недоступний." }, { status: 503, headers: noStoreHeaders() }); }
}
