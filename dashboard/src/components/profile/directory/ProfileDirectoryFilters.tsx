import Link from "next/link";
import type { ProfileDirectoryFilters as Filters } from "@/lib/profileDirectoryNavigation";
import FilterNavigationForm from "@/components/page/FilterNavigationForm";
import FilterToolbar from "@/components/page/FilterToolbar";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";

export default function ProfileDirectoryFilters({ filters, total }: { filters: Filters; total: number }) {
  const active = Boolean(filters.query || filters.link !== "all" || filters.role !== "all" || filters.sort !== "activity");
  return <FilterNavigationForm action="/profiles"><FilterToolbar label="Пошук і фільтри профілів"
    search={<FormField id="profile-directory-search" label="Пошук учасника" name="q" type="search" maxLength={120} defaultValue={filters.query} placeholder="Імʼя, Discord, персонаж або реалм" />}
    filters={<>
      <label>Battle.net<select name="link" defaultValue={filters.link}><option value="all">Усі</option><option value="linked">Підключено</option><option value="unlinked">Не підключено</option></select></label>
      <label>Роль<select name="role" defaultValue={filters.role}><option value="all">Усі ролі</option><option value="admin">Адмін</option><option value="moderator">Офіцер</option><option value="mentor">Наставник</option><option value="member">Учасник</option></select></label>
      <label>Сортування<select name="sort" defaultValue={filters.sort}><option value="activity">За активністю</option><option value="name">За іменем</option><option value="characters">За персонажами</option></select></label>
    </>}
    actions={<><Button tone="primary" type="submit">Застосувати</Button>{active ? <Link className="btn subtle" href="/profiles?view=all" data-list-reset-position>Скинути</Link> : null}</>}
    result={`Знайдено профілів: ${total}`} /></FilterNavigationForm>;
}
