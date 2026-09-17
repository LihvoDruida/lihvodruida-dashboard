export const MISTBLOSSOM_DISCORD_GUILD_ID = "1449767281453301865";

export const MISTBLOSSOM_DISCORD_CHANNELS = {
  raids: {
    id: "1449768498397057064",
    label: "Рейди",
    description: "Анонси рейдів, записи та актуальна організаційна інформація по рейдових подіях.",
  },
  announcements: {
    id: "1449767282195562568",
    label: "Оголошення",
    description: "Головні новини гільдії, важливі зміни, плани та службові повідомлення.",
  },
  rules: {
    id: "1449767282195562569",
    label: "Правила гільдії",
    description: "Основні правила Mistblossom Vanguard. Їх потрібно прийняти, щоб завершити вступ.",
  },
  general: {
    id: "1449768050076291111",
    label: "Основне спілкування",
    description: "Головний чат гільдії. Доступ відкривається після прийняття правил і видачі ролі.",
  },
} as const;

export function discordGuildChannelUrl(channelId: string) {
  return `https://discord.com/channels/${MISTBLOSSOM_DISCORD_GUILD_ID}/${channelId}`;
}
