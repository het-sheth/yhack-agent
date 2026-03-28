# [Name TBD] — Enterprise AI Agent via WhatsApp

> An AI agent that silently reads all your business email and Slack, but only interrupts you in WhatsApp when something actually needs your attention. You approve or edit with a tap or a voice note. Every action is Ed25519 signed for compliance.

**Built at YHack 2026** | Harper "Personal AI Agents in Enterprises" Track

---

## The Problem

Insurance brokers get 50+ emails and Slack messages a day. They don't have time to read them all — but they can't afford to miss the urgent ones. Current solutions either require another dashboard (that nobody checks) or let AI act autonomously (which goes wrong — [ask the Meta researcher whose inbox got wrecked by an AI agent](https://techcrunch.com/2026/02/23/a-meta-ai-security-researcher-said-an-openclaw-agent-ran-amok-on-her-inbox/)).

## The Solution

An AI agent that lives where you already are — WhatsApp. It:
1. **Silently ingests** all email and Slack in the background
2. **Categorizes and ranks** every message by urgency (urgent / action-required / FYI / low-priority)
3. **Only interrupts you** for what matters — via WhatsApp interactive buttons
4. **Drafts responses** you can approve with one tap, edit via voice note, or skip
5. **Signs every action** with Ed25519 for a tamper-proof audit trail

The agent's job is to NOT show you things. 50 messages come in → it surfaces 2 that matter. The value is the 48 context switches you didn't make.

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
                              │            - Meta Cloud API
                    messages.inbound.*     - Interactive buttons
                              │            - Voice note handling
                              ▼
                    OpenFang Agent
                    - Categorize + Score
                    - Draft response
                    - Ed25519 sign
                              │
                    messages.ranked ──────► WhatsApp alert
                                           [Send] [Details] [Skip]
                              │
                    messages.approved ◄──── User taps / voice note
                              │
                    Agent sends reply via
                    original channel (SMTP/Slack)
                              │
                    Ed25519 signed receipt → SQLite
```

### Why This Architecture?

- **NATS wildcard subscriptions** — Agent subscribes to `messages.inbound.*`. Adding a new channel = one 10-line publisher. Zero agent code changes.
- **Raspberry Pi** — The entire agent OS runs on a $35 board. Edge computing for enterprises that can't send data to the cloud.
- **Railway** — Only the WhatsApp bridge needs a public URL (for Meta webhook callbacks). Everything else runs on the Pi.
- **Progressive disclosure** — WhatsApp buttons let you go from 1-line alert → full gist + draft → complete email body, without ever leaving the chat.

---

## WhatsApp UX

### Alert (only for urgent/action-required)
```
🔴 John Chen — COI for 42 Main St
Needs cert by EOD (2nd follow-up)

[✅ Send]  [📋 Details]  [⏭ Skip]
```

### Details (tap to expand)
```
From: john.chen@acmecorp.com
Subject: RE: COI for 42 Main St
Via: Email │ 10:23 AM │ Thread: 3 msgs

Gist: Following up 2nd time since Monday.
Contractor starts Thursday.

Draft: "Hi John, pulling the cert now.
You'll have it within the hour."

[✅ Send] [✏️ Edit] [🔗 Full]
```

### Voice
```
🎤 "anything urgent?"
→ "Nothing urgent. 3 action items — biggest
   is Acme renewal expiring Friday."

🎤 "edit the reply to mention Thursday deadline"
→ Draft updated. [✅ Send] [✏️ Edit More]
```

---

## Tech Stack

| Component | Tech | Where |
|-----------|------|-------|
| Agent OS | OpenFang (Rust, 32MB) | Raspberry Pi |
| Message bus | NATS + JetStream | Raspberry Pi |
| WhatsApp | Meta Cloud API | Railway |
| Email | IMAP/SMTP adapter | Raspberry Pi |
| Slack | Socket Mode adapter | Raspberry Pi |
| LLM | Groq (speed) + Gemini 2.5 Flash (quality) | API |
| Voice STT | Groq Whisper | API |
| Audit store | SQLite + Ed25519 signatures | Raspberry Pi |
| Backend | TypeScript / Node.js | Both |

## Security

- **Ed25519 signatures** on every categorization, approval, and send action
- **WASM sandbox** — OpenFang runs agent code in isolated WASM
- **Merkle hash-chain** audit log — immutable, verifiable
- **NATS NKeys** — Ed25519 client-to-broker authentication
- **Channel isolation** — throwaway accounts, scoped bot tokens, test numbers

## Cost: $0

Everything runs on free tiers: Railway ($5 trial), Gemini (free), Groq (free), Meta WhatsApp (test number), MLH Raspberry Pi.

---

## Setup

```bash
# Clone
git clone https://github.com/<username>/yhack-agent.git
cd yhack-agent
npm install

# Pi: Start NATS + OpenFang + adapters
npm run pi:start

# Railway: Deploy WhatsApp bridge
npm run bridge:deploy
```

See [architecture.md](architecture.md) for detailed setup, NATS subjects, and message schemas.

---

Built with OpenFang, NATS, Gemini, and Groq at YHack 2026.
