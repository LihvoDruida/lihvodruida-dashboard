import Link from "next/link";
import {isRaidClosed, raidTitle, type RaidItem} from "@/lib/raids";
import DropdownMenu from "@/components/ui/DropdownMenu";
import Button from "@/components/ui/Button";
export default function RaidManageActions({raid}: {raid: RaidItem}) {
  return <DropdownMenu label={`Керування: ${raidTitle(raid)}`}>
    <Link className="btn subtle" href={`/raids/${encodeURIComponent(raid.id)}/edit`} prefetch={false}>Редагувати</Link>
    {!isRaidClosed(raid) && raid.status !== "draft" ? <form action={`/api/raids/${encodeURIComponent(raid.id)}/close`} method="post"><Button tone="warning" type="submit">Закрити рейд</Button></form> : null}
    <form action={`/api/raids/${encodeURIComponent(raid.id)}/delete`} method="post" data-confirm-message={raid.status === "draft" ? "Видалити чернетку рейду?" : "Видалити рейд і повʼязане оголошення та подію Discord?"}>
      <Button tone="danger" type="submit">{raid.status === "draft" ? "Видалити чернетку" : "Видалити рейд"}</Button>
    </form>
  </DropdownMenu>;
}
