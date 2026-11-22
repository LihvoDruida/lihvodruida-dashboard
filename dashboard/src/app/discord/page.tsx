import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageHeader from "@/components/page/PageHeader";
import { getSession } from "@/lib/auth";
import { canManageDiscordMembers, canManageGeneralEmbeds, canManageRaids, canManageRulesEmbeds, canViewRulesStats } from "@/lib/permissions";
import { hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { getOwnProfilePath } from "@/lib/profiles";
import { buildPageMetadata } from "@/lib/seo";
import { safeDiscordMessageUrl } from "@/lib/discordGuildLinks";

export const metadata = buildPageMetadata({
  title: "Discord-повідомлення",
  description: "Керування повідомленнями, правилами та ролями Discord для Mistblossom Vanguard з акуратним попереднім переглядом.",
  path: "/discord",
  keywords: ["Discord повідомлення", "правила Discord", "ролі Discord"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

function StatusNotice({ params }: { params: Record<string, string | undefined> }) {
  const published = safeDiscordMessageUrl(params.published);
  const updated = safeDiscordMessageUrl(params.updated);
  if (published) {
    return (
      <div className="notice panel success discord-notice">
        Опубліковано Discord-повідомлення: <a href={published} target="_blank" rel="noreferrer">відкрити</a>
      </div>
    );
  }

  if (updated) {
    return (
      <div className="notice panel success discord-notice">
        Оновлено Discord-повідомлення: <a href={updated} target="_blank" rel="noreferrer">відкрити</a>
      </div>
    );
  }

  if (params.error) return <div className="notice panel error-note discord-notice">{params.error}</div>;
  return null;
}

export default async function DiscordHubPage({
  searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }

  const params = await searchParams;
  const canUseGeneralEmbeds = canManageGeneralEmbeds(user);
  const canEditRules = canManageRulesEmbeds(user);
  const canViewRules = canViewRulesStats(user);
  const canCreateRaidPolls = canManageRaids(user);
  const canManageAutoroles = canManageDiscordMembers(user);
  if (!canUseGeneralEmbeds && !canViewRules && !canCreateRaidPolls && !canManageAutoroles) redirect(await getOwnProfilePath(user));

  const discordEnabled = hasDiscordEmbedConfig();

  return (
    <main className="container app-page discord-hub-page">
      <section className="dashboard-shell content-shell discord-shell discord-hub-shell app-page-stack" aria-label="Панель Discord-дій Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="discord" />
        <PageHeader eyebrow="Mistblossom Vanguard • Discord" title="Discord-повідомлення" description="Публікація Discord-повідомлень, правила, авторолі й Статик. Показано лише дії, дозволені твоїй ролі." />
      <StatusNotice params={params} />
      {!canUseGeneralEmbeds && !canCreateRaidPolls && !canManageAutoroles ? (
        <div className="notice panel">Твоя роль не має доступу до Discord-дій.</div>
      ) : !discordEnabled ? (
        <div className="notice panel error-note">Публікація в Discord тимчасово недоступна.</div>
      ) : (
        <section className="discord-hub-sections" aria-label="Розділи Discord-повідомлень">
          <div className="discord-hub-section-group discord-hub-section-group--primary" aria-label="Основні Discord-дії">
            {canViewRules ? (
              <a className="panel discord-hub-card discord-hub-card--featured discord-hub-card--rules" href="/discord/rules">
                <span className="eyebrow">Статистика правил</span>
                <strong>{canEditRules ? "Правила сервера" : "Статистика правил"}</strong>
                <p>{canEditRules ? "Правила, статистика і ролі кнопки прийняття." : "Статистика звичайних правил і список підписантів правил рейду."}</p>
                <span className="btn primary">{canEditRules ? "Відкрити правила" : "Відкрити статистику"}</span>
              </a>
            ) : null}

            <a className="panel discord-hub-card discord-hub-card--featured discord-hub-card--raid" href="/raids">
              <span className="eyebrow">Рейди</span>
              <strong>Рейдові оголошення</strong>
              <p>Створення рейдів, кнопки запису й автоматична побудова паті.</p>
              <span className="btn primary">Відкрити рейди</span>
            </a>
          </div>

          <a className="panel discord-hub-card discord-hub-card--featured discord-hub-card--rules" href="/discord/static">
            <span className="eyebrow">Рейдовий склад • правила Статика</span>
            <strong>Статик</strong>
            <p>Окремі правила, 24-годинні запрошення, підписанти та керування роллю за правами РЛ.</p>
            <span className="btn primary">Відкрити Статик</span>
          </a>

          <div className="discord-hub-section-group discord-hub-section-group--tools" aria-label="Інструменти Discord">
            {canManageAutoroles ? (
              <a className="panel discord-hub-card discord-hub-card--tool discord-hub-card--autoroles" href="/discord/autoroles">
                <span className="eyebrow">Авторолі</span>
                <strong>Кнопки видачі ролей</strong>
                <p>Створення embed-повідомлень із кнопками, які видають, знімають або перемикають Discord-ролі.</p>
                <span className="btn primary">Відкрити авторолі</span>
              </a>
            ) : null}

            <a className="panel discord-hub-card discord-hub-card--tool discord-hub-card--embed" href="/discord/embed">
              <span className="eyebrow">Звичайні повідомлення</span>
              <strong>Звичайні повідомлення</strong>
              <p>Повідомлення, редагування за посиланням і теги ролей.</p>
              <span className="btn subtle">Відкрити редактор</span>
            </a>
          </div>
        </section>
      )}

      </section>
    </main>
  );
}
