// Runs once when the server boots. Logs configuration problems loudly (does not crash: the login page
// and /api/health report the same things, and a restart loop would hide the log lines).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  try {
    const { preflightProblems } = await import("@/lib/preflight");
    const { DATA_DIR } = await import("@/db");
    for (const problem of preflightProblems(process.env, DATA_DIR)) console.error(`FATAL: ${problem}`);
  } catch (e) {
    console.error("preflight could not run:", e); // diagnostics must never stop the server from booting
  }
}
