import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import pLimit from 'p-limit'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const limit = pLimit(5)

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
]
const QUERY = `
[out:json][timeout:180];
area["ISO3166-1"="US"][admin_level=2]->.us;
(
  nwr["amenity"="flight_school"](area.us);
  nwr["aeroway"="flight_school"](area.us);
  nwr["aeroway"="aerodrome"]["flight_school"="yes"](area.us);
);
out center tags;`

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/

type El = { tags: Record<string, string>; center?: { lat: number; lon: number }; lat?: number; lon?: number }

const normUrl = (w: string) => (/^https?:\/\//.test(w) ? w : 'https://' + w)

async function fetchOverpass(): Promise<El[]> {
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'WeOneAviation/1.0 (contact@weoneaviation.com)',
        },
        body: 'data=' + encodeURIComponent(QUERY),
      })
      if (r.status !== 200 || !r.headers.get('content-type')?.includes('application/json')) {
        console.warn(`Overpass ${url} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
        continue
      }
      return (await r.json()).elements ?? []
    } catch (e) {
      console.warn(`Overpass ${url} failed: ${(e as Error).message}`)
    }
  }
  throw new Error('All Overpass endpoints failed')
}

async function extract(url: string): Promise<{ email?: string; phone?: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0' } })
    const $ = cheerio.load(await r.text())
    const mailto = $('a[href^="mailto:"]').first().attr('href')?.replace(/^mailto:/, '').split('?')[0]
    const tel = $('a[href^="tel:"]').first().attr('href')?.replace(/^tel:/, '')
    const text = $('body').text()
    return { email: mailto || text.match(EMAIL_RE)?.[0], phone: tel || text.match(PHONE_RE)?.[0] }
  } catch {
    return {}
  }
}

async function main() {
  const els = (await fetchOverpass()).filter(e => e.tags?.website || e.tags?.['contact:website'])
  console.log(`Overpass: ${els.length} US schools with a website`)

  const rows = await Promise.all(
    els.map(e =>
      limit(async () => {
        const t = e.tags
        const website = normUrl(t.website || t['contact:website'])
        const { email, phone } = await extract(website)
        if (!email) return null // compliance §2.1: no email → skip
        return {
          name: t.name ?? 'Unknown',
          country: 'US',
          state_region: t['addr:state'] ?? null,
          city: t['addr:city'] ?? null,
          address: t['addr:full'] || [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null,
          lat: e.center?.lat ?? e.lat ?? null,
          lng: e.center?.lon ?? e.lon ?? null,
          phone: phone ?? t.phone ?? t['contact:phone'] ?? null,
          email: email.toLowerCase(),
          website,
          source: 'website',
          source_url: website, // provenance for compliance audit
        }
      })
    )
  )

  const seen = new Set<string>()
  const dedup = rows.filter((r): r is NonNullable<typeof r> => {
    if (!r || seen.has(r.email)) return false
    seen.add(r.email)
    return true
  })

  if (!dedup.length) return console.log('No public emails found.')
  const { error } = await supabase.from('schools').upsert(dedup, { onConflict: 'email' })
  if (error) throw error
  console.log(`Upserted ${dedup.length} US schools with public emails + provenance.`)
}

main()
