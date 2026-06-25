import { redirect } from "next/navigation";
import AppProblemScreen from "@/components/AppProblemScreen";
import DashboardIdentity from "@/components/DashboardIdentity";
import { getSession } from "@/lib/auth";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Немає доступу",
  description: "Поточна група доступу не має дозволу для відкриття цього розділу панелі.",
  path: "/access-denied",
  keywords: ["доступ", "права", "група"],
});

function reasonText(reason?: string) {
  const map: Record<string, string> = {
    groups: "Керування групами доступне тільки адміністраторам із правом groups.manage.",
    discord: "Керування Discord-учасниками доступне тільки групам із відповідним дозволом.",
    logs: "Журнал дій доступний тільки групам із правом перегляду логів.",
    admin: "Цей розділ керування недоступний для поточної групи.",
    applications: "Заявки доступні тільки групам із відповідним дозволом.",
    raids: "Керування рейдами доступне тільки офіцерам або адміністраторам.",
    profiles: "Перегляд профілів обмежений політикою груп доступу.",
  };
  return map[String(reason || "")] || "Поточна Discord-роль або група доступу не має потрібного дозволу для цієї сторінки.";
}

function safeReturnPath(value?: string) {
  const path = String(value || "").trim();
  if (!path || path.length > 220) return "/";
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  if (path.startsWith("/api") || path.startsWith("/_next")) return "/";
  if (path.startsWith("/access-denied")) return "/";
  return path;
}

export default async function AccessDeniedPage({
    searchParams,
}: {
  searchParams: Promise<{ reason?: string; from?: string }>;
}) {
  const [user, params] = await Promise.all([getSession(), searchParams]);
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(safeReturnPath(params.from))}&reauth=1`);
    return null;
  }

  const profileHref = user.profileId ? `/profile/${user.profileId}` : "/profile";

  return (
    <>
      <section className="container access-denied-topbar">
        <div className="dashboard-shell content-shell access-denied-shell">
          <DashboardIdentity user={user} activeSection="profile" />
        </div>
      </section>
      <AppProblemScreen
        kind="access"
        message={reasonText(params.reason)}
        primaryHref={profileHref}
        primaryLabel="До мого профілю"
        secondaryHref="/"
        secondaryLabel="До доступних розділів"
        details={[
          "Права беруться з Discord-ролі та групи доступу в панелі.",
          "Якщо роль щойно змінили — вийди й увійди через Discord ще раз.",
          "Закриті розділи не показуються в меню й не виконують важкі запити.",
        ]}
      />
    </>
  );
}
