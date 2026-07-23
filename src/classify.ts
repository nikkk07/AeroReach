import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const SYSTEM = `You classify inbound replies from flying schools to We One Aviation partnership outreach.
Given the full thread history and the newest inbound message, return strict JSON:
{"intent": one of "interested"|"not_interested"|"question"|"auto_reply"|"unsubscribe",
 "summary": one concise sentence describing the current state of the conversation}.
"auto_reply" = out-of-office / autoresponders. "unsubscribe" = any opt-out or removal request.`

type Turn = { direction: string; subject?: string | null; body?: string | null }

export async function classify(history: Turn[]) {
  const thread = history
    .map(m => `[${m.direction}] ${m.subject ? m.subject + '\n' : ''}${m.body ?? ''}`)
    .join('\n---\n')
  const chat = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: thread },
    ],
  })
  return JSON.parse(chat.choices[0].message.content!) as {
    intent: 'interested' | 'not_interested' | 'question' | 'auto_reply' | 'unsubscribe'
    summary: string
  }
}
