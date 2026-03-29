export interface InboundMessage {
  id: string;
  channel: "email" | "slack" | "whatsapp";
  from: string;
  replyTo?: string; // raw address for outbound (e.g. Slack user ID, email address)
  subject?: string;
  body: string;
  attachments?: string[];
  threadId?: string;
  threadDepth?: number;
  receivedAt: string;
}

export interface RankedMessage {
  id: string;
  inbound: InboundMessage;
  category: "urgent" | "action-required" | "fyi" | "low-priority";
  score: number;
  gist: string;
  draftReply: string;
  signature: string;
  rankedAt: string;
}

export interface ApprovedMessage {
  id: string;
  rankedMessageId: string;
  finalReply: string;
  approvedVia: "button" | "voice" | "text";
  approvedAt: string;
  signature: string;
}

export interface SentConfirmation {
  id: string;
  approvedMessageId: string;
  channel: string;
  sentAt: string;
  signature: string;
}
