import { NextResponse } from "next/server";
import { getDashboardUrl } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.redirect(`${getDashboardUrl()}/login?error=discord_only`);
}
