# CLAUDE.md — Shared Contracts for YHack Agent

This file is read by every Claude Code session working on this repo. Follow these contracts exactly.

## Project Overview

WhatsApp-first enterprise AI agent. Silently ingests email + Slack, categorizes/ranks, surfaces only what matters via WhatsApp interactive buttons. Human approves with tap or voice. Every action Ed25519 signed.

## Architecture

- **Raspberry Pi** runs: OpenFang, NATS server, SQLite, email adapter, Slack adapter
- **Railway** runs: WhatsApp bridge only (needs public URL for Meta webhook)
- **NATS** connects everything via pub/sub with wildcard subscriptions

## NATS Subjects — Use These Exactly

```
messages.inbound.email      ← email adapter publishes here
messages.inbound.slack      ← slack adapter publishes here
messages.inbound.whatsapp   ← whatsapp bridge publishes here
messages.inbound.*          ← agent subscribes to this wildcard

messages.ranked             ← agent publishes after categorization
messages.approved           ← whatsapp bridge publishes when user approves
messages.sent               ← agent publishes after sending reply
messages.audit              ← signed audit records
```

## Message Schemas — All Components Must Use These

All messages are JSON. Import types from `shared/types.ts`.

```typescript
interface InboundMessage {
  id: string;                    // crypto.randomUUID()
  channel: "email" | "slack" | "whatsapp";
  from: string;
  subject?: string;
  body: string;
  attachments?: string[];
  threadId?: string;
  threadDepth?: number;
  receivedAt: string;            // new Date().toISOString()
}

interface RankedMessage {
  id: string;
  inbound: InboundMessage;
  category: "urgent" | "action-required" | "fyi" | "low-priority";
  score: number;                 // 1-10
  gist: string;
  draftReply: string;
  signature: string;             // Ed25519 hex
  rankedAt: string;
}

interface ApprovedMessage {
  id: string;
  rankedMessageId: string;
  finalReply: string;
  approvedVia: "button" | "voice" | "text";
  approvedAt: string;
  signature: string;
}

interface SentConfirmation {
  id: string;
  approvedMessageId: string;
  channel: string;
  sentAt: string;
  signature: string;
}
```

## Directory Ownership

```
agent/     ← Dell XPS develops, runs on Pi (categorizer, outbound, signer)
bridge/    ← Dell XPS develops, runs on Railway (WhatsApp webhook + NATS)
adapters/  ← MacBook Air develops, runs on Pi (email IMAP, Slack bot)
shared/    ← Shared types and NATS helpers — BOTH machines can edit
infra/     ← Docker compose, NATS config, Railway config
demo/      ← Seed data, pitch notes
```

## Conventions

- **Language:** TypeScript everywhere
- **Runtime:** Node.js 20+
- **Package manager:** npm workspaces
- **NATS client:** `nats` npm package (official)
- **WhatsApp:** `whatsapp-business-platform-sdk` or direct HTTP to Meta Cloud API
- **LLM calls:** Use Groq for speed (live demo), Gemini 2.5 Flash for quality. Fall back gracefully.
- **Environment variables:** Never hardcode API keys. Use `.env` files (gitignored).
  ```
  GEMINI_API_KEY=
  GROQ_API_KEY=
  META_WHATSAPP_TOKEN=
  META_PHONE_NUMBER_ID=
  META_VERIFY_TOKEN=
  GMAIL_USER=
  GMAIL_APP_PASSWORD=
  SLACK_BOT_TOKEN=
  SLACK_APP_TOKEN=
  NATS_URL=
  ```
- **Ed25519 signing:** Use Node.js `crypto.sign` with Ed25519. Key pair generated once, stored in `.env`.
- **Error handling:** Log and continue. Never crash the process on a single message failure.
- **Git:** Commit often. Small commits. Don't break main.

## What NOT To Do

- Do not build a dashboard or web UI. WhatsApp IS the UI.
- Do not use MongoDB — we use SQLite on the Pi for simplicity.
- Do not install heavy dependencies. The Pi has limited resources.
- Do not hardcode NATS subjects — import from `shared/nats.ts`.
- Do not send WhatsApp messages for FYI or low-priority items. Only urgent and action-required.
