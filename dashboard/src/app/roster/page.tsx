import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import { getSession } from "@/lib/auth";
import { resolveAuthorIdentity } from "@/lib/authorIdentity";
import { canManageRaids } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { fetchDiscordRoles, fetchDiscordTextChannels, hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { buildPageMetadata } from "@/lib/seo";
import { WOW_CLASS_CATALOG, wowClassCount, wowSpecFullName } from "@/lib/wowClassCatalog";
import {
  ROSTER_SEASONS,
  ROSTER_TARGET_SIZE,
  buildRosterComposition,
  hasRosterStorage,
  listRosterFormations,
  rosterClassCoverage,
  rosterCoveredClassCount,
  rosterDetailedRoleEmoji,
  rosterPickDetailedRole,
  rosterRoleBreakdown,
  rosterSeasonLabel,
  type RosterFormation,
} from "@/lib/rosterFormation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Формування складу",
  description:
    "Оголошення для збору рейдового складу Mistblossom Vanguard: гравці обирають клас і спеку прямо в Discord, дані фіксуються автоматично.",
  path: "/roster",
  keywords: ["формування складу", "рейдовий склад", "вибір класу", "World of Warcraft"],
});

type ChannelOption = { id: string; name: string; type: number };
type RoleOption = { id: string; name: string; color: number; position: number };

function roleHex(color: number) {
  if (!color) return "#94a3b8";
  return `#${color.toString(16).padStart(6, "0")}`;
}

/* -------------------------------------------------------------------------- */

