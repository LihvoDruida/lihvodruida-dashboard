import type { MetadataRoute } from "next";
import { dashboardBaseUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
    host: dashboardBaseUrl(),
  };
}
