import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type LegacyAdminApiContext = {
  params: Promise<{ path?: string[] }>;
};

async function redirectLegacyAdminApi(request: NextRequest, context: LegacyAdminApiContext) {
  const { path = [] } = await context.params;
  const target = new URL(request.url);
  target.pathname = `/api/dashboard/${path.map((part) => encodeURIComponent(part)).join("/")}`;
  return NextResponse.redirect(target, 307);
}

export const GET = redirectLegacyAdminApi;
export const POST = redirectLegacyAdminApi;
export const PUT = redirectLegacyAdminApi;
export const PATCH = redirectLegacyAdminApi;
export const DELETE = redirectLegacyAdminApi;
