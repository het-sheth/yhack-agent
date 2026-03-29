"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// ── Types ──
interface RankedMessage {
  id: string;
  inbound: { id: string; channel: string; from: string; subject?: string; body: string; receivedAt: string };
  category: "urgent" | "action-required" | "fyi" | "low-priority";
  score: number;
  gist: string;
  draftReply: string;
  signature: string;
  rankedAt: string;
}

type OrbState = "idle" | "listening" | "thinking" | "speaking";
type Tab = "voice" | "inbox";
type VoiceEngine = "eleven" | "gemini" | "groq";

const catConfig: Record<string, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "bg-[#FF453A]" },
  "action-required": { label: "Action", color: "bg-[#FF9F0A]" },
  fyi: { label: "FYI", color: "bg-[#30D158]" },
  "low-priority": { label: "Low", color: "bg-[#8E8E93]" },
};

// ── Siri Orb Component ──
function SiriOrb({ state, onClick }: { state: OrbState; onClick: () => void }) {
  const stateClass = state === "idle" ? "" : state;
  const label: Record<OrbState, string> = {
    idle: "Tap to talk to Sarah",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Speaking...",
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <button
        onClick={onClick}
        className={`siri-orb ${stateClass} w-32 h-32 rounded-full flex items-center justify-center cursor-pointer transition-all duration-500`}
        style={{ background: state === "idle" ? "#F2F2F7" : "#E5E5EA" }}
      >
        {state === "idle" && (
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="rgba(60,60,67,0.6)" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        )}
        {state === "listening" && (
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="#000000" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        )}
        {state === "thinking" && (
          <div className="w-7 h-7 border-2 border-black/20 border-t-black/70 rounded-full animate-spin" />
        )}
        {state === "speaking" && (
          <div className="flex items-center gap-[3px]">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-[3px] bg-background/70 rounded-full animate-bounce"
                style={{
                  height: `${12 + Math.sin(i * 1.2) * 8}px`,
                  animationDelay: `${i * 0.1}s`,
                  animationDuration: "0.6s",
                }}
              />
            ))}
          </div>
        )}
      </button>
      <p className="text-[15px] tracking-[-0.24px]" style={{ color: "rgba(60,60,67,0.6)" }}>
        {label[state]}
      </p>
    </div>
  );
}

// Channel icons
const channelIcon: Record<string, { icon: string; bg: string; label: string }> = {
  email: { icon: "M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75", bg: "#007AFF", label: "Email" },
  slack: { icon: "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z", bg: "#E01E5A", label: "Slack" },
  whatsapp: { icon: "M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z", bg: "#25D366", label: "WhatsApp" },
};

