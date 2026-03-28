import "dotenv/config";
import { randomUUID } from "crypto";
import { connect, JSONCodec } from "nats";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { InboundMessage, RankedMessage } from "../shared/types.js";
import { sign } from "./signer.js";

const inboundCodec = JSONCodec<InboundMessage>();
const rankedCodec = JSONCodec<RankedMessage>();

const PROMPT = `You are an email triage assistant for a busy insurance broker. Categorize this message and draft a reply.

Respond with ONLY valid JSON (no markdown fences, no extra text):
{
  "category": "urgent" | "action-required" | "fyi" | "low-priority",
  "score": <number 1-10, 10 = most urgent>,
  "gist": "<1-2 sentence summary>",
  "draftReply": "<suggested response if action needed, empty string if fyi/low-priority>"
}

Category rules:
- urgent: deadlines within 24hrs, compliance issues, client emergencies
- action-required: needs response within 2-3 days, quote requests, follow-ups
- fyi: newsletters, status updates, no response needed
- low-priority: spam, marketing, can wait indefinitely`;

function buildUserMessage(msg: InboundMessage): string {
  return `From: ${msg.from}\nSubject: ${msg.subject ?? "(no subject)"}\nBody: ${msg.body}`;
}

function parseResponse(text: string): {
  category: RankedMessage["category"];
  score: number;
  gist: string;
  draftReply: string;
} {
  const cleaned = text.replace(/```json?\s*/gi, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

// ── LLM Providers ──────────────────────────────────────────────────────────

async function callGroq(userMessage: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`groq ${res.status}: ${await res.text()}`);
  return ((await res.json()) as any).choices[0].message.content;
}

async function callGemini(userMessage: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    }
  );
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  return ((await res.json()) as any).candidates[0].content.parts[0].text;
}

async function callLava(userMessage: string): Promise<string> {
  const auth = Buffer.from(
    JSON.stringify({ secret_key: process.env.LAVA_SPEND_KEY, customer_id: "yhack-agent" })
  ).toString("base64");
  const res = await fetch("https://api.lava.so/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`lava ${res.status}: ${await res.text()}`);
  return ((await res.json()) as any).choices[0].message.content;
}

// ── Fallback Chain ─────────────────────────────────────────────────────────

const providers = [
  { name: "groq", fn: callGroq, key: "GROQ_API_KEY" },
  { name: "gemini", fn: callGemini, key: "GEMINI_API_KEY" },
  { name: "lava", fn: callLava, key: "LAVA_SPEND_KEY" },
];

async function categorize(userMessage: string) {
  const available = providers.filter((p) => !!process.env[p.key]);

  for (const provider of available) {
    try {
      console.log(`[categorizer] trying ${provider.name}...`);
      const raw = await provider.fn(userMessage);
      const parsed = parseResponse(raw);
      console.log(`[categorizer] ${provider.name} succeeded`);
      return parsed;
    } catch (err: any) {
      console.error(`[categorizer] ${provider.name} failed: ${err.message?.slice(0, 120)}`);
    }
  }

  console.error("[categorizer] all providers failed — returning fallback");
  return { category: "fyi" as const, score: 3, gist: "Could not categorize — review manually", draftReply: "" };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const nc = await connect({ servers: NATS_URL });
  console.log(`[categorizer] NATS connected: ${NATS_URL}`);

  const available = providers.filter((p) => !!process.env[p.key]).map((p) => p.name);
  console.log(`[categorizer] LLM fallback chain: ${available.join(" → ") || "NONE — set API keys!"}`);

  const sub = nc.subscribe(SUBJECTS.INBOUND_ALL);
  console.log("[categorizer] Subscribed to messages.inbound.* — waiting...");

  for await (const msg of sub) {
    try {
      const inbound = inboundCodec.decode(msg.data);
      console.log(`[categorizer] Processing: ${inbound.from} — ${inbound.subject ?? "(no subject)"}`);

      const parsed = await categorize(buildUserMessage(inbound));

      const id = randomUUID();
      const ranked: RankedMessage = {
        id,
        inbound,
        category: parsed.category,
        score: parsed.score,
        gist: parsed.gist,
        draftReply: parsed.draftReply,
        signature: sign(JSON.stringify({ id, category: parsed.category, score: parsed.score, gist: parsed.gist })),
        rankedAt: new Date().toISOString(),
      };

      nc.publish(SUBJECTS.RANKED, rankedCodec.encode(ranked));
      const emoji = ranked.category === "urgent" ? "🔴" : ranked.category === "action-required" ? "🟡" : ranked.category === "fyi" ? "🟢" : "⚪";
      console.log(`[categorizer] ${emoji} ${ranked.category} (${ranked.score}/10): ${ranked.gist}`);
    } catch (err) {
      console.error("[categorizer] Error:", err);
    }
  }
}

main().catch((err) => {
  console.error("[categorizer] Fatal:", err);
  process.exit(1);
});
