import "dotenv/config";
import { randomUUID } from "crypto";
import { connect, JSONCodec } from "nats";
import { createTransport, type Transporter } from "nodemailer";
import { WebClient } from "@slack/web-api";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { RankedMessage, ApprovedMessage, SentConfirmation } from "../shared/types.js";
import { sign } from "./signer.js";
import { getDb, rankedCol, sentCol } from "../shared/db.js";

const approvedCodec = JSONCodec<ApprovedMessage>();
const sentCodec = JSONCodec<SentConfirmation>();

let emailTransport: Transporter | null = null;
let slackClient: WebClient | null = null;

function getSlackClient(): WebClient | null {
  if (slackClient) return slackClient;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  slackClient = new WebClient(token);
  return slackClient;
}

function getEmailTransport(): Transporter {
  if (emailTransport) return emailTransport;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD required");
  emailTransport = createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user, pass },
  });
  return emailTransport;
}

async function main() {
  await getDb();
  const nc = await connect({ servers: NATS_URL });
  console.log(`[outbound] NATS connected: ${NATS_URL}`);

  const ranked = await rankedCol();
  const sent = await sentCol();

  const approvedSub = nc.subscribe(SUBJECTS.APPROVED);
  console.log("[outbound] Subscribed to messages.approved — waiting...");

  for await (const msg of approvedSub) {
    try {
      const approved = approvedCodec.decode(msg.data);

      // Look up from MongoDB instead of in-memory cache
      const rankedMsg = await ranked.findOne({ id: approved.rankedMessageId }) as RankedMessage | null;

      if (!rankedMsg) {
        console.warn(`[outbound] No ranked message for ${approved.rankedMessageId} — skipping`);
        continue;
      }

      const channel = rankedMsg.inbound.channel;
      const recipient = rankedMsg.inbound.replyTo || rankedMsg.inbound.from;

      // SAFETY: always send to ourselves in demo mode
      const DEMO_MODE = process.env.DEMO_MODE !== "false";
      const safeTo = DEMO_MODE ? process.env.GMAIL_USER! : recipient;

      if (channel === "email") {
        const transport = getEmailTransport();
        await transport.sendMail({
          from: process.env.GMAIL_USER,
          to: safeTo,
          subject: `Re: ${rankedMsg.inbound.subject ?? "(no subject)"}`,
          text: `[Reply to: ${recipient}]\n\n${approved.finalReply}`,
        });
        console.log(`[outbound] Sent email to ${safeTo}${DEMO_MODE ? ` (demo — original: ${recipient})` : ""}`);
      } else if (channel === "slack") {
        const slack = getSlackClient();
        if (!slack) {
          console.warn("[outbound] No SLACK_BOT_TOKEN — cannot send Slack reply");
          continue;
        }
        const threadId = rankedMsg.inbound.threadId;
        // Reply to the Slack conversation, optionally in the original thread
        await slack.chat.postMessage({
          channel: recipient, // Slack channel/conversation ID from replyTo field
          text: approved.finalReply,
          ...(threadId ? { thread_ts: threadId } : {}),
        });
        console.log(`[outbound] Sent Slack reply to ${recipient}${threadId ? ` (thread: ${threadId})` : ""}`);
      } else {
        console.log(`[outbound] Channel "${channel}" not implemented — skipping`);
        continue;
      }

      const id = randomUUID();
      const unsigned = { id, approvedMessageId: approved.id, channel, sentAt: new Date().toISOString() };
      const confirmation: SentConfirmation = { ...unsigned, signature: sign(JSON.stringify(unsigned)) };

      nc.publish(SUBJECTS.SENT, sentCodec.encode(confirmation));
      await sent.insertOne(confirmation as any).catch(() => {});
      console.log(`[outbound] Confirmation published for ${approved.id}`);
    } catch (err) {
      console.error("[outbound] Failed to process approval:", err);
    }
  }
}

main().catch((err) => {
  console.error("[outbound] Fatal:", err);
  process.exit(1);
});
