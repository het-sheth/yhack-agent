# Mega Prompt: Fix All Bugs — YHack Agent

Copy everything below this line into a new Claude Code session.

---

## Context

You are continuing work on a **WhatsApp-first AI inbox agent** built at YHack 2026. The core pipeline works (email → NATS → BAML categorizer → MongoDB → WhatsApp alerts → voice conversation). But there are bugs that need fixing before the demo. **You have ~4 hours.**

## Architecture (working)

```
Gmail IMAP → adapters/email.ts → NATS messages.inbound.email
                                          ↓
                              agent/categorizer.ts (BAML + Groq → Gemini fallback)
                                          ↓
                              NATS messages.ranked + MongoDB
                                          ↓
                              bridge/whatsapp.ts
                              - Score 8+ → WhatsApp alert
                              - User taps Send → NATS messages.approved
                              - Conversational LLM (Groq llama-3.3-70b)
                              - Voice: ElevenLabs Agent / Gemini Live / Groq+ElevenLabs
                              - Web dashboard at localhost:3000
                                          ↓
                              agent/outbound.ts → SMTP reply (DEMO_MODE: sends to self)
```

## What's Working
- NATS message bus ✅
- MongoDB persistence (local, localhost:27017/yhack-agent) ✅
- BAML categorizer with role-based triage ✅
- Email adapter (IMAP + IDLE) ✅
- Slack adapter (Socket Mode) ✅
- WhatsApp webhook (receives messages, sends text replies) ✅
- Conversational LLM in WhatsApp (text in → natural text out) ✅
- WhatsApp voice notes (Groq Whisper transcription + ElevenLabs TTS response) ✅
- Outbound email sending in DEMO_MODE ✅
- Web dashboard (localhost:3000, real-time SSE feed of categorized messages) ✅
- Ed25519 signing on categorization + outbound ✅
- Seed data (50 Enron emails in demo/seed-emails/) ✅

## BUGS TO FIX (priority order)

### BUG 1: ElevenLabs Conversational AI agent cuts off mid-sentence
**File:** web/index.html (ElevenLabs Agent voice mode)
**Agent ID:** `agent_1501kmvpbae7frc8crxb7h5ve0p6`
**Symptom:** Agent says "Gillian Lockwood has been trying to reach you about digitals. Also—" and then stops mid-sentence. User says "Also what?" and it continues in a new turn.
**Root cause:** The ElevenLabs agent's `max_tokens` is 500 but the LLM (gemini-2.5-flash) may be generating too much text, or the turn timeout (7s) is cutting the response short. The ElevenLabs API ignores PATCH requests to update `turn_timeout` and `turn_eagerness`.
**Fix needed:**
1. Try passing `conversation_config_override` in the `conversation_initiation_client_data` WebSocket message to override turn settings at session start
2. Or shorten the system prompt so responses are always brief enough to finish in one turn
3. Or switch the agent's LLM to a faster model that generates shorter responses
**API key:** In `.env` as `ELEVENLABS_API_KEY`

