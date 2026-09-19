import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import { getSession } from "@/lib/auth";
import { canManageDiscordMembers, canManageGeneralEmbeds, canManageRaids, canManageRulesEmbeds, canViewRulesStats, hierarchyTitle } from "@/lib/permissions";
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
    <main className="container app-page">
      <section className="dashboard-shell content-shell discord-shell app-page-stack" aria-label="Панель Discord-дій Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="discord" />
        <header className="hero panel dashboard-hero content-dashboard-hero discord-dashboard-hero">
          <div className="hero-copy dashboard-hero__copy content-dashboard-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Discord</div>
            <div className="content-hero-status-row" aria-label="Стан Discord редактора">
              <span className="content-mode-pill content-mode-pill--library">{hierarchyTitle(user.role)}</span>
              <span className="content-hero-path">{canCreateRaidPolls ? "Рейд-голосування • Discord повідомлення" : canViewRules ? "Статистика правил • Звичайні повідомлення" : "Звичайні повідомлення"}</span>
            </div>
            <h1>Discord-повідомлення</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">Публікація Discord-повідомлень, правила, статистика й доступи за ролями в одному місці.</p>
            <div className="hero-secure-note content-hero-actions">
              <span className="hero-lock" aria-hidden="true">✦</span>
              <span>Панель показує тільки ті дії, які дозволені твоєю роллю.</span>
            </div>
          </div>

          <HeroSidePanel
            ariaLabel="Огляд Discord-повідомлень"
            summary={[
              { label: "ДОСТУП", value: hierarchyTitle(user.role), note: "Дії залежать від ролі" },
              { label: "РОЗДІЛ", value: canCreateRaidPolls ? "Пули + повідомлення" : canViewRules ? "Правила + повідомлення" : "Повідомлення", note: discordEnabled ? "Discord API налаштовано" : "Discord API недоступний" },
            ]}
            stats={[
              { label: "EMBEDS", value: canUseGeneralEmbeds ? "ON" : "—" },
              { label: "RULES", value: canEditRules ? "EDIT" : canViewRules ? "VIEW" : "—" },
              { label: "CONFIG", value: discordEnabled ? "OK" : "ERR" },
            ]}
          />
        </header>
      <StatusNotice params={params} />
      {!canUseGeneralEmbeds && !canCreateRaidPolls && !canManageAutoroles ? (
        <div className="notice panel">Твоя роль не має доступу до Discord-дій.</div>
      ) : !discordEnabled ? (
        <div className="notice panel error-note">Публікація в Discord тимчасово недоступна.</div>
      ) : (
        <section className={`discord-hub-grid discord-hub-grid--compact ${canViewRules || canCreateRaidPolls ? "" : "discord-hub-grid--single"}`} aria-label="Розділи Discord-повідомлень">
          {canViewRules ? (
            <a className="panel discord-hub-card discord-hub-card--rules" href="/discord/rules">
              <span className="eyebrow">Статистика правил • {hierarchyTitle(user.role)}</span>
              <strong>{canEditRules ? "Правила сервера" : "Статистика правил"}</strong>
              <p>{canEditRules ? "Правила, статистика і ролі кнопки прийняття." : "Статистика звичайних правил і список підписантів правил рейду."}</p>
              <span className="btn primary">{canEditRules ? "Відкрити правила" : "Відкрити статистику"}</span>
            </a>
          ) : null}

          <a className="panel discord-hub-card discord-hub-card--raid" href="/raids">
            <span className="eyebrow">Рейди • {hierarchyTitle(user.role)}</span>
            <strong>Рейдові оголошення</strong>
            <p>Створення рейдів, кнопки запису й автоматична побудова паті.</p>
            <span className="btn primary">Відкрити рейди</span>
          </a>

          {canCreateRaidPolls ? (
            <a className="panel discord-hub-card discord-hub-card--poll" href="/polls">
              <span className="eyebrow">Рейд-голосування • {hierarchyTitle(user.role)}</span>
              <strong>Raid Polls</strong>
              <p>Створення голосування за дні та час рейду з публікацією в Discord і результатами на сайті.</p>
              <span className="btn subtle">Відкрити пули</span>
            </a>
          ) : null}


          {canManageAutoroles ? (
            <a className="panel discord-hub-card discord-hub-card--autoroles" href="/discord/autoroles">
              <span className="eyebrow">Авторолі • {hierarchyTitle(user.role)}</span>
              <strong>Кнопки видачі ролей</strong>
              <p>Створення embed-повідомлень із кнопками, які видають, знімають або перемикають Discord-ролі.</p>
              <span className="btn primary">Відкрити авторолі</span>
            </a>
          ) : null}

          <a className="panel discord-hub-card" href="/discord/embed">
            <span className="eyebrow">Звичайні повідомлення • {hierarchyTitle(user.role)}</span>
            <strong>Звичайні повідомлення</strong>
            <p>Повідомлення, редагування за посиланням і теги ролей.</p>
            <span className="btn subtle">Відкрити редактор</span>
          </a>
        </section>
      )}

      </section>
    </main>
  );
}
