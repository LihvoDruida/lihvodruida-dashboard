import type { AutomationOverview as Overview } from "@/lib/automationStatus";
import styles from "./AutomationOverview.module.css";

function time(iso: string) {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}
export default function AutomationOverview({ overview }: { overview: Overview }) {
  return <section className={styles.overview} aria-label="Стан автоматизацій">
    <header className={styles.heading}><div><span className={styles.eyebrow}>Автоматизації</span><h2>Що відбувається зараз</h2></div>
      <p>Знімок на <time dateTime={overview.checkedAt}>{time(overview.checkedAt)}</time> · Київ.<br />Оновлюється з відкриттям сторінки.</p></header>
    <div className={styles.grid}>{overview.cards.map(card => <article key={card.id} className={`panel ${styles.card}`} data-state={card.state}>
      <header className={styles.cardHeading}><h3>{card.title}</h3><span className={styles.state}>{card.label}</span></header>
      <p className={styles.reason}>{card.reason}</p>
      <dl className={styles.details}>
        <div><dt>Останній результат</dt><dd>{card.lastResult}{card.lastAt && <time dateTime={card.lastAt}>{time(card.lastAt)} · Київ</time>}</dd></div>
        <div><dt>Очікуваний запуск</dt><dd>{card.nextAt && <time dateTime={card.nextAt}>{time(card.nextAt)} · Київ</time>}<span>{card.nextNote}</span></dd></div>
      </dl>
      <a href={card.action.href} className={`btn subtle ${styles.action}`}>{card.action.label}<span aria-hidden="true">↗</span></a>
    </article>)}</div>
  </section>;
}
