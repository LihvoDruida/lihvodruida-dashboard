import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Окремої головної сторінки більше немає.
 * Авторизований користувач одразу потрапляє у власний профіль,
 * неавторизований — на вхід.
 */
export default async function RootRedirectPage() {
  const user = await getSession().catch(() => null);
  redirect(user ? "/profile" : "/login");
}
