import type { listRaidDiscordPreferences } from "@/lib/raidDiscordPresets";
import { wowSpecFullName } from "@/lib/wowClassCatalog";
import DataTable from "@/components/ui/DataTable";
import EmptyState from "@/components/page/EmptyState";
import { profileDirectoryDate } from "./ProfileDirectoryTable";

export default function DiscordRaidPreferences({ items }: { items: Awaited<ReturnType<typeof listRaidDiscordPreferences>> }) {
  return <details><summary>Налаштування записів через Discord ({items.length})</summary>
    <p>Класи, спеціалізації й нагадування привʼязані до Discord ID та не є каталогом вебпрофілів.</p>
    {items.length ? <DataTable caption="Налаштування Discord-записів" headings={["Учасник", "Клас / спеціалізація", "Статус", "Нагадування", "Вибори", "Оновлено"]}>
      {items.map(item => <tr key={item.discordId}><th scope="row">{item.displayName}<small>{item.discordId}</small></th>
        <td>{item.lastClassKey ? wowSpecFullName(item.lastClassKey, item.lastSpecKey) : "Не вибрано"}</td><td>{item.lastStatus}</td>
        <td>{item.reminderEnabled ? "Увімкнено" : "Вимкнено"}</td><td>{item.presets.map(preset => `${wowSpecFullName(preset.classKey, preset.specKey)} ×${preset.count}`).join(" · ") || "—"}</td>
        <td>{profileDirectoryDate(item.updatedAt)}</td></tr>)}
    </DataTable> : <EmptyState title="Збережених налаштувань немає" description="Вони зʼявляються після першого вибору в Discord-меню рейду." />}
  </details>;
}
