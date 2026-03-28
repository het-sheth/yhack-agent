import "dotenv/config";
import { randomUUID } from "crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { connect, JSONCodec, type NatsConnection } from "nats";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { InboundMessage } from "../shared/types.js";

const jc = JSONCodec<InboundMessage>();
const seenUids = new Set<number>();
let polling = false;

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function createImapClient(): ImapFlow {
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: env("GMAIL_USER"),
      pass: env("GMAIL_APP_PASSWORD"),
    },
    logger: false,
  });
}

async function fetchAndPublish(
  imap: ImapFlow,
  nc: NatsConnection,
  uid: number
) {
  if (seenUids.has(uid)) return;

  try {
    const raw = await imap.download(String(uid), undefined, { uid: true });
    const parsed = await simpleParser(raw.content);

    const from =
      parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? "unknown";
    const subject = parsed.subject ?? undefined;
    const body = parsed.text ?? (parsed.html ? String(parsed.html) : "");

    const attachments =
      parsed.attachments.length > 0
        ? parsed.attachments.map((a) => a.filename ?? "unnamed")
        : undefined;

    // Gmail thread ID from headers, fall back to message-id
    const threadId =
      parsed.headers.get("x-gm-thrid")?.toString() ??
      parsed.messageId ??
      undefined;

    const msg: InboundMessage = {
      id: randomUUID(),
      channel: "email",
      from,
      subject,
      body,
      attachments,
      threadId,
      receivedAt: (parsed.date ?? new Date()).toISOString(),
    };

    nc.publish(SUBJECTS.INBOUND_EMAIL, jc.encode(msg));
    seenUids.add(uid);
    console.log(`[email] Published: ${from} — ${subject ?? "(no subject)"}`);
  } catch (err) {
    console.error(`[email] Failed to process UID ${uid}:`, err);
  }
}

async function pollUnseen(imap: ImapFlow, nc: NatsConnection) {
  if (polling) return;
  polling = true;
  try {
    const result = await imap.search({ seen: false }, { uid: true });
    const uids = Array.isArray(result) ? result : [];
    for (const uid of uids) {
      await fetchAndPublish(imap, nc, uid);
    }
  } finally {
    polling = false;
  }
}

async function main() {
  console.log("[email] Connecting to NATS...");
  const nc = await connect({ servers: NATS_URL });
  console.log(`[email] NATS connected: ${NATS_URL}`);

  const imap = createImapClient();

  console.log("[email] Connecting to Gmail IMAP...");
  await imap.connect();
  console.log(`[email] IMAP connected: ${env("GMAIL_USER")}`);

  // Initial poll for unseen messages
  const initLock = await imap.getMailboxLock("INBOX");
  try {
    await pollUnseen(imap, nc);
  } finally {
    initLock.release();
  }

  // Open INBOX — ImapFlow auto-enters IDLE mode
  const lock = await imap.getMailboxLock("INBOX");

  // Listen for new messages (IDLE push) — guarded against concurrent runs
  imap.on("exists", async (data: { path: string; count: number; prevCount: number }) => {
    console.log(`[email] New message(s) detected: ${data.count - data.prevCount} new`);
    try {
      await pollUnseen(imap, nc);
    } catch (err) {
      console.error("[email] Error processing new messages:", err);
    }
  });

  console.log("[email] IDLE mode active — waiting for new emails...");

  // Fallback polling every 60s — skipped if already polling
  const pollInterval = setInterval(async () => {
    try {
      await pollUnseen(imap, nc);
    } catch (err) {
      console.error("[email] Poll error:", err);
    }
  }, 60_000);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[email] Shutting down...");
    try {
      clearInterval(pollInterval);
      lock.release();
      await imap.logout();
      await nc.drain();
      console.log("[email] Goodbye.");
    } catch (err) {
      console.error("[email] Shutdown error:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[email] Fatal:", err);
  process.exit(1);
});
