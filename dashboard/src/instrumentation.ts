// Runs once when the Node.js server starts: applies owner-edited runtime settings
// (dashboardSettings/systemRuntime) on top of .env before the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startSystemSettingsSync } = await import("./lib/systemSettings");
  startSystemSettingsSync();
}
