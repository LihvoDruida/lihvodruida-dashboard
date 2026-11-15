import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";

export default function Loading() {
  return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>;
}
