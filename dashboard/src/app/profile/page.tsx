import { getSession } from "@/lib/auth";
import { getOwnProfilePath } from "@/lib/profiles";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Мій профіль",
  description: "Швидке перенаправлення на особистий профіль учасника Mistblossom Vanguard.",
  path: "/profile",
  keywords: ["мій профіль", "персонажі гільдії"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfileRedirectPage() {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  redirect(await getOwnProfilePath(user));
}
