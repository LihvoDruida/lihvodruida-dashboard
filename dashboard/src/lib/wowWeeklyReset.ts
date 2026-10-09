/**
 * WoW Retail EU weekly raid lockout reset: Wednesday 04:00 UTC.
 * Uses an absolute UTC boundary (not the viewer's timezone), so DST changes
 * in Kyiv or elsewhere never make the countdown jump.
 * https://wowreset.com/eu.html
 */
export const RETAIL_EU_RESET_DAY_UTC = 3; // Wednesday
export const RETAIL_EU_RESET_HOUR_UTC = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function nextRetailEuWeeklyReset(nowMs: number, utcHour = RETAIL_EU_RESET_HOUR_UTC): number {
  const now = new Date(nowMs);
  if (!Number.isFinite(nowMs)) throw new Error("Invalid reset clock");
  const hour = Number.isInteger(utcHour) && utcHour >= 0 && utcHour <= 23 ? utcHour : RETAIL_EU_RESET_HOUR_UTC;
  const daysToWednesday = (RETAIL_EU_RESET_DAY_UTC - now.getUTCDay() + 7) % 7;
  let next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToWednesday, hour);
  if (next <= nowMs) next += WEEK_MS;
  return next;
}

export function splitResetCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
    seconds: seconds % 60,
  };
}
