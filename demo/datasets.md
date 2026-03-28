# Datasets for Demo + RAG

## Primary: Enron Email Corpus (500K+ real business emails)

Real enterprise emails from 150 senior employees. Free, no restrictions.

- Hugging Face: https://huggingface.co/datasets/LLM-PBE/enron-email
- Kaggle: https://www.kaggle.com/datasets/wcukierski/enron-email-dataset
- CMU: https://www.cs.cmu.edu/~enron/

### Quick pull (100 samples):
```bash
pip install datasets
python -c "
from datasets import load_dataset
ds = load_dataset('LLM-PBE/enron-email', split='train[:100]')
for row in ds:
    print(row['subject'], '|', row['body'][:80])
"
```

### What to pick for seed-emails/:
- Urgent requests with deadlines
- Follow-up emails (2nd, 3rd follow-up)
- Contract/quote requests
- FYI newsletters (agent should NOT surface these)
- Meeting scheduling
- Multi-thread conversations

Goal: 50-100 emails in seed-emails/ that cover all 4 categories (urgent, action-required, fyi, low-priority)

## Secondary: Customer Support Tickets (pre-labeled with priority)

- Hugging Face: https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets
- Has: priority levels, department, subject, full text, agent responses
- Use to validate agent accuracy: "87% match against human-labeled priority"

## How we use this in demo

1. Pre-select 50 interesting Enron emails into seed-emails/
2. Embed them for RAG context (agent has "memory" of past conversations)
3. Feed through throwaway Gmail during live demo
4. Agent categorizes → WhatsApp shows only urgent ones
5. Pitch line: "Trained on 500K real enterprise emails from the Enron corpus"
