import { isAbsolute } from "node:path";
import { runWeChatRefundSyncWorker } from "@/lib/services/wechat-refund-sync-worker";

// Explicit state path avoids writing a scheduler cursor into a source checkout.
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--state-file" || !isAbsolute(args[1])) throw Error("WECHAT_REFUND_SYNC_STATE_PATH_REQUIRED");
  const result = await runWeChatRefundSyncWorker({ stateFile: args[1] });
  console.log(JSON.stringify({ job: "wechat-refund-sync", ...result }));
  if (!result.ok) process.exitCode = 1;
}
main().catch(error => {
  const value = error instanceof Error ? error.message : "";
  console.error(JSON.stringify({ job: "wechat-refund-sync", ok: false, code: /^WECHAT_[A-Z0-9_]{1,110}$/.test(value) ? value : "WECHAT_REFUND_SYNC_JOB_FAILED" }));
  process.exitCode = 1;
}).finally(async () => {
  const { prisma } = await import("@/lib/db/prisma");
  await prisma.$disconnect();
});
