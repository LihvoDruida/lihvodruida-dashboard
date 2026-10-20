"use client";

import { ApiHttpError, apiFetchJson, type ApiFetchJsonOptions } from "@/lib/apiHttp";

export type DashboardApiJsonOptions = Omit<ApiFetchJsonOptions, "body"> & {
  json?: unknown;
  body?: BodyInit | null;
};

function clientTimeoutMs() {
  return 45_000;
}

export async function dashboardApiJson<T = unknown>(url: string, options: DashboardApiJsonOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let body = options.body ?? null;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }

  try {return await apiFetchJson<T>(url, {
    ...options,
    body,
    headers,
    cache: "no-store",
    credentials: options.credentials ?? "same-origin",
    timeoutMs: options.timeoutMs ?? clientTimeoutMs(),
    retries: options.retries ?? 1,
    retryMethods: options.retryMethods ?? ["GET", "HEAD"],
  });}catch(error){
    if(error instanceof ApiHttpError&&error.body&&typeof error.body==='object'){
      const body=error.body as Record<string,unknown>;
      const message=[body.message,body.error,body.detail].find(v=>typeof v==='string'&&v.trim());
      if(typeof message==='string')error.message=message.trim().slice(0,500);
    }
    throw error;
  }
}
