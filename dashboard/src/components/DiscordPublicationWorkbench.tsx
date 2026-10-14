import DiscordPublicationStatus from "@/components/DiscordPublicationStatus";
import { readPublicationStatus } from "@/lib/publicationStatusServer";
import { hasDiscordEmbedConfig } from "@/lib/discordAdmin";

/** Render only after the parent has checked canManageRaids. No Discord reads. */
export default async function DiscordPublicationWorkbench({ kind, id }: { kind: "raid" | "poll"; id: string }) {
  const status = await readPublicationStatus(kind, id);
  const endpoint = kind === "raid" ? `/api/raids/${encodeURIComponent(id)}/discord-sync` : `/api/polls/${encodeURIComponent(id)}/discord-sync`;
  return status ? <DiscordPublicationStatus endpoint={endpoint} initialStatus={status} discordEnabled={hasDiscordEmbedConfig()} /> : null;
}
