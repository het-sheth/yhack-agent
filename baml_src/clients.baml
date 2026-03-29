// LLM Clients — Groq for speed, Gemini for fallback

client<llm> Groq {
  provider openai-generic
  retry_policy Fast
  options {
    base_url "https://api.groq.com/openai/v1"
    model "llama-3.3-70b-versatile"
    api_key env.GROQ_API_KEY
  }
}

client<llm> Gemini {
  provider google-ai
  retry_policy Fast
  options {
    model "gemini-2.0-flash"
    api_key env.GEMINI_API_KEY
  }
}

// Fallback: try Groq first (fast), then Gemini
client<llm> TriageLLM {
  provider fallback
  options {
    strategy [Groq, Gemini]
  }
}

retry_policy Fast {
  max_retries 2
  strategy {
    type constant_delay
    delay_ms 500
  }
}
