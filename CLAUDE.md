# We One Aviation Outreach — Working Rules

Full spec: ./we-one-aviation-build-spec.md (read once, don't re-read unless I say the schema changed)

## Code style — STRICT
- Write the SHORTEST correct code. Prefer well-known libraries over hand-rolled logic.
- Use: supabase-js, resend, groq-sdk (OpenAI-compatible), cheerio (HTML parse),
  p-limit (concurrency), zod (validation), tsx (run TS). Don't reinvent these.
- No boilerplate, no defensive over-engineering, no try/catch on everything —
  only where failure is expected (network, DB).
- No tests, no README, no comments unless I ask. This is a solo MVP.
- TypeScript, ESM, small single-purpose files.

## How to respond — SAVE TOKENS
- No long explanations. One or two lines max before/after code.
- Don't restate my request back to me. Don't summarize what you just did.
- Don't print full files after editing — show only the changed lines / a diff.
- Ask before installing anything heavy or scaffolding a framework.
- Do ONE phase at a time. Stop and wait after each phase.

## Guardrails
- Compliance rules in the spec (§2) are hard requirements — encode them, never skip.
- Never invent offer facts (courses/fees); those come from a fixed context block.