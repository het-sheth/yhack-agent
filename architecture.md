# YHack 2026 — Enterprise AI Agent via WhatsApp

## Context

Het is solo hacking at YHack 2026 (March 28-29, Yale). Targeting Harper's "Personal AI Agents in Enterprises" track. The insight: enterprise workers don't want another dashboard — they want an AI agent that lives in a messaging app they already use, silently reads all their business communications, and only interrupts when it matters. Human approves with a tap, every action is cryptographically signed.

---

## Architecture

```
  Raspberry Pi (on the table)              Railway (cloud)
  ============================             ==================

  Gmail (IMAP) ──► NATS pub ─┐
                              │
  Slack (Bot)  ──► NATS pub ─┤
                              │
                    NATS Server ◄────────► WhatsApp Bridge
                    (JetStream)            (Node.js)
                              │            - Meta Cloud API webhook
                    messages.inbound.*     - Interactive buttons
                              │            - Voice note handling
                              ▼            - Public URL for Meta callback
                    OpenFang Agent
                    - Categorize
                    - Score 1-10
                    - Draft response
                    - Ed25519 sign
                              │
                    messages.ranked
                              │
                              ▼
                    ──► NATS ──► WhatsApp Bridge ──► User's WhatsApp
                                 sends alert with
                                 [Send] [Details] [Skip]

                    User taps / voice note
                              │
                    messages.approved
                              │
                    Agent sends reply via
                    original channel (SMTP/Slack)
                              │
                    Ed25519 signed receipt
                    stored in SQLite
```

**Key principle: The agent's job is to NOT show you things.** 50 messages come in → agent surfaces 2 that matter. The value is the 48 context switches you didn't make.

---

## Infrastructure — Raspberry Pi + Railway Split

```
Raspberry Pi (physical, on judging table)
├── OpenFang       (Agent OS, 32MB binary, 40MB idle RAM)
├── NATS Server    (Message bus, 20MB, <2% CPU idle on Pi)
├── SQLite         (Audit trail + message store, zero config)
├── Email adapter  (IMAP poll → NATS publish)
└── Slack adapter  (Socket Mode → NATS publish)

Railway ($0 — free $5 trial, barely touched)
└── WhatsApp Bridge  (Node.js webhook — needs public URL for Meta callback)
```

**Why this split:**
- Pi does the real work — judges see a physical device, not just a terminal
- "This entire enterprise agent runs on a $35 Raspberry Pi" is a killer demo line
- Railway credits barely used — only a tiny Node.js bridge, not 4 containers
- NATS on Pi is proven: 2% CPU idle, 25-35% under load, handles 100MBps on Pi4
- Failure isolation: Pi crash ≠ WhatsApp bridge crash and vice versa
- SQLite instead of MongoDB — zero config, single file, more than enough for <100 demo messages

**Pi connects via hackathon WiFi (YaleGuest) to:**
- Gmail IMAP (polling inbox)
- Slack API (Socket Mode WebSocket)
- Gemini / Groq APIs (LLM calls)
- Railway WhatsApp bridge (NATS over WebSocket or direct TCP)

---

## NATS Subjects

```
messages.inbound.email      ← Gmail IMAP adapter publishes (runs on Pi)
messages.inbound.slack      ← Slack bot adapter publishes (runs on Pi)
messages.inbound.whatsapp   ← WhatsApp bridge publishes (runs on Railway)
messages.inbound.*          ← Agent subscribes with wildcard — all channels, one subscription

messages.ranked             ← Agent publishes after categorization + scoring
messages.approved           ← WhatsApp bridge publishes when user taps [Send]
messages.sent               ← Agent publishes after outbound delivery
messages.audit              ← Ed25519 signed records for every state transition
```

**Why NATS:** Adding a new channel = one new 10-line publisher to `messages.inbound.{newchannel}`. Agent code never changes. This is the "wow" demo moment — send a WhatsApp message live in front of judges, agent picks it up instantly via wildcard.

**JetStream persistence:** Messages survive crashes. If agent restarts, it replays missed messages.

**NATS connects Pi ↔ Railway:** Railway WhatsApp bridge connects to NATS on the Pi. Options:
1. NATS leaf node over WebSocket (Pi exposes NATS via WebSocket, Railway bridge connects)
2. Railway bridge connects to Pi's public NATS port (requires Pi to have a known IP or tunnel)
3. Simplest: Run a NATS instance on Railway too, connect via NATS gateway/leaf node

**Recommended: Run NATS on Railway alongside the bridge, connect to Pi NATS as a leaf node.** This way the bridge publishes locally and messages sync to Pi automatically. Still barely uses Railway credits.

