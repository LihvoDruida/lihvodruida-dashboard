import { buildPageMetadata } from "@/lib/seo";
import StaticAcceptClient from "@/components/static/StaticAcceptClient";
export const metadata = buildPageMetadata({ title: "Правила Статика", description: "Прийняття правил рейдового Статика Mistblossom Vanguard через Discord-бота.", path: "/static/accept" });
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function StaticAcceptPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const params = await searchParams;
  return <StaticAcceptClient token={String(params.t || "").slice(0, 120)} botId={String(process.env.DISCORD_APPLICATION_ID || "")} />;
}
