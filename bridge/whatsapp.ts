import "dotenv/config";
import express from "express";
import { connect, JSONCodec, type NatsConnection } from "nats";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { RankedMessage, ApprovedMessage } from "../shared/types.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.META_WHATSAPP_TOKEN!;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID!;
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "yhack2026";
const RECIPIENT_PHONE = process.env.RECIPIENT_PHONE!; // your phone number with country code

const jc = JSONCodec();
let nc: NatsConnection;

// store ranked messages by id so we can look them up when user taps buttons
const rankedMessages = new Map<string, RankedMessage>();

// ── Meta Webhook Verification ──────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── Incoming WhatsApp Messages (button taps, voice notes, text) ────────────
app.post("/webhook", async (req, res) => {
  const body = req.body;
  res.sendStatus(200); // always ack immediately

  const entry = body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const message = value?.messages?.[0];

  if (!message) return;

  const from = message.from; // sender phone number

  // handle interactive button replies
  if (message.type === "interactive") {
    const buttonId = message.interactive?.button_reply?.id;
    const listId = message.interactive?.list_reply?.id;
    const replyId = buttonId || listId;

    if (!replyId) return;

    // button ids are formatted as: action:messageId
    const [action, messageId] = replyId.split(":");
    const ranked = rankedMessages.get(messageId);

    if (!ranked) {
      await sendText(from, "Message not found. It may have expired.");
      return;
    }

    switch (action) {
      case "send":
        await handleApprove(ranked, from);
        break;
      case "details":
        await sendDetails(ranked, from);
        break;
      case "skip":
        await sendText(from, `Skipped. I'll remind you in 1 hour.`);
        break;
      case "send2": // send from details view
        await handleApprove(ranked, from);
        break;
      case "edit":
        await sendText(from, `Reply with your edits for: "${ranked.gist}"`);
        break;
      case "full":
        await sendFull(ranked, from);
        break;
    }
    return;
  }

  // handle voice notes
  if (message.type === "audio") {
    const audioId = message.audio?.id;
    if (audioId) {
      await handleVoiceNote(audioId, from);
    }
    return;
  }

  // handle text messages (edits, "what's new?", etc.)
  if (message.type === "text") {
    const text = message.text?.body?.toLowerCase().trim();
    if (text === "what's new?" || text === "whats new" || text === "status" || text === "digest") {
      await sendDigest(from);
    } else {
      // treat as an edit command — publish to NATS for agent to handle
      nc.publish(
        SUBJECTS.INBOUND_WHATSAPP,
        jc.encode({
          id: crypto.randomUUID(),
          channel: "whatsapp",
          from,
          body: message.text?.body,
          receivedAt: new Date().toISOString(),
        })
      );
    }
    return;
  }
});

// ── Send WhatsApp Interactive Button Message (Layer 1: Alert) ──────────────
async function sendAlert(ranked: RankedMessage, to: string) {
  const emoji =
    ranked.category === "urgent" ? "🔴" :
    ranked.category === "action-required" ? "🟡" : "🟢";

  await sendInteractiveButtons(to, {
    body: `${emoji} ${ranked.inbound.from}\n${ranked.inbound.subject || "(no subject)"}\n\n${ranked.gist}`,
    buttons: [
      { id: `send:${ranked.id}`, title: "✅ Send" },
      { id: `details:${ranked.id}`, title: "📋 Details" },
      { id: `skip:${ranked.id}`, title: "⏭ Skip" },
    ],
  });
}

// ── Send Details (Layer 2) ─────────────────────────────────────────────────
async function sendDetails(ranked: RankedMessage, to: string) {
  const lines = [
    `From: ${ranked.inbound.from}`,
    ranked.inbound.subject ? `Subject: ${ranked.inbound.subject}` : "",
    `Via: ${ranked.inbound.channel} │ ${new Date(ranked.inbound.receivedAt).toLocaleTimeString()}` +
      (ranked.inbound.threadDepth ? ` │ Thread: ${ranked.inbound.threadDepth}` : ""),
    "",
    `Gist: ${ranked.gist}`,
    "",
    `Draft: "${ranked.draftReply}"`,
  ].filter(Boolean).join("\n");

  await sendInteractiveButtons(to, {
    body: lines,
    buttons: [
      { id: `send2:${ranked.id}`, title: "✅ Send" },
      { id: `edit:${ranked.id}`, title: "✏️ Edit" },
      { id: `full:${ranked.id}`, title: "🔗 Full" },
    ],
  });
}

// ── Send Full Content (Layer 3) ────────────────────────────────────────────
async function sendFull(ranked: RankedMessage, to: string) {
  const body = ranked.inbound.body.length > 1500
    ? ranked.inbound.body.slice(0, 1500) + "\n\n[truncated]"
    : ranked.inbound.body;

  await sendText(to, body);
}