---

## WhatsApp UX — Progressive Disclosure

### Layer 1: Alert (unprompted, only for urgent/action-required)
```
┌─────────────────────────────────────┐
│ 🔴 John Chen — COI for 42 Main St  │
│ Needs cert by EOD (2nd follow-up)   │
│                                     │
│ [✅ Send]  [📋 Details]  [⏭ Skip] │
└─────────────────────────────────────┘
```

### Layer 2: Details (tap "Details")
```
┌─────────────────────────────────────┐
│ From: john.chen@acmecorp.com        │
│ Subject: RE: COI for 42 Main St    │
│ Via: Email │ 10:23 AM │ Thread: 3   │
│                                     │
│ Gist: Following up 2nd time since   │
│ Monday. Contractor starts Thursday. │
│ Needs cert for commercial property. │
│                                     │
│ Draft: "Hi John, pulling the cert   │
│ now. You'll have it within the      │
│ hour. Apologies for the delay."     │
│                                     │
│ [✅ Send] [✏️ Edit] [🔗 Full]     │
└─────────────────────────────────────┘
```

### Layer 3: Full content (tap "Full")
```
┌─────────────────────────────────────┐
│ Full email body pasted              │
│ — or —                              │
│ 📎 Attachment: AcmeCorp_Quote.pdf   │
│ Summary: $2M limit, $12,400/yr      │
│ View: railway-app.com/msg/a3f8x     │
│ (expires 24hr)                      │
└─────────────────────────────────────┘
```

### Digest (user sends "what's new?" or voice note)
```
┌─────────────────────────────────────┐
│ 📊 Since last check (2 hrs ago):   │
│                                     │
│ 🔴 0 urgent                        │
│ 🟡 3 need action                   │
│ 🟢 12 FYI — no action needed       │
│                                     │
│ [View Action Items ▼]              │
│ ┌─────────────────────────────────┐ │
│ │ 1. Acme renewal — expires Fri   │ │
│ │ 2. Sarah — policy #482 question │ │
│ │ 3. Carrier — claim #7293 update │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Voice Flow
```
User: [voice note] "anything urgent?"
       → Groq Whisper transcribes → Agent checks ranked queue
       → "Nothing urgent. 3 action items — biggest is Acme renewal expiring Friday."

User: [voice note] "edit the Acme reply to say we'll have the renewal by Wednesday"
       → Groq Whisper transcribes → Agent edits draft → Shows confirmation
       → [✅ Send] [✏️ Edit More]
```

---

## Tech Stack

| Component | Tech | Where | Why |
|-----------|------|-------|-----|
| Agent runtime | OpenFang | Pi | 32MB binary, Ed25519 signing, WASM sandbox |
| Message bus | NATS + JetStream | Pi + Railway leaf | Wildcard routing, persistence, extensibility |
| WhatsApp | Meta Cloud API | Railway | Free test number, interactive buttons, needs public URL |
| Email | IMAP adapter (Node.js) | Pi | Polls throwaway Gmail |
| Slack | Socket Mode adapter | Pi | WebSocket, no public URL needed |
| LLM (speed) | Groq — Llama 3.3 70B | API | 700 tok/sec, free, demo looks instant |
| LLM (quality) | Gemini 2.5 Flash | API | Free, 1M context, categorization + drafting |
| Voice STT | Groq Whisper | API | Free, fast transcription |
| Audit store | SQLite | Pi | Zero config, single file, Ed25519 signed records |
| Backend glue | TypeScript / Node.js | Both | Same language everywhere, good NATS + WhatsApp SDK |
| Hardware | Raspberry Pi (MLH) | Table | Physical demo, edge computing narrative |

---

## Machine Split — Dell XPS + MacBook Air + Raspberry Pi

### Dell XPS (primary dev machine)
- Claude Code session 1
- WhatsApp bridge development (Railway-deployed)
- Agent logic: categorization, scoring, drafting, Ed25519 signing
- NATS subject design + testing
- Railway deployment

### MacBook Air (secondary dev machine)
- Claude Code session 2
- Email IMAP adapter
- Slack bot adapter
- Demo data: seed emails + Slack messages
- During demo: shows Slack/email to prove outbound messages actually sent

### Raspberry Pi (runtime)
- Runs OpenFang + NATS + SQLite
- Receives code from Dell XPS via git pull or scp
- Sits on judging table — physical, tangible

### Repo Structure
```
yhack-agent/
├── CLAUDE.md              ← Shared contracts for all Claude Code sessions
├── README.md              ← Project overview + architecture for judges/Devpost
├── architecture.md        ← Detailed diagrams, NATS subjects, message schemas
├── package.json           ← Root workspace (npm workspaces)
├── agent/                 ← Dell XPS develops, runs on Pi
│   ├── categorizer.ts     ← Subscribe messages.inbound.*, categorize, score, draft
│   ├── outbound.ts        ← Subscribe messages.approved, send via SMTP/Slack
│   ├── signer.ts          ← Ed25519 signing of audit records
│   └── agent.toml         ← OpenFang agent config
├── bridge/                ← Dell XPS develops, runs on Railway
│   ├── whatsapp.ts        ← Meta Cloud API webhook, interactive messages, NATS pub/sub
│   ├── voice.ts           ← Groq Whisper transcription for voice notes
│   └── Dockerfile         ← For Railway deployment
├── adapters/              ← MacBook Air develops, runs on Pi
│   ├── email.ts           ← IMAP poll → NATS publish
│   └── slack.ts           ← Slack Socket Mode → NATS publish
├── shared/                ← Shared types and utilities
│   ├── types.ts           ← InboundMessage, RankedMessage, ApprovedMessage interfaces
│   └── nats.ts            ← NATS connection helper, subject constants
├── infra/
│   ├── docker-compose.yml ← Pi: OpenFang + NATS (local dev/deploy)
│   ├── nats.conf          ← NATS config with JetStream enabled
│   └── railway.toml       ← Railway config for WhatsApp bridge
└── demo/                  ← MacBook Air develops
    ├── seed-emails/       ← Realistic insurance email content
    ├── seed-slack/        ← Realistic Slack messages
    └── pitch.md           ← Pitch deck outline + demo script
