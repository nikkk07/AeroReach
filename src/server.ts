import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { classify } from './classify.js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.send('ok'))

app.get('/unsubscribe', async (req, res) => {
  const id = String(req.query.id ?? '')
  const { data: school } = await supabase.from('schools').select('id, email').eq('id', id).maybeSingle()
  if (school?.email) {
    await supabase.from('suppression').upsert({ email: school.email, reason: 'unsubscribe' }, { onConflict: 'email' })
    await supabase.from('schools').update({ status: 'unsubscribed' }).eq('id', school.id)
    await supabase.from('events').insert({ school_id: school.id, type: 'unsubscribed', detail: school.email })
  }
  res.send('<html><body><h1>You’ve been unsubscribed</h1><p>You will no longer receive emails from We One Aviation.</p></body></html>')
})

app.post('/inbound', async (req, res) => {
  const { from, subject, text } = req.body ?? {}
  const { data: school } = await supabase.from('schools').select('id').eq('email', from).maybeSingle()
  if (!school) return res.sendStatus(200)

  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('school_id', school.id)
    .order('last_activity_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: msg } = await supabase
    .from('messages')
    .insert({ conversation_id: conv?.id, school_id: school.id, direction: 'inbound', subject, body: text, status: 'received' })
    .select('id')
    .single()

  const { data: history } = await supabase
    .from('messages')
    .select('direction, subject, body')
    .eq('conversation_id', conv?.id)
    .order('created_at', { ascending: true })

  const { intent, summary } = await classify(history ?? [{ direction: 'inbound', subject, body: text }])
  await supabase.from('messages').update({ intent }).eq('id', msg!.id)

  const now = new Date().toISOString()
  if (conv) {
    const stage = intent === 'interested' ? 'negotiating' : intent === 'unsubscribe' || intent === 'not_interested' ? 'closed' : undefined
    await supabase.from('conversations').update({ summary, last_activity_at: now, ...(stage && { stage }) }).eq('id', conv.id)
  }
  if (intent === 'unsubscribe') {
    const { data: s } = await supabase.from('schools').select('email').eq('id', school.id).single()
    if (s?.email) await supabase.from('suppression').upsert({ email: s.email, reason: 'unsubscribe' }, { onConflict: 'email' })
    await supabase.from('schools').update({ status: 'unsubscribed' }).eq('id', school.id)
  } else {
    await supabase.from('schools').update({ status: 'replied' }).eq('id', school.id)
  }

  await supabase.from('events').insert({ school_id: school.id, type: 'replied', detail: `${intent}: ${summary}` })
  res.sendStatus(200)
})

const port = Number(process.env.PORT) || 3000
app.listen(port, '0.0.0.0', () => console.log(`listening on ${port}`))
