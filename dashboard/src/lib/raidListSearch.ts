export function matchesRaidListSearch(raid: { id: string; title?: string | null; date?: string | null; time?: string | null }, query: string): boolean {
  const needle = query.normalize("NFC").trim().toLocaleLowerCase("uk-UA");
  return !needle || [raid.title, raid.id, raid.date, raid.time].filter(Boolean).join(" ").normalize("NFC").toLocaleLowerCase("uk-UA").includes(needle);
}
