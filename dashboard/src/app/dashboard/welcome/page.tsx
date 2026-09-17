import Image from "next/image";
import { redirect } from "next/navigation";

import AdminTabs from "@/components/AdminTabs";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
import { getSession } from "@/lib/auth";
import { fetchDiscordRoleControlSnapshot, fetchDiscordTextChannels } from "@/lib/discordAdmin";
import { getDiscordWelcomeCardSettings, renderDiscordWelcomeMessageTemplate } from "@/lib/discordWelcomeCardSettings";
import { normalizeDiscordWelcomeCardTestInput, resolveDiscordWelcomeCardTestMember } from "@/lib/discordWelcomeCardTesting";
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
  const [settings, textChannels, roleControl] = await Promise.all([
    getDiscordWelcomeCardSettings(),
    fetchDiscordTextChannels().catch(() => ({ guild: null, channels: [], suggestedChannelId: "", suggestedRulesChannelId: "", warning: "Discord channels unavailable" })),
    fetchDiscordRoleControlSnapshot().catch(() => ({ manageableRoles: [], roles: [], error: "Discord roles unavailable" })),
  ]);
  const manageableRoles = roleControl.manageableRoles || [];

  const testInput = normalizeDiscordWelcomeCardTestInput({
    testUserId: paramValue(params, "testUserId"),
    testDisplayName: paramValue(params, "testDisplayName") || "Новий мандрівник",
    testUsername: paramValue(params, "testUsername") || "mistblossom.recruit",
    testGreeting: paramValue(params, "testGreeting") || settings.greetings[0] || "Ishnu-alah!",
    testNumber: paramValue(params, "testNumber") || "4086",
    testNickname: paramValue(params, "testNickname") || "Дмитро [Khayen]",
  });
  const testMessageTemplate = paramValue(params, "testMessageTemplate") || settings.messageTemplate;
  const resolvedTestMember = await resolveDiscordWelcomeCardTestMember(testInput);
  const nicknameDiagnosis = explainNicknameValidation(testInput.nickname);
  const testGreeting = testInput.greeting || settings.greetings[0] || "Ishnu-alah!";
  const testLabel = `${settings.labelPrefix} №${testInput.number}`;
  const generatedText = renderDiscordWelcomeMessageTemplate(testMessageTemplate, {
    mention: testInput.userId ? `<@${testInput.userId}>` : "@тестовий-учасник",
    username: resolvedTestMember.member.username || testInput.username,
    displayName: resolvedTestMember.member.displayName,
    greeting: testGreeting,
    label: testLabel,
  });

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
          ]}
        />
        <AdminTabs active="welcome" user={user} />

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
                <small>«Мурлок» → «Мурлок №4086».</small>
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

              <label className="field-label">Номер
                <input className="input" name="testNumber" defaultValue={testInput.number} maxLength={8} />
                <small>Наприклад 4086 → «{settings.labelPrefix} №4086».</small>
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
              <div className={`panel ${resolvedTestMember.liveMember ? "is-ok" : "is-warning"}`}>
                <strong>{resolvedTestMember.liveMember ? "Discord-профіль знайдено" : "Discord-профіль не підтягнуто"}</strong>
                <p>{resolvedTestMember.liveMember ? `Preview використовує реальний аватар ${resolvedTestMember.member.displayName}.` : (resolvedTestMember.lookupError || "Використано тестові дані.")}</p>
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

          <div className="panel preview-panel">
            <Image
              src={previewUrl}
              alt="Серверний preview welcome-картки"
              width={1600}
              height={900}
              unoptimized
              priority
            />
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
