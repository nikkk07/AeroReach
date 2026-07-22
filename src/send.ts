import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.FROM_EMAIL!
const DAILY_CAP = 100

async function main() {
  const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00Z'
  const { count: sentToday } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .gte('sent_at', todayStart)
  let budget = DAILY_CAP - (sentToday ?? 0)
  if (budget <= 0) return console.log(`Daily cap reached (${sentToday}/${DAILY_CAP}).`)

  const { data: supp } = await supabase.from('suppression').select('email')
  const suppressed = new Set((supp ?? []).map(s => s.email))

  const { data: msgs, error } = await supabase
    .from('messages')
    .select('id, subject, body, school_id, conversation_id, schools(email)')
    .eq('status', 'approved')
    .limit(budget)
  if (error) throw error
  if (!msgs?.length) return console.log('No approved messages to send.')

  for (const m of msgs) {
    if (budget <= 0) break
    const email = (m.schools as unknown as { email: string })?.email
    if (!email || suppressed.has(email)) {
      console.log(`Skip (suppressed/no email): ${email}`)
      continue
    }
    const { data, error: sErr } = await resend.emails.send({ from: FROM, to: email, subject: m.subject!, text: m.body! })
    if (sErr || !data) {
      await supabase.from('messages').update({ status: 'failed' }).eq('id', m.id)
      console.error(`Failed → ${email}: ${sErr?.message}`)
      continue
    }
    await supabase.from('messages').update({ status: 'sent', sent_at: new Date().toISOString(), resend_id: data.id }).eq('id', m.id)
    await supabase.from('schools').update({ status: 'contacted' }).eq('id', m.school_id)
    await supabase.from('conversations').update({ stage: 'contacted', last_activity_at: new Date().toISOString() }).eq('id', m.conversation_id)
    await supabase.from('events').insert({ school_id: m.school_id, type: 'sent', detail: email })
    budget--
    console.log(`Sent → ${email} (${data.id})`)
  }
  console.log(`Done. Remaining daily budget: ${budget}.`)
}

main()
