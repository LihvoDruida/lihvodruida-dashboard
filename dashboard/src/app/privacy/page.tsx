import HeroSidePanel from "@/components/HeroSidePanel";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Політика конфіденційності",
  description: "Політика конфіденційності гільдійної панелі Mistblossom Vanguard: Discord, Battle.net, профілі, рейди, правила та заявки.",
  path: "/privacy",
  keywords: ["політика конфіденційності", "персональні дані", "Discord", "Battle.net"],
});

const updatedAt = "09 травня 2026";

export default function PrivacyPage() {
  return (
    <main className="container legal-page">
      <section className="dashboard-shell content-shell legal-shell" aria-label="Політика конфіденційності Mistblossom Vanguard">
        <header className="hero panel dashboard-hero legal-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Документи</div>
            <h1>Політика конфіденційності</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">Цей документ пояснює, які дані потрібні панелі гільдії, навіщо вони використовуються та як вони захищаються.</p>
            <small>Оновлено: {updatedAt}</small>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд документа"
            summary={[
              { label: "ДОКУМЕНТ", value: "Дані та захист", note: "Discord, Battle.net, профілі" },
              { label: "ОНОВЛЕНО", value: updatedAt, note: "Актуальна редакція" },
            ]}
            stats={[
              { label: "COOKIE", value: "YES" },
              { label: "B.NET", value: "YES" },
              { label: "DISCORD", value: "YES" },
            ]}
          />
        </header>

        <article className="panel legal-card">
          <h2>1. Які дані обробляються</h2>
          <p>Панель може зберігати Discord ID, імʼя, аватар, серверні ролі, групу доступу, профільне імʼя, вибране звертання, Battle.net-персонажів, мейна, рейдову роль, записи на рейди, факт прийняття правил, заявки та службові журнали дій.</p>

          <h2>2. Дані Discord</h2>
          <p>Discord використовується для входу, перевірки ролей, видачі ролі після завершення реєстрації, синхронізації ніку та роботи кнопок у повідомленнях. Панель не отримує пароль Discord і не має доступу до приватних повідомлень користувача.</p>

          <h2>3. Дані Battle.net</h2>
          <p>Battle.net використовується для підтвердження персонажів, відображення класу, спеки, ролі, item level, реалму, зображень персонажа та вибору мейна. Дані використовуються для профілю, рейдових записів і складу рейду.</p>

          <h2>4. Для чого це потрібно</h2>
          <p>Дані потрібні для організації гільдії: доступу до панелі, правил, рейдів, заявок, складу, Discord-ролей, модерації та безпеки. Частина даних показується тільки офіцерам або адміністраторам відповідно до прав доступу.</p>

          <h2>5. Cookies і сесії</h2>
          <p>Панель використовує cookies для авторизації, захисту сесії та тимчасових дій, наприклад повернення після Discord OAuth або Battle.net OAuth. Cookies не призначені для рекламного трекінгу.</p>

          <h2>6. Сторонні сервіси</h2>
          <p>У роботі можуть використовуватися Discord, Battle.net, Firebase або інше сховище профілів, GitHub Issues для заявок, Cloudflare Workers і Vercel. Кожен із цих сервісів може обробляти технічні дані згідно зі своїми правилами.</p>

          <h2>7. Зберігання та видалення</h2>
          <p>Дані зберігаються стільки, скільки потрібно для роботи гільдії, рейдів, правил і модерації. Користувач може звернутися до адміністрації гільдії з проханням виправити або видалити профільні дані, якщо це не суперечить безпеці та службовим журналам.</p>

          <h2>8. Безпека</h2>
          <p>Доступ до службових сторінок обмежується ролями та групами доступу. Для чутливих дій використовуються перевірки сесії, прав, походження запиту та обмеження частоти запитів.</p>

          <h2>9. Контакт</h2>
          <p>З питань приватності, доступу або виправлення даних звертайся до гільдмайстра чи офіцерів Mistblossom Vanguard у Discord.</p>
        </article>
      </section>
    </main>
  );
}
