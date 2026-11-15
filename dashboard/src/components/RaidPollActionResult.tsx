import styles from "@/components/polls/poll-workspace.module.css";
export default function RaidPollActionResult({ message, href, unconfirmed = false }: { message: string; href: string; unconfirmed?: boolean }) {
  return <p className={styles.result} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} data-action-result="">
    {message}{unconfirmed ? <> <a href={href}>Перевірити стан</a></> : null}
  </p>;
}
