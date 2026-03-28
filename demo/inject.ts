import "dotenv/config";
import { randomUUID } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { connect, JSONCodec } from "nats";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { InboundMessage } from "../shared/types.js";

const jc = JSONCodec<InboundMessage>();

interface SeedEmail {
  from: string;
  subject: string;
  body: string;
  category_hint: string;
}

function loadSeedEmails(): SeedEmail[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "seed-emails");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
}

function parseCount(): number {
  const idx = process.argv.indexOf("--count");
  if (idx === -1) return Infinity;
  const val = process.argv[idx + 1];
  if (!val) throw new Error("Missing value for --count. Usage: npm run inject -- --count 10");
  const n = parseInt(val, 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid --count value: ${val}`);
  return n;
}

async function main() {
  const limit = parseCount();
  const emails = loadSeedEmails();
  const toInject = emails.slice(0, limit);

  console.log("[inject] Connecting to NATS...");
  const nc = await connect({ servers: NATS_URL });
  console.log(`[inject] NATS connected: ${NATS_URL}`);

  console.log(`[inject] Publishing ${toInject.length} messages...`);

  for (let i = 0; i < toInject.length; i++) {
    const email = toInject[i];
    const msg: InboundMessage = {
      id: randomUUID(),
      channel: "email",
      from: email.from,
      subject: email.subject,
      body: email.body,
      receivedAt: new Date().toISOString(),
    };

    nc.publish(SUBJECTS.INBOUND_EMAIL, jc.encode(msg));
    console.log(`[inject] Published ${i + 1}/${toInject.length}: ${email.subject}`);
  }

  await nc.drain();
  console.log("[inject] Done.");
}

main().catch((err) => {
  console.error("[inject] Fatal:", err);
  process.exit(1);
});
