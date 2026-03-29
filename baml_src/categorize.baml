// Message triage categorization with role-based context

enum Category {
  URGENT
  ACTION_REQUIRED
  FYI
  LOW_PRIORITY
}

class TriageResult {
  category Category
  score int @description("Urgency score 1-10, where 10 is most urgent")
  gist string @description("1-2 sentence summary of the message")
  draft_reply string @description("Suggested response if action needed, empty string if FYI or low-priority")
}

function CategorizeMessage(role: string, from: string, subject: string, body: string) -> TriageResult {
  client TriageLLM
  prompt #"
    You are an AI triage assistant for a {{ role }}.

    Categorize this incoming message by urgency and draft a reply if needed.

    <message>
    From: {{ from }}
    Subject: {{ subject }}
    Body: {{ body }}
    </message>

    Rules:
    - URGENT: Deadlines within 48hrs, escalations, repeated follow-ups, compliance/legal
    - ACTION_REQUIRED: Needs a response or decision but not time-critical
    - FYI: Informational, newsletters, confirmations, no action needed
    - LOW_PRIORITY: Social, greetings, spam, automated notifications

    Score 1-10 based on how quickly the {{ role }} needs to see this.
    Draft a professional reply if the category is URGENT or ACTION_REQUIRED.
    Leave draft_reply as empty string for FYI and LOW_PRIORITY.

    {{ ctx.output_format }}
  "#
}

function DetectIntent(user_message: string, inbox_summary: string) -> IntentResult {
  client Groq
  prompt #"
    You are an AI inbox assistant on WhatsApp. The user speaks naturally via text or voice.

    Current inbox state: {{ inbox_summary }}

    User said: "{{ user_message }}"

    What does the user want?

    {{ ctx.output_format }}
  "#
}

enum Intent {
  CHECK_INBOX
  SEARCH_MESSAGE
  GREETING
  OTHER
}

class IntentResult {
  intent Intent
  search_query string @description("If SEARCH_MESSAGE, what to search for. Empty string otherwise.")
  response string @description("Brief, casual WhatsApp-style response to the user")
}

function ReviseDraft(original_from: string, original_subject: string, current_draft: string, edit_instructions: string) -> string {
  client Groq
  prompt #"
    Edit this email draft reply based on the user's instructions. Return ONLY the revised reply text.

    Original email from: {{ original_from }}
    Subject: {{ original_subject }}

    Current draft: "{{ current_draft }}"

    User's edit instructions: "{{ edit_instructions }}"

    Return the revised reply:
  "#
}
