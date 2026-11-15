"use client";
import { useId, useState } from "react";
import FilterToolbar from "@/components/page/FilterToolbar";
import FormField from "@/components/ui/FormField";
import styles from "./access.module.css";

export type RoleMappingRow = { roleId: string; name: string; groupId: string; missing?: boolean };
export default function RoleMappingsEditor({ rows, groups, disabled }: { rows: RoleMappingRow[]; groups: Array<{ id: string; name: string }>; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const prefix = useId();
  const needle = query.trim().toLocaleLowerCase("uk-UA");
  const match = (row: RoleMappingRow) => `${row.name} ${row.roleId}`.toLocaleLowerCase("uk-UA").includes(needle);
  return <div className={styles.stack}>
    <FilterToolbar label="Пошук Discord-ролей" search={<FormField label="Знайти роль" type="search" value={query} maxLength={120}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Назва або ID ролі" />}
      result={`Ролей: ${rows.filter(match).length} із ${rows.length}. Усі відповідності залишаються у формі.`} />
    <div className={styles.roles}>
      {rows.map(row => <div key={row.roleId} className={styles.roleRow} hidden={!match(row)}>
        <label htmlFor={`${prefix}-${row.roleId}`}><strong>{row.name}</strong><small>{row.roleId}{row.missing ? " · роль не повернута Discord" : ""}</small></label>
        <select id={`${prefix}-${row.roleId}`} name={`roleMap:${row.roleId}`} defaultValue={row.groupId} disabled={disabled} aria-label={`Група сайту для Discord-ролі ${row.name}`}>
          <option value="">Без доступу</option>
          {row.groupId && !groups.some(group => group.id === row.groupId) ? <option value={row.groupId}>Поточна група {row.groupId} (редагує власник)</option> : null}
          {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </div>)}
    </div>
    {!rows.some(match) ? <p className={styles.hint} role="status">Ролей за цим пошуком не знайдено. Відповідності не змінені.</p> : null}
  </div>;
}
