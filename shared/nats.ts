export const SUBJECTS = {
  INBOUND_ALL: "messages.inbound.*",
  INBOUND_EMAIL: "messages.inbound.email",
  INBOUND_SLACK: "messages.inbound.slack",
  INBOUND_WHATSAPP: "messages.inbound.whatsapp",
  RANKED: "messages.ranked",
  APPROVED: "messages.approved",
  SENT: "messages.sent",
  AUDIT: "messages.audit",
} as const;

export const NATS_URL = process.env.NATS_URL || "nats://localhost:4222";
