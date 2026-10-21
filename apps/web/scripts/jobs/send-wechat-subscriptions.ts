import { Client } from "pg";
import { prisma } from "@/lib/db/prisma";
import { getSubscriptionSettings, runSubscriptionDeliveryBatch } from "@/lib/services/wechat-subscription-service";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--check", "--run"].includes(args[0]) || process.env.COMMERCE_STORAGE !== "prisma" || !process.env.DATABASE_URL) throw Error("SUBSCRIPTION_WORKER_CONFIGURATION_REQUIRED");
  const lock = new Client({ connectionString: process.env.DATABASE_URL, application_name: "merchantkit-wechat-subscriptions-worker", connectionTimeoutMillis: 5000, query_timeout: 15000 });
  let connected = false, acquired = false;
  try {
    await lock.connect(); connected = true;
    const result = await lock.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(879001, 20261018) AS acquired"); acquired = result.rows[0].acquired;
    if (!acquired) { console.log(JSON.stringify({ mode: args[0].slice(2), skipped: true, reason: "ALREADY_RUNNING" })); return; }
    const settings = await getSubscriptionSettings();
    if (args[0] === "--check") {
      console.log(JSON.stringify({ mode: "check", storageReady: true, lockAvailable: true, enabledChannels: settings.channels.filter(channel => channel.enabled).length, settingsRevision: settings.revision, notificationsAttempted: 0 }));
      return;
    }
    // A bounded worker uses a dedicated session lock. It never holds a database
    // transaction open while awaiting the provider, and it never restores or
    // rewrites historical commerce data. Uncertain sends remain quarantined.
    const report = await runSubscriptionDeliveryBatch();
    console.log(JSON.stringify({ mode: "run", ...report }));
    if (report.unknown > 0) process.exitCode = 1;
  } finally {
    if (acquired) await lock.query("SELECT pg_advisory_unlock(879001, 20261018)").catch(() => undefined);
    if (connected) await lock.end().catch(() => undefined);
    await prisma.$disconnect();
  }
}
main().catch(() => { console.error("WECHAT_SUBSCRIPTIONS_WORKER_FAILED"); process.exitCode = 1; });
