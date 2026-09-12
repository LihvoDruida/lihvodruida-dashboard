import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getServerStatusSnapshot } from "@/lib/serverStatus";
import { noStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", loginUrl: "/login" },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  if (!session.isServerOwner) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403, headers: noStoreHeaders() },
    );
  }

  try {
    const snapshot = await getServerStatusSnapshot();
    return NextResponse.json(
      { ok: true, snapshot },
      { status: 200, headers: noStoreHeaders() },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "metrics_unavailable",
        message: error instanceof Error ? error.message : "Не вдалося прочитати системні метрики.",
      },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