### BUG 2: Gemini Live audio is choppy/broken
**File:** web/index.html (Gemini Live voice mode)
**Symptom:** WebSocket connects, serverContent messages stream in, but audio playback is choppy — chunks play with gaps or overlap.
**Root cause:** PCM audio chunks from Gemini are scheduled via `audioCtx.createBufferSource()` with `nextPlayTime` tracking, but the timing isn't precise. Chunks may arrive faster than they play, or the 24000 sample rate assumption may be wrong.
**Fix needed:**
1. Check Gemini's actual output audio format (might not be 24kHz PCM)
2. Use AudioWorklet instead of ScriptProcessor for input (ScriptProcessor is deprecated)
3. Buffer a few chunks before starting playback (jitter buffer)
4. Or just remove Gemini Live and use only ElevenLabs Agent (it's better)

### BUG 3: Voice tab orb state gets stuck
**File:** web/index.html
**Symptom:** If you try one voice engine and it fails (e.g., Gemini Live closes), then switch to another engine in the dropdown, the orb doesn't respond because `active` is still `true` from the previous engine.
**Current fix attempt:** There's a guard that stops everything on first click if `active`, but it requires an extra tap (stop → then start).
**Better fix:** When dropdown value changes, auto-stop any active engine and reset state.

### BUG 4: WhatsApp Meta token expires every 24 hours
**Not a code bug** — Meta's temporary access tokens expire. The `.env` `META_WHATSAPP_TOKEN` needs to be refreshed from the Meta developer dashboard before each demo session.
**Fix:** Document the refresh process clearly. Or implement a permanent token via the System User flow (more complex).

### BUG 5: Duplicate messages in MongoDB
**Symptom:** Some messages appear twice in MongoDB (and the web dashboard) because two categorizer processes were running simultaneously.
**Root cause:** No uniqueness constraint on `inbound.id` in MongoDB. Multiple categorizer instances can process the same NATS message.
**Fix:** Add a unique index on `inbound.id` in the ranked collection in `shared/db.ts`:
```typescript
await db.collection("ranked").createIndex({ "inbound.id": 1 }, { unique: true, background: true }).catch(() => {});
```

### BUG 6: CLAUDE.md says "use SQLite, don't use MongoDB" but we use MongoDB
**File:** CLAUDE.md
**Fix:** Update CLAUDE.md to reflect current architecture. Change "Do not use MongoDB" to "Use MongoDB for persistence" and remove SQLite references.

## NON-BUG IMPROVEMENTS (if time allows)

### IMPROVEMENT 1: ElevenLabs Agent doesn't have inbox context
The agent's system prompt references `{{inbox_context}}` but the dynamic variable may not be reaching the LLM. The `conversation_initiation_client_data` message sends `dynamic_variables.inbox_context` but need to verify the agent actually receives it. Check by asking the agent "how many emails do I have?" — if it doesn't know, the context isn't getting through.
**Fix:** Consider passing inbox context directly in the `conversation_config_override.agent.prompt.prompt` field instead of relying on dynamic variables.

### IMPROVEMENT 2: Web dashboard needs a text input
Currently the Voice tab only supports speech. Add a text input field below the orb so users can also type messages (useful for demo when voice doesn't work).

### IMPROVEMENT 3: WhatsApp conversation should use BAML
The WhatsApp conversational handler in bridge/whatsapp.ts uses raw Groq API calls. The BAML functions `DetectIntent` and `ReviseDraft` are defined in baml_src/categorize.baml but never used. Wire them in for type-safe intent detection and draft editing.

### IMPROVEMENT 4: Commit all changes
There are significant uncommitted changes. Create a branch `feat/full-stack` and commit everything:
- BAML categorizer refactor
- MongoDB persistence layer
- Web dashboard + voice engines
- Bridge conversational rewrite
- ElevenLabs integration

## Key Files

| File | Lines | What |
|------|-------|------|
| bridge/whatsapp.ts | ~660 | The main server: WhatsApp webhook + web dashboard + voice APIs + SSE |
| web/index.html | ~630 | SPA: dashboard + 3 voice engines (ElevenLabs/Gemini/Groq) |
| agent/categorizer.ts | ~85 | BAML categorizer: NATS subscriber → Groq/Gemini → MongoDB |
| agent/outbound.ts | ~92 | Reply sender: NATS approved → SMTP (DEMO_MODE) |
| agent/signer.ts | ~40 | Ed25519 signing utility |
| shared/db.ts | ~49 | MongoDB connection + collections |
| shared/types.ts | ~39 | Message type definitions |
| shared/nats.ts | ~12 | NATS subject constants |
| baml_src/categorize.baml | ~86 | BAML schema: CategorizeMessage, DetectIntent, ReviseDraft |
| baml_src/clients.baml | ~36 | LLM clients: Groq → Gemini fallback |

## Services to Run

```bash
# Terminal 1: NATS
nats-server --jetstream --store_dir /tmp/nats-data

# Terminal 2: Categorizer
npx tsx agent/categorizer.ts

# Terminal 3: Outbound
npx tsx agent/outbound.ts

# Terminal 4: Bridge (serves WhatsApp webhook + web dashboard on :3000)
npx tsx bridge/whatsapp.ts

# Terminal 5: ngrok (for WhatsApp webhook)
ngrok http 3000

# Optional: Email adapter
npx tsx adapters/email.ts

# Optional: Inject test data
npx tsx demo/inject.ts --count 5
```

## ElevenLabs Agent Details
- **Agent ID:** `agent_1501kmvpbae7frc8crxb7h5ve0p6`
- **Voice:** EXAVITQu4vr4xnSDxMaL (Sarah)
- **LLM:** gemini-2.5-flash
- **API:** Signed URL from `/api/eleven-session` endpoint
- **WebSocket:** `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=...`

## Environment
- macOS (MacBook Air)
- Node.js 20+
- MongoDB local (brew services)
- NATS local (brew install nats-server)
- ffmpeg installed (for audio conversion)
- Firefox or Chrome (Safari has limited WebSocket/Audio support)

## .env keys present
GEMINI_API_KEY, GROQ_API_KEY, LAVA_SPEND_KEY, META_WHATSAPP_TOKEN, META_PHONE_NUMBER_ID, META_VERIFY_TOKEN, RECIPIENT_PHONE, GMAIL_USER, GMAIL_APP_PASSWORD, NATS_URL, ED25519_PRIVATE_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, MONGODB_URI

## Git
- Remote: https://github.com/het-sheth/yhack-agent.git (personal GitHub)
- Branch: main
- Many uncommitted changes — commit first before making more changes
