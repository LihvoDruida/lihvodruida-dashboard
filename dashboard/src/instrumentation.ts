// Runs once when the Node.js server starts: applies owner-edited runtime settings
// (dashboardSettings/systemRuntime) on top of .env before the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startSystemSettingsSync } = await import("./lib/systemSettings");
  // Wait for the first load so the very first requests already see owner overrides.
  await startSystemSettingsSync();
}
