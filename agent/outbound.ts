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

        // Determine the Slack channel/conversation to post to
        // replyTo should be a Slack channel ID (C...) or DM ID (D...) — prefer it
        // Fall back: if replyTo looks like a display name (not C/D/U prefix), try to find the channel
        let slackChannel = rankedMsg.inbound.replyTo;
        if (!slackChannel || !/^[CDGU][A-Z0-9]+$/.test(slackChannel)) {
          // replyTo is missing or is a display name — try threadId's channel or skip
          console.warn(`[outbound] Slack replyTo is invalid: "${slackChannel}" for message ${rankedMsg.id}`);
          // Last resort: try opening a DM with the from field if it looks like a user ID
          if (rankedMsg.inbound.from && /^U[A-Z0-9]+$/.test(rankedMsg.inbound.from)) {
            slackChannel = rankedMsg.inbound.from;
          } else {
            console.error(`[outbound] Cannot determine Slack channel — skipping`);
            continue;
          }
        }

        const threadId = rankedMsg.inbound.threadId;
        try {
          await slack.chat.postMessage({
            channel: slackChannel,
            text: approved.finalReply,
            ...(threadId ? { thread_ts: threadId } : {}),
          });
          console.log(`[outbound] Sent Slack reply to ${slackChannel}${threadId ? ` (thread: ${threadId})` : ""}`);
        } catch (slackErr: any) {
          // If channel_not_found with a user ID, try opening a DM conversation first
          if (slackErr?.data?.error === "channel_not_found" && slackChannel.startsWith("U")) {
            try {
              const dm = await slack.conversations.open({ users: slackChannel });
              if (dm.channel?.id) {
                await slack.chat.postMessage({ channel: dm.channel.id, text: approved.finalReply });
                console.log(`[outbound] Sent Slack DM to ${slackChannel} via ${dm.channel.id}`);
              } else {
                console.error(`[outbound] Slack DM fallback returned no channel id for ${slackChannel} — skipping`);
                continue;
              }
            } catch (dmErr) {
              console.error(`[outbound] Slack DM fallback failed:`, dmErr);
              continue;
            }
          } else {
            throw slackErr;
          }
        }
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
