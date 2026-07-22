// Fixed offer facts — the ONLY source of courses/fees. Fill these in; AI must never generate them.
export const OFFER = {
  company: 'We One Aviation',
  site: 'https://weoneaviation.com',
  // TODO(We One Aviation): put the real courses / fee structure / partnership terms here.
  // These are delivered via the hosted deck (DECK_URL); outreach emails must not state numbers.
  facts: '[[ Fill in fixed offer facts: courses, fee structure, partnership terms. Do not fabricate. ]]',
}

// Compliance block — appended by CODE, never AI-generated (spec §2.2).
export function footer(schoolId: string): string {
  const unsub = `${process.env.UNSUBSCRIBE_BASE_URL}?id=${schoolId}`
  return [
    '',
    '—',
    OFFER.company,
    process.env.BUSINESS_ADDRESS,
    `Partnership details: ${process.env.DECK_URL}`,
    `Unsubscribe: ${unsub}`,
  ].join('\n')
}
