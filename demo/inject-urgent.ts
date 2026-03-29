import "dotenv/config";
import { randomUUID } from "crypto";
import { connect, JSONCodec } from "nats";
import { SUBJECTS, NATS_URL } from "../shared/nats.js";
import type { InboundMessage } from "../shared/types.js";

const jc = JSONCodec<InboundMessage>();

async function main() {
  const nc = await connect({ servers: NATS_URL });
  console.log(`[inject-urgent] NATS connected: ${NATS_URL}`);

  const msg: InboundMessage = {
    id: randomUUID(),
    channel: "email",
    from: "gillian.lockwood@lacima-group.com",
    subject: "URGENT: Policy renewal deadline TOMORROW — need your sign-off",
    body: `Hi,

I've been trying to reach you all week. The renewal deadline for the Meridian Group commercial liability policy (Policy #CLG-2024-8847) is TOMORROW at 5pm EST.

The premium increased 18% due to their two recent claims. I've negotiated it down to 12% but I need your written approval to bind the renewal at the new rate.

If we miss this deadline, Meridian loses coverage and we lose the account — they're a $340K annual premium client.

Please reply ASAP or call me at 917-555-0142.

Thanks,
Gillian Lockwood
Senior Account Manager, Lacima Group`,
    receivedAt: new Date().toISOString(),
  };

  nc.publish(SUBJECTS.INBOUND_EMAIL, jc.encode(msg));
  console.log(`[inject-urgent] Published: ${msg.subject}`);
  console.log(`[inject-urgent] Message ID: ${msg.id}`);

  await nc.drain();
  console.log("[inject-urgent] Done — should appear on dashboard + WhatsApp in a few seconds.");
}

main().catch((err) => {
  console.error("[inject-urgent] Fatal:", err);
  process.exit(1);
});
