export type DashboardRole = "admin" | "moderator" | "mentor" | "member";

export type DashboardSession = {
  provider: "discord" | "github" | "token";
  id: string;
  name: string;
  login?: string;
  role: DashboardRole;
  profileId?: string;
  avatar?: string | null;
  avatar_url?: string | null;
  discordRoleIds?: string[];
  groupId?: string;
  groupName?: string;
  groupRank?: number;
  permissions?: string[];
  isServerOwner?: boolean;
  impersonatedBy?: string;
};

export type SessionUser = DashboardSession;

