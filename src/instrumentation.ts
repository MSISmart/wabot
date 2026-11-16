/**
 * Self-hosted / local: a built-in timer runs scheduled jobs (reminders) every minute.
 * On serverless hosts (Vercel) there is no long-running process, so an external cron calls /api/cron/tick instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL || process.env.DISABLE_INTERNAL_CRON) return;
  const g = globalThis as unknown as { __wabot_cron?: boolean };
  if (g.__wabot_cron) return;
  g.__wabot_cron = true;
  const { runDueJobs } = await import("@/engine/jobs");
  setInterval(() => { runDueJobs().catch((e) => console.error("cron tick failed", e)); }, 60_000).unref();
}
