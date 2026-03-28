import "dotenv/config";
import { randomUUID } from "crypto";
import { connect, JSONCodec } from "nats";
import { createTransport, type Transporter } from "nodemailer";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { RankedMessage, ApprovedMessage, SentConfirmation } from "../shared/types.js";
import { sign } from "./signer.js";

const rankedCodec = JSONCodec<RankedMessage>();
const approvedCodec = JSONCodec<ApprovedMessage>();
const sentCodec = JSONCodec<SentConfirmation>();

// Cache ranked messages so we can look up the original inbound when approved
const rankedCache = new Map<string, RankedMessage>();

let emailTransport: Transporter | null = null;

function getEmailTransport(): Transporter {
  if (emailTransport) return emailTransport;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD required for email replies");
  }
  emailTransport = createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user, pass },
  });
  return emailTransport;
}

async function main() {
  console.log("[outbound] Connecting to NATS...");
  const nc = await connect({ servers: NATS_URL });
  console.log(`[outbound] NATS connected: ${NATS_URL}`);

  // Cache all ranked messages
  const rankedSub = nc.subscribe(SUBJECTS.RANKED);
  (async () => {
    for await (const msg of rankedSub) {
      try {
        const ranked = rankedCodec.decode(msg.data);
        rankedCache.set(ranked.id, ranked);
      } catch (err) {
        console.error("[outbound] Failed to cache ranked message:", err);
      }
    }
  })();

  // Process approved messages
  const approvedSub = nc.subscribe(SUBJECTS.APPROVED);
  console.log("[outbound] Subscribed to messages.approved — waiting...");

  for await (const msg of approvedSub) {
    try {
      const approved = approvedCodec.decode(msg.data);
      const ranked = rankedCache.get(approved.rankedMessageId);

      if (!ranked) {
        console.warn(
          `[outbound] No cached ranked message for ${approved.rankedMessageId} — skipping`
        );
        continue;
      }

      const channel = ranked.inbound.channel;
      const recipient = ranked.inbound.from;

      if (channel === "email") {
        const transport = getEmailTransport();
        await transport.sendMail({
          from: process.env.GMAIL_USER,
          to: recipient,
          subject: `Re: ${ranked.inbound.subject ?? "(no subject)"}`,
          text: approved.finalReply,
        });
        console.log(`[outbound] Sent email reply to ${recipient}`);
      } else if (channel === "slack") {
        console.log(
          `[outbound] Slack reply not yet implemented — would reply to ${recipient} in thread ${ranked.inbound.threadId}`
        );
        continue;
      } else {
        console.log(
          `[outbound] Channel "${channel}" reply not implemented — skipping`
        );
        continue;
      }

      // Only publish SentConfirmation after actual delivery
      const id = randomUUID();
      const unsigned = {
        id,
        approvedMessageId: approved.id,
        channel,
        sentAt: new Date().toISOString(),
      };
      const confirmation: SentConfirmation = {
        ...unsigned,
        signature: sign(JSON.stringify(unsigned)),
      };

      nc.publish(SUBJECTS.SENT, sentCodec.encode(confirmation));
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
