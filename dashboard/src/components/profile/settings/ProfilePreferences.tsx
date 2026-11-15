import type { DashboardProfile, ProfileCharacter, ProfileGrammaticalGender } from "@/lib/profiles";
import { getMainCharacter, buildProfileDiscordNicknamePlan } from "@/lib/profiles";
import { resolveWowCharacterRole, wowRoleLabel, type WowCharacterRole } from "@/lib/wowRoles";
import FormSection from "@/components/page/FormSection";
import EmptyState from "@/components/page/EmptyState";
import Button from "@/components/ui/Button";
import NicknameSelection from "./NicknameSelection";
import styles from "../profile-workspace.module.css";

export function ProfileGenderPreferenceForm({ value, returnTo = "" }: { value?: ProfileGrammaticalGender | null; returnTo?: string }) {
  const options = [
    { value: "male", title: "Чоловіча форма", example: "Підписаний" },
    { value: "female", title: "Жіноча форма", example: "Підписана" },
    { value: "neutral", title: "Нейтральне звертання", example: "Підписали" },
    { value: "nonbinary", title: "Небінарна особа", example: "Підписали" },
  ];
  return <form action="/api/profile/gender" method="post">
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    <FormSection title="Форма звертання" description="Використовується у персональних текстах, рейдах і Discord."
      actions={<Button type="submit" tone="primary">Зберегти звертання</Button>}>
      {options.map(option => <label className={styles.option} key={option.value}>
        <input type="radio" name="grammaticalGender" value={option.value} defaultChecked={value === option.value} required />
        <span><strong>{option.title}</strong><small>Приклад: {option.example}</small></span>
      </label>)}
    </FormSection>
  </form>;
}

export function RaidRolePreferenceForm({ mainCharacter, manualRole, selectedRole, returnTo = "" }: {
  mainCharacter?: ProfileCharacter | null;
  manualRole?: WowCharacterRole | null;
  selectedRole: WowCharacterRole;
  returnTo?: string;
}) {
  if (!mainCharacter) return <EmptyState title="Спочатку вибери мейна" description="Після додавання мейна можна буде уточнити роль для рейдів." />;
  const autoRole = resolveWowCharacterRole(mainCharacter);
  const options: Array<{ value: "auto" | WowCharacterRole; label: string }> = [
    { value: "auto", label: `Авто: ${wowRoleLabel(autoRole)}` }, { value: "tank", label: "Танк" },
    { value: "healer", label: "Хіл" }, { value: "dps", label: "ДД" },
  ];
  return <form action="/api/profile/raid-role" method="post">
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    <FormSection title="Роль у рейді" description={`${mainCharacter.name} · поточна роль: ${wowRoleLabel(selectedRole)}. Авто бере роль зі спеціалізації мейна.`}
      actions={<Button type="submit" tone="primary">Зберегти роль</Button>}>
      {options.map(option => <label className={styles.option} key={option.value}>
        <input type="radio" name="raidRole" value={option.value} defaultChecked={option.value === "auto" ? !manualRole : manualRole === option.value} />
        <span><strong>{option.label}</strong></span>
      </label>)}
    </FormSection>
  </form>;
}

export function NicknameCharactersForm({ profile, nicknameTemplate, returnTo = "" }: { profile: DashboardProfile; nicknameTemplate: string; returnTo?: string }) {
  const main = getMainCharacter(profile);
  const choices = profile.characters.filter(character => character.key !== main?.key).sort((a, b) => Number(b.verifiedGuild) - Number(a.verifiedGuild) || a.name.localeCompare(b.name, "uk"))
    .map(character => ({ key: character.key, name: character.name, detail: [character.realmName || character.realmSlug, character.activeSpecName, character.className, character.verifiedGuild ? "Гільдійний" : "Інший"].filter(Boolean).join(" · ") }));
  const plan = buildProfileDiscordNicknamePlan(profile, nicknameTemplate);
  return <FormSection title="Альти у Discord-ніку" description={`Попередній вигляд: ${plan.value || "Спочатку вкажи імʼя"}. Формат: ${nicknameTemplate}`}>
    {choices.length ? <NicknameSelection choices={choices} selected={(profile.nicknameCharacterKeys || []).filter(key => key !== main?.key)} returnTo={returnTo} />
      : <EmptyState title="Немає альтів для вибору" description="Додай інших персонажів у профілі. Мейн додається у Discord-нік автоматично." />}
  </FormSection>;
}
