import { MISTBLOSSOM_DISCORD_CHANNELS, discordGuildChannelUrl } from "@/lib/discordGuildLinks";
import styles from "@/components/community/workspace.module.css";
export default function GuildDiscordGuide() {
  const channels = [MISTBLOSSOM_DISCORD_CHANNELS.rules, MISTBLOSSOM_DISCORD_CHANNELS.announcements, MISTBLOSSOM_DISCORD_CHANNELS.raids, MISTBLOSSOM_DISCORD_CHANNELS.general];
  return <details className={styles.details}><summary>Ключові канали гільдії в Discord</summary>
    <p className={styles.metadata}>Нові учасники спочатку приймають правила, після чого отримують доступ до основного чату.</p>
    <ul className={styles.list}>{channels.map(channel => <li key={channel.id}><a href={discordGuildChannelUrl(channel.id)} target="_blank" rel="noreferrer">{channel.label} ↗</a><p className={styles.metadata}>{channel.description}</p></li>)}</ul>
  </details>;
}
