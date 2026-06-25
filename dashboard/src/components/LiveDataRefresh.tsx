import DashboardBackgroundApiRefresh from "@/components/DashboardBackgroundApiRefresh";

type Props = {
  enabled?: boolean;
  refreshMinMs?: number;
};

export default function LiveDataRefresh({ enabled = true, refreshMinMs }: Props) {
  if (!enabled) return null;
  return <DashboardBackgroundApiRefresh refreshMinMs={refreshMinMs} />;
}
