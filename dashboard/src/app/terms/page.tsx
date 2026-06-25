import HeroSidePanel from "@/components/HeroSidePanel";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Умови використання",
  description: "Умови використання гільдійної панелі Mistblossom Vanguard для профілів, рейдів, Discord-ролей і правил.",
  path: "/terms",
  keywords: ["умови використання", "правила панелі", "Mistblossom Vanguard"],
});

const updatedAt = "09 травня 2026";

export default function TermsPage() {
  return (
    <main className="container legal-page">
      <section className="dashboard-shell content-shell legal-shell" aria-label="Умови використання Mistblossom Vanguard">
        <header className="hero panel dashboard-hero legal-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Документи</div>
            <h1>Умови використання</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">Ці умови описують, як учасники гільдії користуються панеллю для профілю, правил, рейдів, заявок і Discord-ролей.</p>
            <small>Оновлено: {updatedAt}</small>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд документа"
            summary={[
              { label: "ДОКУМЕНТ", value: "Правила панелі", note: "Профілі, рейди, заявки" },
              { label: "ОНОВЛЕНО", value: updatedAt, note: "Актуальна редакція" },
            ]}
            stats={[
              { label: "ПРОФІЛЬ", value: "YES" },
              { label: "РЕЙДИ", value: "YES" },
              { label: "ПРАВИЛА", value: "YES" },
            ]}
          />
        </header>

        <article className="panel legal-card">
          <h2>1. Призначення панелі</h2>
          <p>Панель Mistblossom Vanguard створена для внутрішньої організації гільдії: авторизації через Discord, профілів учасників, привʼязки Battle.net-персонажів, запису на рейди, прийняття правил, заявок і службових Discord-повідомлень.</p>

          <h2>2. Обліковий запис і доступ</h2>
          <p>Для входу використовується Discord. Доступ до окремих сторінок залежить від ролей, груп доступу та прав, налаштованих гільдією. Якщо роль у Discord змінено, доступ у панелі може бути оновлений або обмежений.</p>

          <h2>3. Реєстрація після прийняття правил</h2>
          <p>Натискання кнопки прийняття правил у Discord веде на сторінку авторизації та завершення профілю. Discord-роль видається тільки після заповнення обовʼязкових даних: імені, звертання, Battle.net-персонажів, мейна, рейдової ролі мейна та підтвердження серверного ніку за шаблоном.</p>

          <h2>4. Серверний нік Discord</h2>
          <p>Панель може спробувати автоматично змінити серверний нік за шаблоном <strong>Імʼя [Мейн, Альт1, Альт2]</strong>. Якщо Discord не дозволяє зміну ніку, наприклад для власника сервера або користувача з вищою роллю, нік потрібно змінити вручну.</p>

          <h2>5. Battle.net-персонажі та рейди</h2>
          <p>Користувач може додавати гільдійних та інших Battle.net-персонажів. Для рейдів система може враховувати item level, роль, мейна, вибраного персонажа та статус запису. Дані Battle.net можуть бути неповними або тимчасово недоступними через обмеження зовнішніх сервісів.</p>

          <h2>6. Поведінка та відповідальність</h2>
          <p>Користувач зобовʼязується вказувати коректні дані, не обходити обмеження доступу, не зловживати формами, кнопками та API панелі. Адміністрація гільдії може обмежити доступ у разі порушень правил сервера або зловживань.</p>

          <h2>7. Зміни в роботі сервісу</h2>
          <p>Функції панелі можуть змінюватися: рейди, ролі, правила, профілі, заявки та інтеграції можуть оновлюватися без окремого попередження, якщо це потрібно для роботи гільдії або безпеки.</p>

          <h2>8. Контакт</h2>
          <p>З питань доступу, профілю, ролей або помилок звертайся до гільдмайстра чи офіцерів Mistblossom Vanguard у Discord.</p>
        </article>
      </section>
    </main>
  );
}
