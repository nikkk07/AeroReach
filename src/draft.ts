import { createClient } from '@supabase/supabase-js'
import Groq from 'groq-sdk'
import { footer } from './offer.js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const CAMPAIGN = 'US Outreach'

const SYSTEM = `You write B2B partnership outreach for We One Aviation to flying schools.
Tone: professional, warm, concise (max ~120 words). Personalize ONLY a relevance hook from the given school facts.
Hard rule: do NOT mention any courses, fees, prices, numbers, dates, or specific program details — those are sent separately.
Return strict JSON: {"subject": string, "body": string}. No sign-off, no contact block (added by our system).`

async function getCampaignId() {
  const { data } = await supabase.from('campaigns').select('id').eq('name', CAMPAIGN).maybeSingle()
  if (data) return data.id
  const { data: c, error } = await supabase
    .from('campaigns')
    .insert({ name: CAMPAIGN, from_email: process.env.FROM_EMAIL! })
    .select('id')
    .single()
  if (error) throw error
  return c.id
}

async function main() {
  const campaign_id = await getCampaignId()
  const { data: schools, error } = await supabase
    .from('schools')
    .select('id, name, city, country, certified')
    .eq('status', 'new')
    .limit(20)
  if (error) throw error
  if (!schools?.length) return console.log('No new schools to draft.')

  for (const s of schools) {
    const { data: conv, error: cErr } = await supabase
      .from('conversations')
      .upsert({ school_id: s.id, campaign_id }, { onConflict: 'school_id,campaign_id' })
      .select('id')
      .single()
    if (cErr) throw cErr

    const chat = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify({ name: s.name, city: s.city, country: s.country, certified: s.certified }) },
      ],
    })
    const { subject, body } = JSON.parse(chat.choices[0].message.content!)

    await supabase.from('messages').insert({
      conversation_id: conv.id,
      school_id: s.id,
      direction: 'outbound',
      subject,
      body: body + footer(s.id),
      ai_generated: true,
      status: 'draft',
    })
    await supabase.from('schools').update({ status: 'queued' }).eq('id', s.id)
    console.log(`Drafted → ${s.name}`)
  }
  console.log(`Done: ${schools.length} drafts (status='draft'). Flip to 'approved' to send.`)
}

main()
