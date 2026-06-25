import type { DashboardSession } from "@/lib/auth";
import { fetchDiscordGuildMemberSnapshot, hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { buildAuthorNameSuggestions, getProfileById, getProfilePublicName, type AuthorNameSuggestion, type DashboardProfile } from "@/lib/profiles";

export type ResolvedAuthorIdentity = {
  profile: DashboardProfile | null;
  primaryName: string;
  serverDiscordName: string | null;
  suggestions: AuthorNameSuggestion[];
};

export async function resolveAuthorIdentity(session: DashboardSession): Promise<ResolvedAuthorIdentity> {
  const profile = session.profileId ? await getProfileById(session.profileId).catch(() => null) : null;
  let serverDiscordName: string | null = null;

  if (session.provider === "discord" && /^\d{16,25}$/.test(session.id) && hasDiscordEmbedConfig()) {
    serverDiscordName = (await fetchDiscordGuildMemberSnapshot(session.id).catch(() => null))?.displayName || null;
  }

  const suggestions = buildAuthorNameSuggestions({
    profile,
    sessionName: session.name || session.login || null,
    serverDiscordName,
  });

  return {
    profile,
    primaryName: profile ? getProfilePublicName(profile) : suggestions[0]?.value || session.name || session.login || "Учасник",
    serverDiscordName,
    suggestions,
  };
}
