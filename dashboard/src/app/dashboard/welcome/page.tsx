import Image from "next/image";
import { redirect } from "next/navigation";

import AdminTabs from "@/components/AdminTabs";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
import { getSession } from "@/lib/auth";
import { fetchDiscordRoleControlSnapshotCachedForUi, fetchDiscordTextChannels } from "@/lib/discordAdmin";
import { formatDiscordMemberJoinNumber, resolveDiscordMemberJoinNumber } from "@/lib/discordMemberJoinNumber";
import { buildDiscordWelcomeContent } from "@/lib/discordWelcomeArtifact";
import { getDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { getDiscordGatewayHealth } from "@/lib/discordGatewayHealth";
import { inspectRolelessDiscordMembers } from "@/lib/discordNewcomerRecovery";
import { buildDiscordWelcomeCardTestMember, normalizeDiscordWelcomeCardTestInput } from "@/lib/discordWelcomeCardTesting";
import { explainNicknameValidation } from "@/lib/guildNicknamePolicy";
import { buildPageMetadata } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Welcome-картки",
  description: "Owner-only налаштування публічних welcome-карток, серверний preview, тест ніку та стартова роль нових Discord-учасників.",
  path: "/dashboard/welcome",
  keywords: ["discord welcome", "onboarding", "welcome card", "default role"],
});

type WelcomePageSearchParams = Record<string, string | string[] | undefined>;

