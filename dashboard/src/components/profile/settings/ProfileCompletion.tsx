import type { profileSettingsSetupStatus } from "@/lib/profiles";
import PageSection from "@/components/page/PageSection";
import Progress from "@/components/page/Progress";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "../profile-workspace.module.css";

export default function ProfileCompletion({ status }: { status: ReturnType<typeof profileSettingsSetupStatus> }) {
  const completed = status.steps.filter(step => step.complete).length;
  return <PageSection id="profile-completion-title" title="Стан заповнення профілю" description={status.complete ? "Реєстраційні дані заповнені." : `Потрібно доповнити: ${status.missing.map(step => step.title).join(", ")}.`}>
    <Progress value={completed} max={status.steps.length} label={`Заповнено ${completed} з ${status.steps.length}`} />
    <ul className={styles.steps}>
      {status.steps.map(step => <li key={step.key}><a href={step.key === "profile_gender" ? "#profile-gender-settings" : "#profile-name-settings"}>
        <StatusBadge tone={step.complete ? "success" : "warning"}>{step.complete ? "Готово" : "Потрібна дія"}</StatusBadge>
        <strong>{step.title}</strong><small>{step.description}</small>
      </a></li>)}
    </ul>
  </PageSection>;
}