// ── Send Digest ────────────────────────────────────────────────────────────
async function sendDigest(to: string) {
  const all = Array.from(rankedMessages.values());
  const urgent = all.filter((m) => m.category === "urgent").length;
  const action = all.filter((m) => m.category === "action-required").length;
  const fyi = all.filter((m) => m.category === "fyi" || m.category === "low-priority").length;

  const actionItems = all
    .filter((m) => m.category === "urgent" || m.category === "action-required")
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (actionItems.length === 0) {
    await sendText(to, `📊 All clear. ${fyi} FYI messages, nothing needs action.`);
    return;
  }

  const listItems = actionItems.map((m, i) => ({
    id: `details:${m.id}`,
    title: `${i + 1}. ${m.inbound.from}`.slice(0, 24),
    description: m.gist.slice(0, 72),
  }));

  await sendInteractiveList(to, {
    body: `📊 ${urgent} urgent │ ${action} action needed │ ${fyi} FYI`,
    buttonText: "View Items",
    sections: [{ title: "Action Items", rows: listItems }],
  });
}

// ── Handle Approve ─────────────────────────────────────────────────────────
async function handleApprove(ranked: RankedMessage, from: string) {
  const approved: ApprovedMessage = {
    id: crypto.randomUUID(),
    rankedMessageId: ranked.id,
    finalReply: ranked.draftReply,
    approvedVia: "button",
    approvedAt: new Date().toISOString(),
    signature: "", // agent/signer.ts will sign
  };

  nc.publish(SUBJECTS.APPROVED, jc.encode(approved));
  rankedMessages.delete(ranked.id);

  await sendText(from, `✅ Sent to ${ranked.inbound.from} via ${ranked.inbound.channel}.`);
}

// ── Handle Voice Note ──────────────────────────────────────────────────────
async function handleVoiceNote(audioId: string, from: string) {
  // step 1: get audio URL from Meta
  const mediaRes = await fetch(`https://graph.facebook.com/v21.0/${audioId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  const mediaJson = (await mediaRes.json()) as { url?: string };
  if (!mediaJson.url) return;

  // step 2: download audio
  const audioRes = await fetch(mediaJson.url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

  // step 3: transcribe with Groq Whisper
  const transcript = await transcribeWithGroq(audioBuffer);
  if (!transcript) {
    await sendText(from, "Couldn't transcribe voice note. Try again or type your message.");
    return;
  }

  await sendText(from, `🎤 "${transcript}"`);

  // publish as inbound whatsapp message for the agent to handle
  nc.publish(
    SUBJECTS.INBOUND_WHATSAPP,
    jc.encode({
      id: crypto.randomUUID(),
      channel: "whatsapp",
      from,
      body: transcript,
      receivedAt: new Date().toISOString(),
    })
  );
}

// ── Groq Whisper Transcription ─────────────────────────────────────────────
async function transcribeWithGroq(audioBuffer: Buffer): Promise<string | null> {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return null;

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "audio.ogg");
  formData.append("model", "whisper-large-v3");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: formData,
  });

  const json = (await res.json()) as { text?: string };
  return json.text || null;
}

// ── Meta Cloud API Helpers ─────────────────────────────────────────────────
async function sendText(to: string, body: string) {
  await callWhatsAppAPI({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

async function sendInteractiveButtons(
  to: string,
  opts: { body: string; buttons: { id: string; title: string }[] }
) {
  await callWhatsAppAPI({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: opts.body },
      action: {
        buttons: opts.buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

async function sendInteractiveList(
  to: string,
  opts: {
    body: string;
    buttonText: string;
    sections: { title: string; rows: { id: string; title: string; description: string }[] }[];
  }
) {
  await callWhatsAppAPI({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: opts.body },
      action: {
        button: opts.buttonText,
        sections: opts.sections,
      },
    },
  });
}

async function callWhatsAppAPI(payload: unknown) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("whatsapp api error:", res.status, err);
  }
}

// ── NATS: Subscribe to ranked messages and send WhatsApp alerts ────────────
async function subscribeToRanked() {
  const sub = nc.subscribe(SUBJECTS.RANKED);
  console.log(`subscribed to ${SUBJECTS.RANKED}`);

  for await (const msg of sub) {
    const ranked = jc.decode(msg.data) as RankedMessage;
    rankedMessages.set(ranked.id, ranked);

    // only alert for urgent and action-required
    if (ranked.category === "urgent" || ranked.category === "action-required") {
      await sendAlert(ranked, RECIPIENT_PHONE);
    }
  }
}

// ── NATS: Subscribe to sent confirmations ──────────────────────────────────
async function subscribeToSent() {
  const sub = nc.subscribe(SUBJECTS.SENT);
  for await (const msg of sub) {
    const sent = jc.decode(msg.data) as { approvedMessageId: string; channel: string };
    console.log(`confirmed sent via ${sent.channel}: ${sent.approvedMessageId}`);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────
async function main() {
  // connect to NATS
  nc = await connect({ servers: NATS_URL });
  console.log(`connected to nats at ${NATS_URL}`);

  // start NATS subscriptions
  subscribeToRanked();
  subscribeToSent();

  // start express server
  app.listen(PORT, () => {
    console.log(`whatsapp bridge listening on port ${PORT}`);
    console.log(`webhook url: https://<your-railway-url>/webhook`);
  });
}

main().catch(console.error);
