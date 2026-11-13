import { redirect } from "next/navigation";

/** Public raid browser: no participant account or Discord OAuth is required. */
export default function RootRedirectPage() {
  redirect("/raids");
}
