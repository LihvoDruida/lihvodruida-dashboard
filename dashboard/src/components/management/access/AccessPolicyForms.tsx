import type { AuthAccessPolicy } from "@/lib/authAccessPolicy";
import type { GeoAccessPolicy } from "@/lib/geoAccessPolicy";
import type { AccessGroup } from "@/lib/accessGroupSchema";
import FormSection from "@/components/page/FormSection";
import Notice from "@/components/page/Notice";
import Button from "@/components/ui/Button";
import FormField from "@/components/ui/FormField";
import RoleMappingsEditor, { type RoleMappingRow } from "./RoleMappingsEditor";
import styles from "./access.module.css";

export function AuthAccessForm({ policy, rows, groups, canEdit, isServerOwner, rolesError, protectedMappings }: {
  policy: AuthAccessPolicy;
  rows: RoleMappingRow[];
  groups: AccessGroup[];
  canEdit: boolean;
  isServerOwner: boolean;
  rolesError: boolean;
  protectedMappings: boolean;
}) {
  return <form className={styles.stack} action="/api/dashboard/security/auth-access" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
    {rolesError ? <Notice title="Discord-ролі недоступні" tone="warning">Збереження вимкнено, щоб не втратити наявні відповідності. Онови сторінку після відновлення зʼєднання.</Notice> : null}
    {protectedMappings ? <Notice title="Потрібен власник сервера" tone="warning">Політика містить адміністративні відповідності. Їх може змінювати лише власник Discord-сервера.</Notice> : null}
    <FormSection title="Правила входу" description="Публічні рейди доступні без входу. Команда отримує доступ лише через явно зіставлені Discord-ролі.">
      <label className={styles.toggle}><input type="checkbox" name="allowServerOwner" defaultChecked={policy.allowServerOwner} disabled={!isServerOwner || !canEdit} />
        <span><strong>Власник сервера має виняток</strong><small>Змінювати цей виняток може тільки власник.</small></span></label>
    </FormSection>
    <FormSection title="Discord → група сайту" description="Без відповідності вхід заборонено. Якщо ролей кілька, обирається група з вищим рангом.">
      <RoleMappingsEditor rows={rows} groups={groups.map(group => ({ id: group.id, name: group.name }))} disabled={!canEdit} />
      <div className={styles.fields}>
        <FormField label="Discord role ID (додати вручну)" name="manualRoleId" pattern="[0-9]{16,25}" maxLength={25} inputMode="numeric" placeholder="123456789012345678" disabled={!canEdit} />
        <label className={styles.field}>Група доступу<select name="manualGroupId" defaultValue="" disabled={!canEdit}><option value="">Не додавати</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      </div>
      {!groups.length ? <Notice title="Групи недоступні" tone="warning">Спочатку перевір групи доступу. Збереження політики вимкнено.</Notice> : null}
    </FormSection>
    <Button tone="primary" type="submit" disabled={!canEdit || !groups.length}>Зберегти правила входу</Button>
  </form>;
}

export function GeoAccessForm({ policy }: { policy: GeoAccessPolicy }) {
  const options = [
    { name: "enabled", title: "Увімкнути геообмеження", hint: "Застосовувати налаштовані правила.", checked: policy.enabled },
    { name: "blockApplications", title: "Блокувати подання заявок", hint: "Для країн зі списку нижче.", checked: policy.blockApplications },
    { name: "blockAuth", title: "Блокувати авторизацію", hint: "Не починати Discord OAuth із заблокованих країн.", checked: policy.blockAuth },
    { name: "blockUnknownCountries", title: "Блокувати невідому країну", hint: "Може зачепити VPN або запити без геоданих.", checked: policy.blockUnknownCountries },
  ];
  return <form className={styles.stack} action="/api/dashboard/security/geo-access" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
    <FormSection title="Географія доступу" description="Країна визначається сервером за даними запиту. Користувач не обирає її вручну.">
      {options.map(option => <label className={styles.toggle} key={option.name}><input type="checkbox" name={option.name} defaultChecked={option.checked} />
        <span><strong>{option.title}</strong><small>{option.hint}</small></span></label>)}
      <FormField label="Заблоковані країни" name="blockedCountries" defaultValue={policy.blockedCountries.join(", ")} maxLength={512}
        hint="ISO-коди через кому, наприклад RU, BY. Регістр нормалізується сервером." placeholder="RU, BY" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
    </FormSection>
    <Button type="submit" tone="primary">Зберегти геообмеження</Button>
  </form>;
}
