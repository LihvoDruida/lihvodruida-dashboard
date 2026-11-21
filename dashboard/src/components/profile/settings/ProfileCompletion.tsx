import type { profileSettingsSetupStatus } from "@/lib/profiles";
import Progress from "@/components/page/Progress";
import styles from "@/components/account/account.module.css";

/** One compact strip: progress and a chip per registration step that jumps to its form. */
export default function ProfileCompletion({ status }: { status: ReturnType<typeof profileSettingsSetupStatus> }) {
  const completed = status.steps.filter(step => step.complete).length;
  return <section className={styles.completion} aria-labelledby="profile-completion-title">
    <div className={styles.completionHead}>
      <strong id="profile-completion-title">{status.complete ? "Профіль заповнено" : "Заповнення профілю"}</strong>
      <span>{completed} з {status.steps.length}{status.complete ? "" : ` · потрібно: ${status.missing.map(step => step.title).join(", ")}`}</span>
    </div>
    <Progress value={completed} max={status.steps.length} label={`Заповнено ${completed} з ${status.steps.length}`} />
    <ul className={styles.completionSteps}>
      {status.steps.map(step => <li key={step.key}><a href={step.key === "profile_gender" ? "#profile-gender-settings" : "#profile-name-settings"} data-done={step.complete} title={step.description}>
        {step.complete ? "✓" : "•"} {step.title}
      </a></li>)}
    </ul>
  </section>;
}