```

---

## Message Schema (Shared Contract)

```typescript
// shared/types.ts — Every component reads/writes these through NATS

interface InboundMessage {
  id: string;                    // uuid
  channel: "email" | "slack" | "whatsapp";
  from: string;                  // sender identifier
  subject?: string;              // email subject or slack channel
  body: string;                  // message content
  attachments?: string[];        // URLs or references
  threadId?: string;             // conversation thread
  threadDepth?: number;          // how many messages in thread
  receivedAt: string;            // ISO timestamp
}

interface RankedMessage {
  id: string;
  inbound: InboundMessage;
  category: "urgent" | "action-required" | "fyi" | "low-priority";
  score: number;                 // 1-10
  gist: string;                  // 1-2 sentence summary
  draftReply: string;            // suggested response
  signature: string;             // Ed25519 signature of this record
  rankedAt: string;
}

interface ApprovedMessage {
  id: string;
  rankedMessageId: string;
  finalReply: string;            // approved (possibly edited) response
  approvedVia: "button" | "voice" | "text";
  approvedAt: string;
  signature: string;             // Ed25519 signature
}

interface SentConfirmation {
  id: string;
  approvedMessageId: string;
  channel: string;               // which channel it was sent through
  sentAt: string;
  signature: string;
}

// shared/nats.ts — Subject constants
const SUBJECTS = {
  INBOUND_ALL: "messages.inbound.*",
  INBOUND_EMAIL: "messages.inbound.email",
  INBOUND_SLACK: "messages.inbound.slack",
  INBOUND_WHATSAPP: "messages.inbound.whatsapp",
  RANKED: "messages.ranked",
  APPROVED: "messages.approved",
  SENT: "messages.sent",
  AUDIT: "messages.audit",
} as const;
```

---

## Security Story

| Feature | Source | Judge Pitch |
|---------|--------|------------|
| Ed25519 audit signatures | OpenFang + custom signer.ts | Every categorization + approval is signed. Tamper-proof. |
| WASM sandbox | OpenFang built-in | Agent code can't escape its boundary |
| Merkle hash-chain | OpenFang built-in | Immutable audit log — regulators verify nothing altered |
| Channel isolation | Throwaway Gmail + scoped Slack bot + WhatsApp test number | Zero blast radius |
| NATS NKeys | NATS auth layer | Ed25519 client-to-broker authentication |
| Progressive disclosure | WhatsApp UX | Human sees minimum context needed |
| Edge computing | Raspberry Pi | Data processed on-prem, not in cloud. Insurance companies care. |

---

## Track Submissions (7+)

| Track | Prize | What To Highlight |
|-------|-------|-------------------|
| **Personal AI Agent (Harper)** | $2000 + Quest 3 + interview | Primary. WhatsApp-first, human-in-the-loop, insurance demo |
| **Grand Prize** | $4000 | Auto-eligible |
| **Gemini** | TBD | Gemini 2.5 Flash as categorization + drafting LLM |
| **Lava API** | $1000 + $500 MCP bonus | Lava gateway as LLM router (add in ~1hr) |
| **MongoDB** | TBD | Swap SQLite for Mongo if time allows, or mention as production path |
| **Best UI/UX** | $100 | Progressive disclosure in WhatsApp — no dashboard needed |
| **K2 Think V2** | reMarkable tablets | Reasoning model for complex multi-step triage |
| **ElevenLabs** | TBD | Voice readback of summaries (add in ~20min) |

---

## Timeline (24 hrs, solo)

### Saturday 11am-3pm — Core Plumbing (4 hrs)
- [ ] Set up Pi: install OpenFang (`curl -fsSL https://openfang.sh/install | sh`)
- [ ] Install NATS on Pi (`snap install nats` or binary download)
- [ ] Verify NATS pub/sub works from Node.js on Pi
- [ ] Deploy WhatsApp bridge skeleton to Railway, get public URL
- [ ] Register Meta Cloud API webhook pointing to Railway URL
- [ ] Verify: Pi NATS ↔ Railway bridge can communicate

