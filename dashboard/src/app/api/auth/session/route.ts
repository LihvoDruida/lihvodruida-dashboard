import { NextResponse } from "next/server";
import { getStoredSession } from "@/lib/auth";
import { noStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await getStoredSession().catch(() => null);
  if (!session) {
    return NextResponse.json(
      {
        authenticated: false,
        toast: {
          tone: "warning",
          title: "Потрібен вхід",
          message: "Сесія завершилась або була очищена.",
        },
      },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: session.id,
        role: session.role,
        profileId: session.profileId || null,
        permissions: session.permissions || [],
        groupId: session.groupId || null,
      },
    },
    { headers: noStoreHeaders() },
  );
}
