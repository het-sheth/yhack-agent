import "dotenv/config";
import { randomUUID } from "crypto";
import { connect, JSONCodec } from "nats";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { InboundMessage, RankedMessage } from "../shared/types.js";
import { sign } from "./signer.js";

const inboundCodec = JSONCodec<InboundMessage>();
const rankedCodec = JSONCodec<RankedMessage>();

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function buildPrompt(msg: InboundMessage): string {
  return `You are an email triage assistant for a busy insurance broker. Categorize this message and draft a reply.

From: ${msg.from}
Subject: ${msg.subject ?? "(no subject)"}
Body: ${msg.body}

Respond with ONLY valid JSON (no markdown fences, no extra text):
{
  "category": "urgent" | "action-required" | "fyi" | "low-priority",
  "score": <number 1-10, 10 = most urgent>,
  "gist": "<1-2 sentence summary>",
  "draftReply": "<suggested response if action needed, empty string if fyi/low-priority>"
}`;
}

function parseResponse(text: string): {
  category: RankedMessage["category"];
  score: number;
  gist: string;
  draftReply: string;
} {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```json?\s*/gi, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

async function main() {
  console.log("[categorizer] Connecting to NATS...");
  const nc = await connect({ servers: NATS_URL });
  console.log(`[categorizer] NATS connected: ${NATS_URL}`);

  const genAI = new GoogleGenerativeAI(env("GEMINI_API_KEY"));
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });

  const sub = nc.subscribe(SUBJECTS.INBOUND_ALL);
  console.log("[categorizer] Subscribed to messages.inbound.* — waiting...");

  for await (const msg of sub) {
    try {
      const inbound = inboundCodec.decode(msg.data);
      console.log(`[categorizer] Processing: ${inbound.from} — ${inbound.subject ?? "(no subject)"}`);

      const result = await model.generateContent(buildPrompt(inbound));
      const text = result.response.text();
      const parsed = parseResponse(text);

      const id = randomUUID();
      const signature = sign(JSON.stringify({
        id,
        category: parsed.category,
        score: parsed.score,
        gist: parsed.gist,
      }));

      const ranked: RankedMessage = {
        id,
        inbound,
        category: parsed.category,
        score: parsed.score,
        gist: parsed.gist,
        draftReply: parsed.draftReply,
        signature,
        rankedAt: new Date().toISOString(),
      };

      nc.publish(SUBJECTS.RANKED, rankedCodec.encode(ranked));
      console.log(
        `[categorizer] ${ranked.category} (score ${ranked.score}): ${inbound.from} — ${inbound.subject ?? "(no subject)"}`
      );
    } catch (err) {
      console.error("[categorizer] Failed to process message:", err);
    }
  }
}

main().catch((err) => {
  console.error("[categorizer] Fatal:", err);
  process.exit(1);
});