### Saturday 3pm-7pm — Agent Brain (4 hrs)
- [ ] Gmail IMAP adapter → publishes to `messages.inbound.email` on Pi
- [ ] OpenFang agent subscribes to `messages.inbound.*`
- [ ] Categorization + scoring via Gemini/Groq
- [ ] Draft response generation
- [ ] Ed25519 signing of ranked records
- [ ] Publishes to `messages.ranked`

### Saturday 7pm-11pm — WhatsApp Bridge (4 hrs)
- [ ] Meta Cloud API interactive button messages (Send/Details/Skip)
- [ ] Progressive disclosure (Layer 1 → 2 → 3)
- [ ] Approval flow: button tap → NATS `messages.approved`
- [ ] Outbound: agent sends reply via SMTP
- [ ] End-to-end test: email in → WhatsApp alert → tap Send → email out

### Saturday 11pm-2am — Voice + Second Channel (3 hrs)
- [ ] Groq Whisper for voice note transcription
- [ ] Voice commands: "what's new?", "edit reply to say..."
- [ ] Slack adapter as second channel (the live "wow" demo moment)

### Sunday 2am-6am — Polish + Demo Prep (4 hrs)
- [ ] Seed realistic insurance demo data (10 emails, 5 Slack messages)
- [ ] Record backup demo video
- [ ] Track bonus integrations (Lava, K2, ElevenLabs — whatever time allows)

### Sunday 6am-10am — Pitch + Submit (4 hrs)
- [ ] Pitch deck / script
- [ ] Devpost submission + track selections
- [ ] Final dry run of live demo

### Buffer: ~5 hrs (eating, debugging, things taking 2x)

---

## Demo Script (2 min)

1. "I'm an insurance broker. I get 50+ emails and Slack messages a day."
2. *Point to Raspberry Pi on table.* "This is my agent. 32MB binary, runs on a $35 board."
3. *Show phone — WhatsApp is open. Nothing there.*
4. *On MacBook: send 10 emails + 5 Slack messages to throwaway accounts*
5. "15 messages just came in. Watch my phone."
6. *WhatsApp shows ONE alert with [Send] [Details] [Skip] buttons.*
7. "The agent read all 15 and decided only this one needs me. 14 context switches I didn't make."
8. *Tap [Details] — gist + draft appears*
9. *Voice note: "change the reply to mention we need the cert by Thursday"*
10. *Agent updates draft → [Send] button*
11. *Tap [Send]* → "Done." *Show email arrived on MacBook.*
12. "Every action is Ed25519 signed. Tamper-proof audit trail."
13. *Send a WhatsApp message to the agent* → "New channel, zero code changes. That's NATS."

---

## 2-Sentence Pitch

"[Name] is an AI agent that silently reads all your business email and Slack, but only interrupts you in WhatsApp when something actually needs your attention — you approve or edit with a tap or a voice note. Every action is Ed25519 signed for compliance, and adding a new channel is one NATS publisher — zero agent code changes."

---

## Cost: $0

| Item | Cost |
|------|------|
| Railway (WhatsApp bridge only) | $0 (free $5 trial, barely used) |
| Gemini API | $0 (free tier) |
| Groq API + Whisper | $0 (free tier) |
| Meta WhatsApp Cloud API | $0 (test number) |
| Raspberry Pi | $0 (MLH hardware checkout) |
| NATS | $0 (open source) |
| SQLite | $0 (built into Node.js) |
| **Total** | **$0** |