function CoverageTable({ roster }: { roster: RosterFormation | null }) {
  // Коли ще немає жодного формування — показуємо еталонну таблицю всіх класів
  // як порожню (усі вільні), щоб офіцер бачив ціль ще до публікації.
  const rows = roster
    ? rosterClassCoverage(roster)
    : WOW_CLASS_CATALOG.map((cls) => ({
        classKey: cls.key,
        className: cls.label,
        emoji: cls.emoji,
        color: cls.color,
        count: 0,
        members: [],
      }));

  const covered = rows.filter((row) => row.count > 0).length;

  return (
    <div className="content-form-section roster-coverage">
      <div className="content-form-section-head">
        <strong>🎯 Таблиця ролей — покриття класів</strong>
        <small>
          Присутньо {covered}/{wowClassCount()} класів. Ціль — щонайменше 1 представник кожного класу.
        </small>
      </div>

      <div className="roster-coverage-grid" role="list">
        {rows.map((row) => {
          const free = row.count === 0;
          return (
            <div
              key={row.classKey}
              role="listitem"
              className={`roster-coverage-cell${free ? " is-free" : " is-covered"}`}
              style={{ borderLeftColor: row.color }}
            >
              <div className="roster-coverage-cell__head">
                <span className="roster-coverage-cell__name">
                  <span aria-hidden="true">{row.emoji}</span> {row.className}
                </span>
                <span className={`roster-coverage-cell__badge${free ? " is-free" : ""}`}>
                  {free ? "⬜ вільно" : `✅ ${row.count}`}
                </span>
              </div>
              {row.members.length ? (
                <ul className="roster-coverage-cell__members">
                  {row.members.map((member) => (
                    <li key={member.discordUserId}>
                      {rosterDetailedRoleEmoji(rosterPickDetailedRole(member))} {member.discordName} ·{" "}
                      {wowSpecFullName(member.classKey, member.specKey)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PartyGrid({ roster }: { roster: RosterFormation }) {
  const composition = buildRosterComposition(roster);
  if (!roster.picks.length) return null;

  return (
    <div className="content-form-section roster-parties">
      <div className="content-form-section-head">
        <strong>🧩 Паті</strong>
        <small>
          По {5} у кожній, хіл у кожній паті. Ціль: {composition.target.tanks} танки / {composition.target.healers} хіли /{" "}
          {composition.target.dps} ДД.
        </small>
      </div>
      <div className="roster-party-grid">
        {composition.parties.map((party) => (
          <div key={party.index} className="roster-party">
            <div className="roster-party__head">
              Паті {party.index} · {party.members.length}/5
            </div>
            <ul className="roster-party__slots">
              <li>🛡️ {party.tank ? party.tank.discordName : <span className="roster-slot-empty">вільно</span>}</li>
              <li>💚 {party.healer ? party.healer.discordName : <span className="roster-slot-empty">вільно</span>}</li>
              {party.dps.map((member) => (
                <li key={member.discordUserId}>
                  {rosterDetailedRoleEmoji(rosterPickDetailedRole(member))} {member.discordName}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {composition.bench.length ? (
        <p className="roster-bench-note">
          На лаві ({composition.bench.length}): {composition.bench.map((m) => m.discordName).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function FormationCard({ roster }: { roster: RosterFormation }) {
  const covered = rosterCoveredClassCount(roster);
  const breakdown = rosterRoleBreakdown(roster);
  const composition = buildRosterComposition(roster);
  const closed = roster.status === "closed";

  return (
    <article className={`panel roster-formation-card${closed ? " is-closed" : ""}`}>
      <header className="roster-formation-card__head">
        <div>
          <h3>{roster.title}</h3>
          <p className="roster-formation-card__meta">
            {closed ? "🔒 Набір закрито" : "🟢 Набір відкрито"} · {roster.picks.length}/{ROSTER_TARGET_SIZE} гравців ·
            присутньо {covered}/{wowClassCount()} класів
          </p>
          <p className="roster-formation-card__roles">
            🛡️ Танки: {breakdown.tank}/{composition.target.tanks} · 💚 Хіли: {breakdown.healer}/
            {composition.target.healers} · ⚔️ ДД: {breakdown.melee} · 🏹 РДД: {breakdown.ranged}
          </p>
        </div>
        {roster.messageUrl ? (
          <a className="btn ghost" href={roster.messageUrl} target="_blank" rel="noreferrer">
            Відкрити в Discord
          </a>
        ) : null}
      </header>

      <PartyGrid roster={roster} />

      <CoverageTable roster={roster} />

      <div className="roster-formation-card__actions">
        {closed ? (
          <form
            method="post"
            action="/api/roster"
            className="roster-inline-form"
            data-confirm-message="Відкрити набір знову? Кнопки в Discord знову стануть активними."
          >
            <input type="hidden" name="action" value="reopen" />
            <input type="hidden" name="rosterId" value={roster.id} />
            <button type="submit" className="btn primary">
              Відкрити набір
            </button>
          </form>
        ) : (
          <form
            method="post"
            action="/api/roster"
            className="roster-inline-form"
            data-confirm-message="Закрити набір? Кнопки в Discord стануть неактивними, склад залишиться збереженим."
          >
            <input type="hidden" name="action" value="close" />
            <input type="hidden" name="rosterId" value={roster.id} />
            <button type="submit" className="btn subtle">
              Закрити набір
            </button>
          </form>
        )}

        <form
          method="post"
          action="/api/roster"
          className="roster-inline-form"
          data-confirm-message="Очистити склад? Усі вибори гравців буде прибрано, повідомлення оновиться."
        >
          <input type="hidden" name="action" value="clear" />
          <input type="hidden" name="rosterId" value={roster.id} />
          <button type="submit" className="btn warning">
            Очистити склад
          </button>
        </form>

        <form
          method="post"
          action="/api/roster"
          className="roster-inline-form"
          data-confirm-message="Видалити це формування складу разом із повідомленням у Discord?"
        >
          <input type="hidden" name="action" value="delete" />
          <input type="hidden" name="rosterId" value={roster.id} />
          <button type="submit" className="btn danger">
            Видалити оголошення
          </button>
        </form>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */

export default async function RosterFormationPage() {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canManageRaids(user)) redirect(await getOwnProfilePath(user));

  const discordEnabled = hasDiscordEmbedConfig();
  const storageReady = hasRosterStorage();

  let channels: ChannelOption[] = [];
  let roles: RoleOption[] = [];
  let suggestedChannelId = "";
  let configWarning = "";

  const authorIdentity = await resolveAuthorIdentity(user).catch(() => null);
  const authorName = authorIdentity?.primaryName || user.name || user.login || "Офіцер";

  if (discordEnabled) {
    try {
      const [channelData, roleData] = await Promise.all([
        fetchDiscordTextChannels(),
        fetchDiscordRoles().catch(() => []),
      ]);
      channels = channelData.channels.map((c) => ({ id: c.id, name: c.name, type: c.type }));
      roles = roleData.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position }));
      suggestedChannelId = channelData.suggestedChannelId || channels[0]?.id || "";
      if (channelData.warning) configWarning = channelData.warning;
    } catch (error) {
      configWarning = error instanceof Error ? error.message : "Не вдалося отримати список Discord-каналів.";
    }
  }

  const formations = storageReady ? await listRosterFormations().catch(() => []) : [];
  const latestOpen = formations.find((f) => f.status === "open") || formations[0] || null;
  const canPublish = discordEnabled && storageReady && channels.length > 0;

  return (
    <main className="container app-page roster-page">
      <section className="dashboard-shell content-shell app-page-stack" aria-label="Формування складу Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="roster" />

        <header className="hero panel dashboard-hero app-page-hero">
          <div className="hero-copy dashboard-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Формування складу</div>
            <h1>Збір рейдового складу на сезон</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">
              Публікуй оголошення в Discord — гравці обирають клас і спеку прямо під повідомленням, а система фіксує
              їхній серверний нік. Ціль: {ROSTER_TARGET_SIZE} гравців із мінімум одним представником кожного з{" "}
              {wowClassCount()} класів.
            </p>
          </div>
        </header>

        {!discordEnabled ? (
          <div className="notice panel error-note">Discord не підключено до панелі — публікація складу недоступна.</div>
        ) : null}
        {discordEnabled && !storageReady ? (
          <div className="notice panel error-note">
            Firebase не налаштований, тому вибори гравців нікуди не збережуться. Звернись до гільдмайстра.
          </div>
        ) : null}
        {configWarning ? <div className="notice panel warning-note">{configWarning}</div> : null}

        {/* ---- Форма створення ---- */}
        <form method="post" action="/api/roster" className="panel roster-create-form">
          <input type="hidden" name="action" value="publish" />

          <div className="content-form-section">
            <div className="content-form-section-head">
              <strong>Нове оголошення складу</strong>
              <small>Заголовок фіксований — «Формування складу». Обери сезон, канал і кого тегати.</small>
            </div>

            <div className="roster-create-grid">
              <label className="content-field">
                <span>Сезон</span>
                <select className="select modern-select" name="season" defaultValue={String(ROSTER_SEASONS[0])} required>
                  {ROSTER_SEASONS.map((season) => (
                    <option key={season} value={season}>
                      Формування складу — {rosterSeasonLabel(season)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="content-field">
                <span>Канал публікації</span>
                <select
                  className="select modern-select"
                  name="channelId"
                  defaultValue={suggestedChannelId}
                  required
                  disabled={!canPublish}
                >
                  {channels.length ? (
                    channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        # {channel.name}
                        {channel.type === 5 ? " • оголошення" : ""}
                      </option>
                    ))
                  ) : (
                    <option value="">Канали недоступні</option>
                  )}
                </select>
              </label>

              <label className="content-field">
                <span>Автор (з Discord)</span>
                <input className="input" value={authorName} readOnly aria-readonly="true" tabIndex={-1} />
                <small>Підтягується автоматично з твого Discord-профілю.</small>
              </label>
            </div>

            <label className="content-field content-field--wide">
              <span>Короткий опис ембеду</span>
              <textarea
                className="input textarea compact"
                name="description"
                maxLength={1500}
                rows={3}
                placeholder="Напр.: Збираємо основу на ендгейм-рейд сезону. Бери незайнятий клас — і роль відповідно."
              />
            </label>
          </div>

          {roles.length ? (
            <div className="content-form-section">
              <div className="content-form-section-head">
                <strong>Кого тегати</strong>
                <small>Ці ролі отримають пінг при публікації (необовʼязково).</small>
              </div>
              <div className="roster-role-picker" role="group" aria-label="Ролі для згадки">
                {roles.slice(0, 40).map((role) => (
                  <label key={role.id} className="inline-check roster-role-check">
                    <input type="checkbox" name="mentionRoleIds" value={role.id} />
                    <span style={{ color: roleHex(role.color) }}>@ {role.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="roster-create-form__submit">
            <button type="submit" className="btn primary" disabled={!canPublish}>
              Опублікувати оголошення
            </button>
            {!canPublish ? (
              <small className="roster-create-form__hint">
                Публікація недоступна, поки Discord-канали або сховище не підключені.
              </small>
            ) : null}
          </div>
        </form>

        {/* ---- Таблиця вільних ролей (еталон / поточне) ---- */}
        <div className="panel roster-reference">
          <CoverageTable roster={latestOpen} />
        </div>

        {/* ---- Наявні формування ---- */}
        {formations.length ? (
          <section className="roster-formations-list" aria-label="Опубліковані формування складу">
            <h2 className="roster-section-title">Опубліковані оголошення</h2>
            {formations.map((roster) => (
              <FormationCard key={roster.id} roster={roster} />
            ))}
          </section>
        ) : (
          <div className="notice panel">
            Ще немає жодного опублікованого складу. Створи оголошення вище — воно зʼявиться тут разом із живою таблицею
            ролей.
          </div>
        )}
      </section>
    </main>
  );
}
