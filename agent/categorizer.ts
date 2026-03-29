import "dotenv/config";
import { randomUUID } from "crypto";
import { connect, JSONCodec } from "nats";
import { b } from "../baml_client/index.js";
import { Category } from "../baml_client/types.js";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { InboundMessage, RankedMessage } from "../shared/types.js";
import { sign } from "./signer.js";
import { getDb, rankedCol } from "../shared/db.js";

const inboundCodec = JSONCodec<InboundMessage>();
const rankedCodec = JSONCodec<RankedMessage>();

const ROLE = process.env.AGENT_ROLE || "insurance broker";

// Map BAML Category enum to our lowercase category strings
const categoryMap: Record<Category, RankedMessage["category"]> = {
  [Category.URGENT]: "urgent",
  [Category.ACTION_REQUIRED]: "action-required",
  [Category.FYI]: "fyi",
  [Category.LOW_PRIORITY]: "low-priority",
};

async function main() {
  await getDb();
  const nc = await connect({ servers: NATS_URL });
  console.log(`[categorizer] NATS connected: ${NATS_URL}`);
  console.log(`[categorizer] Role: ${ROLE}`);
  console.log(`[categorizer] Using BAML with Groq → Gemini fallback`);

  const col = await rankedCol();
  const sub = nc.subscribe(SUBJECTS.INBOUND_ALL);
  console.log("[categorizer] Subscribed to messages.inbound.* — waiting...");

  for await (const msg of sub) {
    try {
      const inbound = inboundCodec.decode(msg.data);
      console.log(`[categorizer] Processing: ${inbound.from} — ${inbound.subject ?? "(no subject)"}`);

      // Call BAML — handles structured output + fallback automatically
      const result = await b.CategorizeMessage(
        ROLE,
        inbound.from,
        inbound.subject ?? "(no subject)",
        inbound.body
      );

      const id = randomUUID();
      const category = categoryMap[result.category] ?? "fyi";
      const score = Math.max(1, Math.min(10, result.score));
      const rankedAt = new Date().toISOString();

      // Sign the full payload
      const unsigned = {
        id,
        inbound,
        category,
        score,
        gist: result.gist,
        draftReply: result.draft_reply,
        rankedAt,
      };
      const signature = sign(JSON.stringify(unsigned));
      const ranked: RankedMessage = { ...unsigned, signature };

      // Persist to MongoDB first — only publish to NATS on success
      // This prevents duplicate NATS messages when the unique index rejects a dupe
      try {
        await col.insertOne(ranked as any);
      } catch (err: any) {
        if (err.code === 11000) {
          console.warn(`[categorizer] Duplicate inbound.id ${inbound.id} — skipping`);
        } else {
          console.error("[categorizer] MongoDB write failed:", err.message);
        }
        continue; // skip NATS publish if DB insert failed
      }
      nc.publish(SUBJECTS.RANKED, rankedCodec.encode(ranked));

      const emoji = category === "urgent" ? "🔴" : category === "action-required" ? "🟡" : category === "fyi" ? "🟢" : "⚪";
      console.log(`[categorizer] ${emoji} ${category} (${score}/10): ${result.gist}`);
    } catch (err) {
      console.error("[categorizer] Error:", err);
    }
  }
}

main().catch((err) => {
  console.error("[categorizer] Fatal:", err);
  process.exit(1);
});
