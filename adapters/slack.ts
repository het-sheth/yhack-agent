import "dotenv/config";
import { randomUUID } from "crypto";
import { App } from "@slack/bolt";
import { connect, JSONCodec, type NatsConnection } from "nats";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { InboundMessage } from "../shared/types.js";

const jc = JSONCodec<InboundMessage>();

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

async function main() {
  console.log("[slack] Connecting to NATS...");
  const nc = await connect({ servers: NATS_URL });
  console.log(`[slack] NATS connected: ${NATS_URL}`);

  const app = new App({
    token: env("SLACK_BOT_TOKEN"),
    socketMode: true,
    appToken: env("SLACK_APP_TOKEN"),
  });

  // Listen to all messages in channels the bot is in
  app.message(async ({ message }) => {
    try {
      // Skip bot messages and subtypes (edits, deletes, etc.)
      if (message.subtype) return;

      const user = "user" in message ? (message.user as string) : "unknown";
      const text = "text" in message ? (message.text as string) : "";
      const threadTs =
        "thread_ts" in message ? (message.thread_ts as string) : undefined;
      const ts = message.ts;
      const channel =
        "channel" in message ? (message.channel as string) : "unknown";

      const inbound: InboundMessage = {
        id: randomUUID(),
        channel: "slack",
        from: user,
        body: text,
        threadId: threadTs ?? ts,
        threadDepth: threadTs ? 1 : 0,
        receivedAt: new Date(parseFloat(ts) * 1000).toISOString(),
      };

      nc.publish(SUBJECTS.INBOUND_SLACK, jc.encode(inbound));
      console.log(
        `[slack] Published: ${user} in ${channel} — ${text.slice(0, 60)}`
      );
    } catch (err) {
      console.error("[slack] Failed to process message:", err);
    }
  });

  await app.start();
  console.log("[slack] Socket Mode active — listening for messages...");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[slack] Shutting down...");
    await app.stop();
    await nc.drain();
    console.log("[slack] Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[slack] Fatal:", err);
  process.exit(1);
});
