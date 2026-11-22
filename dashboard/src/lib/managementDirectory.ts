export type ManagementCategory = "access" | "discord" | "system";
/** One management section as the overview header and quick actions see it. */
export type ManagementDirectoryItem = {
  key: string;
  href: string;
  label: string;
  description: string;
  section: ManagementCategory;
};
