import "dotenv/config";
import { randomUUID } from "crypto";
import { connect, JSONCodec } from "nats";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { InboundMessage, RankedMessage } from "../shared/types.js";
import { sign } from "./signer.js";

const inboundCodec = JSONCodec<InboundMessage>();
const rankedCodec = JSONCodec<RankedMessage>();

const VALID_CATEGORIES = new Set(["urgent", "action-required", "fyi", "low-priority"]);

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function buildPrompt(msg: InboundMessage): string {
  return `You are an email triage assistant for a busy insurance broker. Categorize this message and draft a reply.

<message>
From: ${msg.from}
Subject: ${msg.subject ?? "(no subject)"}
Body: ${msg.body}
</message>

Respond with ONLY valid JSON (no markdown fences, no extra text). Use this exact JSON shape:
{
  "category": "urgent",
  "score": 7,
  "gist": "Short 1-2 sentence summary of the email.",
  "draftReply": "Suggested response if action is needed, or an empty string if FYI or low-priority."
}

Allowed values:
- "category" must be one of: "urgent", "action-required", "fyi", "low-priority".
- "score" must be an integer from 1 to 10 (10 = most urgent).
- "gist" must be a concise 1-2 sentence summary.
- "draftReply" must be a suggested response if action is needed; use "" for FYI or low-priority.`;
}

function parseResponse(text: string): {
  category: RankedMessage["category"];
  score: number;
  gist: string;
  draftReply: string;
} {
  let cleaned = text.trim();

  // Remove leading/trailing markdown code fences only
  cleaned = cleaned.replace(/^```[a-z]*\s*\n?/i, "");
  cleaned = cleaned.replace(/```$/i, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: extract first JSON object from text
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last > first) {
      parsed = JSON.parse(cleaned.slice(first, last + 1));
    } else {
      throw new Error(`No valid JSON found in LLM response: ${cleaned.slice(0, 200)}`);
    }
  }

  // Validate
  if (!VALID_CATEGORIES.has(parsed.category)) {
    parsed.category = "fyi";
  }
  parsed.score = Math.max(1, Math.min(10, Math.round(Number(parsed.score) || 5)));
  parsed.gist = String(parsed.gist ?? "");
  parsed.draftReply = String(parsed.draftReply ?? "");

  return parsed;
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
      const rankedAt = new Date().toISOString();

      // Sign the full payload (excluding signature itself)
      const unsigned = {
        id,
        inbound,
        category: parsed.category,
        score: parsed.score,
        gist: parsed.gist,
        draftReply: parsed.draftReply,
        rankedAt,
      };
      const signature = sign(JSON.stringify(unsigned));

      const ranked: RankedMessage = { ...unsigned, signature };

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
