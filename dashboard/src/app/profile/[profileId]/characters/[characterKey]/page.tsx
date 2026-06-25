import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{
    profileId: string;
    characterKey: string;
  }>;
};

export default async function RemovedCharacterStatisticsPage({ params }: PageProps) {
  const { profileId } = await params;
  redirect(`/profile/${encodeURIComponent(profileId)}`);
}