function paramValue(params: WelcomePageSearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

export default async function WelcomeCardDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<WelcomePageSearchParams>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!user.isServerOwner) redirect("/access-denied?reason=owner-only&from=/dashboard/welcome");

  const params = (await searchParams) || {};
  const [settings, textChannels, roleControl, gatewayHealth] = await Promise.all([
    getDiscordWelcomeCardSettings(),
    fetchDiscordTextChannels().catch(() => ({ guild: null, channels: [], suggestedChannelId: "", suggestedRulesChannelId: "", warning: "Discord channels unavailable" })),
    fetchDiscordRoleControlSnapshotCachedForUi().catch(() => ({ manageableRoles: [], roles: [], error: "Discord roles unavailable" })),
    getDiscordGatewayHealth(),
  ]);
  const manageableRoles = roleControl.manageableRoles || [];
  const repairPreview = paramValue(params, "repairPreview") === "1"
    ? await inspectRolelessDiscordMembers().catch(() => null)
    : null;

  const testInput = normalizeDiscordWelcomeCardTestInput({
    testUserId: paramValue(params, "testUserId"),
    testDisplayName: paramValue(params, "testDisplayName") || "Новий мандрівник",
    testUsername: paramValue(params, "testUsername") || "mistblossom.recruit",
    testGreeting: paramValue(params, "testGreeting") || settings.greetings[0] || "Ishnu-alah!",
    testNumber: paramValue(params, "testNumber"),
    testNickname: paramValue(params, "testNickname") || "Дмитро [Khayen]",
  });
  const testMessageTemplate = paramValue(params, "testMessageTemplate") || settings.messageTemplate;
  const nicknameDiagnosis = explainNicknameValidation(testInput.nickname);
  const testGreeting = testInput.greeting || settings.greetings[0] || "Ishnu-alah!";
  const testMember = buildDiscordWelcomeCardTestMember(testInput);
  // Empty test number = the real server join-order number (same resolver as
  // production cards; the member timeline is cached, so this is cheap).
  const autoTestNumber = testInput.number
    ? ""
    : await resolveDiscordMemberJoinNumber({ userId: testInput.userId, joinedAt: testMember.joinedAt }).then(formatDiscordMemberJoinNumber).catch(() => "");
  const testNumberShown = testInput.number || autoTestNumber;
  const testLabel = testNumberShown ? `${settings.labelPrefix} №${testNumberShown}` : settings.labelPrefix;
  const generatedText = buildDiscordWelcomeContent({
    member: testMember,
    settings,
    greeting: testGreeting,
    label: testLabel,
    messageTemplateOverride: testMessageTemplate,
    mentionOverride: testInput.userId ? `<@${testInput.userId}>` : "@тестовий-учасник",
  }).content;

  const previewParams = new URLSearchParams({
    testUserId: testInput.userId,
    testDisplayName: testInput.displayName,
    testUsername: testInput.username,
    testGreeting,
    testNumber: testInput.number,
    testNickname: testInput.nickname,
  });
  const previewUrl = `/api/dashboard/welcome-card/preview?${previewParams.toString()}`;

  return (
    <main className="container app-page admin-container server-status-container">
      <section className="dashboard-shell content-shell admin-page server-status-page app-page-stack" aria-label="Welcome-картки та onboarding">
        <DashboardIdentity user={user} activeSection="admin" />
        <AdminPageHeader
          eyebrow="Mistblossom Vanguard • Owner only"
          title="Welcome-картки та onboarding"
          description="Окреме керування публічною карткою привітання, серверним preview, тестуванням текстів і стартовою роллю для нових Discord-учасників."
          metrics={[
            { label: "Канал", value: settings.channelId ? `#${textChannels.channels.find((item) => item.id === settings.channelId)?.name || settings.channelId}` : "не вибрано", tone: settings.channelId ? "good" : "warning" },
            { label: "Стартова роль", value: settings.defaultRoleId ? (manageableRoles.find((item) => item.id === settings.defaultRoleId)?.name || settings.defaultRoleId) : "не задано", tone: settings.defaultRoleId ? "good" : "warning" },
            { label: "Статус", value: settings.enabled ? "Увімкнено" : "Вимкнено", tone: settings.enabled ? "good" : "warning" },
            { label: "Gateway", value: gatewayHealth.ready ? "Live" : "Fallback", note: gatewayHealth.ready ? `черга ${gatewayHealth.queueSize}` : (gatewayHealth.lastError || "cron recovery"), tone: gatewayHealth.ready ? "good" : "warning" },
          ]}
        />
        <AdminTabs active="welcome" user={user} />

        <section className={`panel ${gatewayHealth.ready ? "is-ok" : "is-warning"}`} aria-label="Discord Gateway newcomer worker">
          <div className="discord-management-section-head discord-management-section-head--inline">
            <div>
              <span className="eyebrow">Priority worker</span>
              <h2>{gatewayHealth.ready ? "Discord Gateway активний" : "Discord Gateway не активний — працює cron recovery"}</h2>
              <p>{gatewayHealth.ready
                ? `Нові GUILD_MEMBER_ADD обробляються одразу. Активних worker-ів: ${gatewayHealth.activeWorkers}; у черзі: ${gatewayHealth.queueSize}.`
                : `Миттєвий newcomer worker недоступний. ${gatewayHealth.lastError || "Перевір bot container та Server Members Intent у Discord Developer Portal."}`}</p>
            </div>
            <span className={`status-pill ${gatewayHealth.ready ? "good" : "warning"}`}>{gatewayHealth.ready ? "LIVE" : "FALLBACK"}</span>
          </div>
          {!gatewayHealth.ready ? <small>Для миттєвого GUILD_MEMBER_ADD увімкни Server Members Intent у Discord Developer Portal. Навіть без нього хвилинний cron лишається резервним механізмом.</small> : null}
        </section>

        <section className="panel" aria-label="Welcome-картки Discord">
          <div className="discord-management-section-head discord-management-section-head--inline">
            <div>
              <span className="eyebrow">Owner only • Discord</span>
              <h2>Публічна welcome-картка для нових учасників</h2>
              <p>Картка генерується сервером через Sharp і публікується в обраний канал для кожного нового учасника, якого зафіксує onboarding-автоматизація.</p>
            </div>
            <span className={`status-pill ${settings.enabled ? "good" : "warning"}`}>{settings.enabled ? "Увімкнено" : "Вимкнено"}</span>
          </div>

          <form action="/api/dashboard/welcome-card/settings" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
            <div className="nickname-warning-settings__head">
              <label className="settings-toggle-row settings-toggle-row--card">
                <input name="enabled" type="checkbox" defaultChecked={settings.enabled} />
                <span>
                  <strong>Публікувати welcome-картку в канал</strong>
                  <small>Не в DM. Тригер — новий учасник у Discord-гілдії.</small>
                </span>
              </label>
            </div>

            <div className="nickname-warning-settings__grid nickname-warning-settings__grid--delivery">
              <label className="field-label">Канал для привітання
                <select className="input" name="channelId" defaultValue={settings.channelId}>
                  <option value="">Не вибрано</option>
                  {settings.channelId && !textChannels.channels.some((channel) => channel.id === settings.channelId)
                    ? <option value={settings.channelId}>Поточний канал ({settings.channelId})</option>
                    : null}
                  {textChannels.channels.map((channel) => <option key={channel.id} value={channel.id}># {channel.name}</option>)}
                </select>
                <small>Бот надсилатиме картинку саме сюди.</small>
              </label>

              <label className="field-label">Стартова роль нового учасника
                <select className="input" name="defaultRoleId" defaultValue={settings.defaultRoleId || ""}>
                  <option value="">Не видавати стартову роль</option>
                  {settings.defaultRoleId && !manageableRoles.some((role) => role.id === settings.defaultRoleId)
                    ? <option value={settings.defaultRoleId}>Поточна роль ({settings.defaultRoleId})</option>
                    : null}
                  {manageableRoles.map((role) => <option key={role.id} value={role.id}>@ {role.name}</option>)}
                </select>
                <small>Якщо роль вибрана, бот видає її новому учаснику незалежно від тестових публікацій.</small>
              </label>

              <label className="field-label">Підпис під номером
                <input className="input" name="labelPrefix" defaultValue={settings.labelPrefix} maxLength={24} />
                <small>«Мурлок» → «Мурлок №128», де 128 — порядковий номер учасника на сервері.</small>
              </label>

              <label className="field-label">Назва PNG-файлу
                <input className="input" name="fileName" defaultValue={settings.fileName} maxLength={60} />
                <small>Назва вкладення в Discord.</small>
              </label>
            </div>

            <div className="nickname-warning-settings__group">
              <label className="field-label">Текст повідомлення в каналі
                <textarea className="input" name="messageTemplate" rows={4} defaultValue={settings.messageTemplate} />
                <small>Плейсхолдери: <code>{"{mention}"}</code>, <code>{"{displayName}"}</code>, <code>{"{username}"}</code>, <code>{"{greeting}"}</code>, <code>{"{label}"}</code>.</small>
              </label>
            </div>

            <div className="nickname-warning-settings__group">
              <label className="field-label">Варіанти привітання (по одному в рядку)
                <textarea className="input" name="greetings" rows={8} defaultValue={settings.greetings.join("\n")} />
                <small>Для реального нового учасника система обирає один варіант із цього списку.</small>
              </label>
            </div>

            <div className="form-actions">
              <button className="btn" type="submit">Зберегти welcome-систему</button>
            </div>
          </form>
        </section>

        <section className="panel" aria-label="Відновлення ролей нових учасників">
          <div className="discord-management-section-head discord-management-section-head--inline">
            <div>
              <span className="eyebrow">Recovery • Owner only</span>
              <h2>Відновлення стартової ролі</h2>
              <p>Перевіряє учасників, у яких немає жодної явної Discord-ролі, і може повторно видати роль, вибрану у Welcome-системі. Власник сервера автоматично виключається.</p>
            </div>
            <span className={`status-pill ${repairPreview?.manageable ? "good" : "warning"}`}>{repairPreview ? `${repairPreview.rolelessCount} без ролей` : "Не скановано"}</span>
          </div>

          <div className="form-actions">
            <a className="btn btn-secondary" href="/dashboard/welcome?repairPreview=1">Перевірити учасників без ролей</a>
            <form action="/api/dashboard/welcome-card/repair-roleless" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
              <button className="btn" type="submit" disabled={!repairPreview?.manageable || !repairPreview?.rolelessCount}>Видати стартову роль усім без ролей</button>
            </form>
            <form action="/api/dashboard/welcome-card/run-onboarding" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
              <button className="btn subtle" type="submit">Запустити onboarding зараз</button>
            </form>
          </div>

          {repairPreview ? (
            <div className="nickname-warning-settings__group">
              {repairPreview.warning ? <div className="panel is-warning"><strong>⚠ {repairPreview.warning}</strong></div> : null}
              <div className="panel">
                <strong>Стартова роль: {repairPreview.roleName || repairPreview.roleId || "не задано"}</strong>
                <p>Учасників у Discord: {repairPreview.totalMembers}. Без явних ролей: {repairPreview.rolelessCount}.</p>
                {repairPreview.members.length ? (
                  <div style={{ display: "grid", gap: ".45rem", marginTop: ".75rem" }}>
                    {repairPreview.members.slice(0, 25).map((member) => (
                      <div key={member.userId} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                        <span><strong>{member.displayName}</strong> <code>{member.userId}</code></span>
                        <small>{member.joinedAt ? new Date(member.joinedAt).toLocaleString("uk-UA") : "час вступу невідомий"}</small>
                      </div>
                    ))}
                    {repairPreview.rolelessCount > 25 ? <small>Показано перші 25. Відновлення застосовується до всіх актуальних roleless-учасників.</small> : null}
                  </div>
                ) : <p>Учасників без ролей не знайдено.</p>}
              </div>
            </div>
          ) : null}
        </section>

        <section className="panel" aria-label="Тест welcome-системи">
          <div className="discord-management-section-head discord-management-section-head--inline">
            <div>
              <span className="eyebrow">Server-side test lab</span>
              <h2>Тест даних, ніку та генерації тексту</h2>
              <p>Форма не змінює onboarding-state, ролі чи DM. Вона лише передає тестові значення серверу для перевірки і нової PNG-генерації.</p>
            </div>
            <span className={`status-pill ${nicknameDiagnosis.valid ? "good" : "warning"}`}>{nicknameDiagnosis.valid ? "Нік валідний" : "Нік невалідний"}</span>
          </div>

          <form action="/dashboard/welcome" method="get">
            <div className="nickname-warning-settings__grid nickname-warning-settings__grid--delivery">
              <label className="field-label">Discord User ID (необов’язково)
                <input className="input" name="testUserId" defaultValue={testInput.userId} inputMode="numeric" placeholder="Наприклад 123456789012345678" />
                <small>Якщо ID належить учаснику сервера, сервер підтягне його справжній аватар. Тест не змінює цього користувача.</small>
              </label>

              <label className="field-label">Нік / display name на картці
                <input className="input" name="testDisplayName" defaultValue={testInput.displayName} maxLength={40} />
                <small>Саме цей текст буде великим ніком на PNG.</small>
              </label>

              <label className="field-label">Username для текстових шаблонів
                <input className="input" name="testUsername" defaultValue={testInput.username} maxLength={32} />
              </label>

              <label className="field-label">Номер (необов’язково)
                <input className="input" name="testNumber" defaultValue={testInput.number} maxLength={8} placeholder={autoTestNumber ? `Авто: ${autoTestNumber}` : "Авто"} inputMode="numeric" />
                <small>{testInput.number
                  ? `Ручний номер для тесту → «${settings.labelPrefix} №${testInput.number}».`
                  : autoTestNumber
                    ? `Порожньо — справжній номер учасника на сервері: «${settings.labelPrefix} №${autoTestNumber}». Без User ID — номер наступного учасника.`
                    : "Порожньо — справжній номер учасника на сервері за порядком вступу."}</small>
              </label>
            </div>

            <div className="nickname-warning-settings__grid nickname-warning-settings__grid--delivery">
              <label className="field-label">Привітання на картці
                <input className="input" name="testGreeting" list="welcome-greeting-options" defaultValue={testGreeting} maxLength={80} />
                <datalist id="welcome-greeting-options">
                  {settings.greetings.map((greeting) => <option key={greeting} value={greeting} />)}
                </datalist>
                <small>Можна вибрати з наявних або вписати власний тестовий текст.</small>
              </label>

              <label className="field-label">Тест серверного ніку
                <input className="input" name="testNickname" defaultValue={testInput.nickname} maxLength={96} />
                <small>{nicknameDiagnosis.message}</small>
              </label>
            </div>

            <div className="nickname-warning-settings__group">
              <label className="field-label">Тестовий шаблон Discord-тексту
                <textarea className="input" name="testMessageTemplate" rows={4} defaultValue={testMessageTemplate} />
                <small>Це тимчасовий тестовий шаблон. Він не переписує збережений текст, доки ти не зміниш основні налаштування вище.</small>
              </label>
            </div>

            <div className="form-actions">
              <button className="btn" type="submit">Згенерувати тест на сервері</button>
              <a className="btn subtle" href="/dashboard/welcome">Скинути тестові дані</a>
            </div>
          </form>

          <div className="nickname-warning-settings__group">
            <div className={`panel ${nicknameDiagnosis.valid ? "is-ok" : "is-warning"}`}>
              <strong>{nicknameDiagnosis.valid ? "✓ Серверний нік проходить перевірку" : "⚠ Серверний нік не проходить перевірку"}</strong>
              <p>{nicknameDiagnosis.message}</p>
            </div>
            {testInput.userId ? (
              <div className="panel is-ok">
                <strong>Реальний Discord-профіль перевіряється тільки renderer-ом</strong>
                <p>Сторінка не робить зайвий Discord API-запит. Preview і тестова публікація самі підтягнуть аватар цього ID на сервері; при помилці використають тестові дані.</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel" aria-label="Server preview welcome-картки">
          <div className="discord-management-section-head discord-management-section-head--inline">
            <div>
              <span className="eyebrow">PNG renderer • server</span>
              <h2>Preview, згенерований на сервері</h2>
              <p>Зображення нижче повертає окремий owner-only API route. Браузер лише показує готовий PNG; композиція, аватар, тексти та фон збираються серверним Sharp.</p>
            </div>
            <a className="btn btn-secondary" href={previewUrl} target="_blank" rel="noreferrer">Відкрити PNG</a>
          </div>

          <div className="panel preview-panel" style={{ padding: "1rem", display: "grid", justifyItems: "start" }}>
            <div
              aria-label="Discord-sized preview frame"
              style={{
                width: "100%",
                maxWidth: "640px",
                padding: "12px",
                borderRadius: "16px",
                background: "rgba(32, 34, 37, 0.88)",
                border: "1px solid rgba(255,255,255,0.06)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
              }}
            >
              <Image
                src={previewUrl}
                alt="Серверний preview welcome-картки"
                width={1600}
                height={900}
                unoptimized
                priority
                style={{
                  display: "block",
                  width: "100%",
                  height: "auto",
                  maxWidth: "616px",
                  borderRadius: "16px",
                }}
              />
            </div>
            <p className="text-muted" style={{ margin: 0 }}>Preview у панелі обмежений до приблизного desktop-розміру вкладення в Discord, щоб візуально збігатися з публікацією в каналі.</p>
          </div>

          <div className="nickname-warning-settings__group">
            <label className="field-label">Згенерований Discord-текст
              <textarea className="input" rows={5} value={generatedText} readOnly />
              <small>Цей текст сформовано на сервері з тестового шаблону та поточних даних.</small>
            </label>
          </div>
        </section>

        <section className="panel" aria-label="Тестова публікація Discord">
          <div className="discord-management-section-head discord-management-section-head--inline">
            <div>
              <span className="eyebrow">Discord test publish</span>
              <h2>Опублікувати тестову картку в Discord</h2>
              <p>Відправляє поточний тестовий PNG і згенерований текст у вибраний канал. Це не вважається вступом нового учасника, не видає стартову роль і не надсилає DM.</p>
            </div>
          </div>

          <form action="/api/dashboard/welcome-card/publish-test" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
            <input type="hidden" name="testUserId" value={testInput.userId} />
            <input type="hidden" name="testDisplayName" value={testInput.displayName} />
            <input type="hidden" name="testUsername" value={testInput.username} />
            <input type="hidden" name="testGreeting" value={testGreeting} />
            <input type="hidden" name="testNumber" value={testInput.number} />
            <input type="hidden" name="testNickname" value={testInput.nickname} />
            <input type="hidden" name="testMessageTemplate" value={testMessageTemplate} />

            <div className="nickname-warning-settings__grid nickname-warning-settings__grid--delivery">
              <label className="field-label">Канал для тесту
                <select className="input" name="channelId" defaultValue={settings.channelId}>
                  <option value="">Не вибрано</option>
                  {settings.channelId && !textChannels.channels.some((channel) => channel.id === settings.channelId)
                    ? <option value={settings.channelId}>Поточний канал ({settings.channelId})</option>
                    : null}
                  {textChannels.channels.map((channel) => <option key={channel.id} value={channel.id}># {channel.name}</option>)}
                </select>
                <small>Можна вибрати інший канал лише для цього тесту.</small>
              </label>
            </div>

            <div className="form-actions">
              <button className="btn" type="submit">Опублікувати тест у Discord</button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