// ── Message Card ──
function MessageCard({ msg }: { msg: RankedMessage }) {
  const cat = catConfig[msg.category] || catConfig.fyi;
  const scoreColor = msg.score >= 8 ? "#FF3B30" : msg.score >= 5 ? "#FF9500" : "#34C759";
  const ch = channelIcon[msg.inbound.channel] || channelIcon.email;
  const time = new Date(msg.rankedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="liquid-glass-thin rounded-2xl p-4 transition-all duration-200 hover:shadow-md">
      <div className="flex items-start gap-3">
        {/* Channel icon + Score */}
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: ch.bg }}
          >
            <svg className="w-[18px] h-[18px] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={ch.icon} />
            </svg>
          </div>
          <span
            className="text-[13px] font-bold tracking-[-0.08px]"
            style={{ color: scoreColor }}
          >
            {msg.score}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold tracking-[-0.24px] text-foreground truncate">
              {msg.inbound.from}
            </p>
            <span className="text-[11px] shrink-0" style={{ color: "rgba(60,60,67,0.3)" }}>{time}</span>
          </div>
          {msg.inbound.subject && (
            <p className="text-[13px] tracking-[-0.08px] text-foreground/70 truncate mt-0.5">
              {msg.inbound.subject}
            </p>
          )}
          <p className="text-[13px] tracking-[-0.08px] mt-1 line-clamp-2" style={{ color: "rgba(60,60,67,0.6)" }}>
            {msg.gist}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`${cat.color} text-[10px] font-semibold text-white px-2 py-[2px] rounded-full`}>
              {cat.label}
            </span>
            <span className="text-[10px] font-medium" style={{ color: "rgba(60,60,67,0.3)" }}>
              {ch.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ──
export default function Home() {
  const [tab, setTab] = useState<Tab>("voice");
  const [engine, setEngine] = useState<VoiceEngine>("eleven");
  const [messages, setMessages] = useState<RankedMessage[]>([]);
  const [chat, setChat] = useState<{ text: string; isUser: boolean }[]>([]);
  const [textInput, setTextInput] = useState("");
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [stats, setStats] = useState({ urgent: 0, action: 0, fyi: 0, total: 0 });
  const [newMsgDuringVoice, setNewMsgDuringVoice] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<{ text: string; isUser: boolean }[]>([]);

  // ElevenLabs refs
  const activeRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayRef = useRef(0);
  const sendInFlightRef = useRef(false);
  const lastApprovedRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/messages?limit=50").then((r) => r.json()).then((msgs: RankedMessage[]) => {
      setMessages(msgs);
      const s = { urgent: 0, action: 0, fyi: 0, total: msgs.length };
      msgs.forEach((m) => { if (m.category === "urgent") s.urgent++; else if (m.category === "action-required") s.action++; else s.fyi++; });
      setStats(s);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const sse = new EventSource("/api/events");
    sse.addEventListener("ranked", (e) => {
      const msg: RankedMessage = JSON.parse(e.data);
      setMessages((prev) => [msg, ...prev]);
      setStats((s) => ({
        urgent: s.urgent + (msg.category === "urgent" ? 1 : 0),
        action: s.action + (msg.category === "action-required" ? 1 : 0),
        fyi: s.fyi + (msg.category === "fyi" || msg.category === "low-priority" ? 1 : 0),
        total: s.total + 1,
      }));
      // Notify if voice is active — agent has stale context
      if (activeRef.current) setNewMsgDuringVoice(true);
    });
    return () => sse.close();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);

  // Keep chatRef in sync synchronously for triggerSend/extractDraft
  function addChat(entry: { text: string; isUser: boolean }) {
    setChat((h) => { const next = [...h, entry]; chatRef.current = next; return next; });
  }

  // ── Text chat ──
  async function sendTextMsg() {
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    addChat({ text, isUser: true });
    setOrbState("thinking");
    try {
      const res = await fetch("/api/voice-text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await res.json();
      addChat({ text: data.reply, isUser: false });
      setOrbState("idle");
    } catch { addChat({ text: "Something went wrong.", isUser: false }); setOrbState("idle"); }
  }

  // ── ElevenLabs ──
  function clearAudio() { sourcesRef.current.forEach((s) => { try { s.stop(); } catch {} }); sourcesRef.current = []; nextPlayRef.current = 0; }
  function stopEleven() {
    try { wsRef.current?.close(); wsRef.current = null; } catch {}
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; } catch {}
    try { processorRef.current?.disconnect(); processorRef.current = null; } catch {}
    clearAudio();
  }

  function playChunk(b64: string) {
    if (!b64 || !audioCtxRef.current) return;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
    if (!float32.length) return;
    const ctx = audioCtxRef.current;
    const buffer = ctx.createBuffer(1, float32.length, 16000);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextPlayRef.current);
    source.start(startAt);
    nextPlayRef.current = startAt + buffer.duration;
    sourcesRef.current.push(source);
    source.onended = () => { sourcesRef.current = sourcesRef.current.filter((s) => s !== source); };
  }

  // Regex for detecting agent send confirmations — single source of truth
  const SEND_CONFIRM_RE = /sending it now|i.?ve sent|sent the (response|reply|message)/i;

  // Extract the draft from recent conversation — check the send message first, then walk back
  function extractDraftFromChat(sendText?: string): string | null {
    // 1. Check if the draft is quoted inside the send confirmation message itself
    //    e.g. 'The message would be: "I am broke." Sending it now to YHack Broker.'
    if (sendText) {
      const quoted = sendText.match(/"([^"]+)"/);
      if (quoted) return quoted[1];
    }

    // 2. Walk backwards through recent agent messages for the most recent quoted draft
    for (let i = chatRef.current.length - 1; i >= 0; i--) {
      const msg = chatRef.current[i];
      if (msg.isUser) continue;
      if (SEND_CONFIRM_RE.test(msg.text) && !msg.text.includes('"')) continue;

      // Look for quoted text
      const quoted = msg.text.match(/"([^"]+)"/);
      if (quoted) return quoted[1];

      // Stop after checking 3 agent messages — don't pick up old unrelated ones
      break;
    }
    return null;
  }

  async function triggerSend(agentText: string) {
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    try {
      const res = await fetch("/api/messages?limit=15");
      if (!res.ok) return;
      const msgs: RankedMessage[] = await res.json();
      let target: RankedMessage | null = null;
      const lower = agentText.toLowerCase();
      for (const m of msgs) {
        const from = (m.inbound.from || "").toLowerCase();
        const name = from.split("@")[0].replace(/[._]/g, " ");
        if ((name && lower.includes(name)) || (from && lower.includes(from))) { target = m; break; }
      }
      if (!target || target.id === lastApprovedRef.current) return;

      // Use the draft from the conversation, not the categorizer's draftReply
      const conversationDraft = extractDraftFromChat(agentText);
      const draft = conversationDraft || target.draftReply;
      if (!draft) return;

      const approveRes = await fetch("/api/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: target.id, draft }) });
      if (approveRes.ok) { const result = await approveRes.json(); if (result.ok) { lastApprovedRef.current = target.id; addChat({ text: `Reply sent to ${result.to}`, isUser: false }); } }
    } finally { sendInFlightRef.current = false; }
  }

  async function startMic(ws: WebSocket) {
    const ctx = audioCtxRef.current!;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    streamRef.current = stream;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    processor.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const ratio = ctx.sampleRate / 16000;
      const newLen = Math.round(input.length / ratio);
      const resampled = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) resampled[i] = input[Math.round(i * ratio)];
      const pcm = new Int16Array(resampled.length);
      for (let i = 0; i < resampled.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(resampled[i] * 32767)));
      const bytes = new Uint8Array(pcm.buffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      ws.send(JSON.stringify({ user_audio_chunk: btoa(bin) }));
    };
    source.connect(processor);
    processor.connect(ctx.destination);
  }

  const orbClick = useCallback(async () => {
    if (activeRef.current) { stopEleven(); activeRef.current = false; setOrbState("idle"); setNewMsgDuringVoice(false); return; }
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
    activeRef.current = true;
    setOrbState("thinking");
    setNewMsgDuringVoice(false);
    try {
      const session = await fetch("/api/eleven-session").then((r) => r.json());
      if (!session.signedUrl) throw new Error("No signed URL");
      const ws = new WebSocket(session.signedUrl);
      wsRef.current = ws;
      ws.onopen = () => { ws.send(JSON.stringify({ type: "conversation_initiation_client_data", dynamic_variables: { inbox_context: session.inboxContext || "Inbox is empty." } })); };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "conversation_initiation_metadata") { startMic(ws); setOrbState("listening"); }
        if (msg.type === "audio") { setOrbState("speaking"); playChunk(msg.audio?.chunk || msg.audio_event?.audio_base_64); }
        if (msg.type === "agent_response") { const text = msg.agent_response_event?.agent_response; if (text) { addChat({ text, isUser: false }); if (SEND_CONFIRM_RE.test(text)) triggerSend(text); } }
        if (msg.type === "user_transcript") { const text = msg.user_transcription_event?.user_transcript; if (text) addChat({ text, isUser: true }); }
        if (msg.type === "agent_response_correction" || msg.type === "turn_end") setOrbState("listening");
        if (msg.type === "interruption") { clearAudio(); setOrbState("listening"); }
      };
      ws.onerror = () => { stopEleven(); activeRef.current = false; setOrbState("idle"); setNewMsgDuringVoice(false); };
      ws.onclose = () => { stopEleven(); activeRef.current = false; setOrbState("idle"); setNewMsgDuringVoice(false); };
    } catch { stopEleven(); activeRef.current = false; setOrbState("idle"); }
  }, []);

  const isActive = orbState !== "idle";

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Siri border glow */}
      <div className={`siri-border-glow ${isActive ? "active" : ""}`} />

      {/* Content */}
      <div className="flex-1 flex flex-col relative z-10">
        {/* Voice Tab */}
        {tab === "voice" && (
          <div className="flex-1 flex flex-col relative">
            {/* Engine selector — top right */}
            <div className="absolute top-4 right-4 z-10">
              <div className="flex items-center rounded-full p-[3px]" style={{ background: "#F2F2F7" }}>
                {([
                  { key: "eleven" as VoiceEngine, label: "ElevenLabs" },
                  { key: "gemini" as VoiceEngine, label: "Gemini" },
                  { key: "groq" as VoiceEngine, label: "Groq" },
                ]).map((e) => (
                  <button
                    key={e.key}
                    onClick={() => { if (orbState !== "idle") { stopEleven(); activeRef.current = false; setOrbState("idle"); } setEngine(e.key); }}
                    className="px-3 py-1 rounded-full text-[11px] font-medium tracking-[-0.08px] transition-all duration-200"
                    style={{
                      background: engine === e.key ? "#FFFFFF" : "transparent",
                      color: engine === e.key ? "#000000" : "rgba(60,60,67,0.5)",
                      boxShadow: engine === e.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    }}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat area */}
            <div className="flex-1 overflow-y-auto px-5 pt-12 pb-4">
              {chat.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <p className="text-[28px] font-semibold tracking-[0.36px]">
                    Inbox Agent
                  </p>
                  <p className="text-[15px] tracking-[-0.24px]" style={{ color: "rgba(60,60,67,0.6)" }}>
                    Voice AI for every communication channel
                  </p>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto space-y-2">
                  {chat.map((msg, i) => (
                    <div key={i} className={`flex ${msg.isUser ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] px-4 py-2.5 text-[15px] tracking-[-0.24px] ${msg.isUser ? "bubble-sent text-white" : "bubble-received"}`}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {/* Orb + Input */}
            <div className="pb-24 pt-2 flex flex-col items-center gap-5">
              <SiriOrb state={orbState} onClick={orbClick} />
              {newMsgDuringVoice && (
                <p className="text-[12px] font-medium px-3 py-1 rounded-full animate-pulse"
                  style={{ background: "rgba(0,122,255,0.1)", color: "#007AFF" }}>
                  New message received — tap orb to refresh
                </p>
              )}
              <div className="w-full max-w-md px-6">
                <div className="flex gap-2">
                  <input
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendTextMsg()}
                    placeholder="Type a message..."
                    className="flex-1 h-11 rounded-full px-5 text-[15px] tracking-[-0.24px] bg-[#F2F2F7] border-0 text-foreground placeholder:text-[rgba(60,60,67,0.3)] focus:outline-none focus:ring-1 focus:ring-[#007AFF]/30"
                  />
                  <button
                    onClick={sendTextMsg}
                    className="w-11 h-11 rounded-full bg-[#007AFF] flex items-center justify-center shrink-0 active:scale-95 transition-transform duration-150"
                  >
                    <svg className="w-5 h-5 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Inbox Tab */}
        {tab === "inbox" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Stats header */}
            <div className="px-5 pt-12 pb-4">
              <p className="text-[28px] font-semibold tracking-[0.36px] text-foreground">Inbox</p>
              <div className="flex gap-4 mt-2">
                <span className="text-[13px] tracking-[-0.08px]">
                  <span style={{ color: "#FF453A" }} className="font-semibold">{stats.urgent}</span>
                  <span style={{ color: "rgba(60,60,67,0.3)" }}> urgent</span>
                </span>
                <span className="text-[13px] tracking-[-0.08px]">
                  <span style={{ color: "#FF9F0A" }} className="font-semibold">{stats.action}</span>
                  <span style={{ color: "rgba(60,60,67,0.3)" }}> action</span>
                </span>
                <span className="text-[13px] tracking-[-0.08px]">
                  <span style={{ color: "#30D158" }} className="font-semibold">{stats.fyi}</span>
                  <span style={{ color: "rgba(60,60,67,0.3)" }}> FYI</span>
                </span>
                <span className="text-[13px] tracking-[-0.08px]">
                  <span style={{ color: "rgba(60,60,67,0.6)" }} className="font-semibold">{stats.total}</span>
                  <span style={{ color: "rgba(60,60,67,0.3)" }}> total</span>
                </span>
              </div>
            </div>

            {/* Message list */}
            <div className="flex-1 overflow-y-auto px-4">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <p className="text-[15px]" style={{ color: "rgba(60,60,67,0.3)" }}>Waiting for messages...</p>
                </div>
              ) : (
                <div className="space-y-3 pb-24">
                  {messages.map((msg) => (
                    <MessageCard key={msg.id} msg={msg} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom tab bar — floating pill */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20">
        <div className="liquid-glass rounded-full flex items-center gap-1 p-1">
          <button
            onClick={() => setTab("voice")}
            data-active={tab === "voice"}
            className="tab-pill px-5 py-2 rounded-full flex items-center gap-2 text-[13px] font-medium tracking-[-0.08px]"
            style={{ color: tab === "voice" ? "#000000" : "rgba(60,60,67,0.6)" }}
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Sarah
          </button>
          <button
            onClick={() => setTab("inbox")}
            data-active={tab === "inbox"}
            className="tab-pill px-5 py-2 rounded-full flex items-center gap-2 text-[13px] font-medium tracking-[-0.08px] relative"
            style={{ color: tab === "inbox" ? "#000000" : "rgba(60,60,67,0.6)" }}
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3" />
            </svg>
            Inbox
            {stats.urgent > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#FF453A] text-foreground text-[10px] font-bold flex items-center justify-center">
                {stats.urgent}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
