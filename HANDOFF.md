# CWM Knowledge Base, handoff to Claude Code

Rewritten 4 September 2026. The previous version of this file (3 September) described a
much earlier state — unresolved GitHub repo ambiguity, unapplied migrations, invite-only
auth, no wine data loaded. All of that has changed. Checked against actual tool output
in this session, not recalled from memory.

## What this is

Cambridge Wine Merchants (CWM) staff-facing knowledge base: wines, spirits, beer/cider
reference data, regional vintage charts, a glossary, staff training modules, and an AI
"Ask" feature backed by the Anthropic API. David has decision-making authority over its
direction. Longer term there's an ambition to turn this into a SaaS product for other
wine merchants; the architecture needs real changes before that's realistic, and it isn't
imminent.

## Non-negotiable working rules, carry these forward

- **Never guess.** Don't invent, estimate, or infer a fact (ABV, grape %, region, tasting
  note, price, stock, anything) that isn't in the source data or confirmed by David.
  Missing means null and flagged, not filled with something plausible.
- **Grape breakdowns carry a provenance tier**: VERIFIED, APPELLATION, STATED, HOUSE, or
  GAP. Never upgrade a tier without a cited source.
- **Write real code for data work, never hand-transcribe.**
- **Show destructive or hard-to-reverse code before running it** against production.
- **When a field's meaning isn't obvious, ask, don't assume.**
- **Never average critic scores across incompatible scales.**
- **Spirits data stays structurally separate from wine data.**

## Current real state

**Supabase** (`cwm-knowledge-base`, ref `jhixcmtbigyjqhjtiaik`, eu-west-1): schema applied
through migration 0008, RLS on every table, fully populated — 1,513 wines, 1,669 grapes,
6,052 critic links, 40 sources, plus grape/region reference data. `supabase/functions/ask`
is deployed (`verify_jwt: true`) but still 503s: `ANTHROPIC_API_KEY` and
`CWM_SYSTEM_PROMPT` secrets are not set yet. Only David can set them — entering an API key
is something Claude will not do even if asked directly.

**Auth model changed from the original plan.** Invite-only (Supabase sending invite/
recovery emails) was tried first and abandoned: the built-in mail sender's ~2/hour rate
limit, GoTrue redirect quirks, and an email security scanner pre-consuming one-time links
made it too unreliable to keep debugging live. Replaced with **self-service sign-up gated
by admin approval**: anyone can create an account, but `staff_profiles.approved_at` must
be set before RLS grants read access to any wine data. Approve via the Supabase SQL
Editor: `select approve_staff('<user_id>');` — this function is deliberately locked down
so a signed-up-but-unapproved account can't call it on themselves via RPC. "Confirm email"
is still on in Auth settings as of this writing, meaning sign-up still triggers an email
round-trip; turning it off makes sign-up instant.

**GitHub**: `dm1305/CWMKB` is confirmed authoritative and is what this working copy
tracks. The other repo seen in an earlier session (`dm1305/CWM`) still exists but is not
the one being worked on.

**Hosting**: live at `https://cwm-knowledge-base.pages.dev` (Cloudflare Pages, deployed
via `wrangler pages deploy`, no CI/CD wiring it to git yet). **No Cloudflare Access in
front of it.** The page's sign-in gate is a client-side UX layer only — the wine/pricing
data is still embedded as JS constants in `current-build/cwm-knowledge-base.html` and
fully readable via view-source regardless of the login screen. This was true when the
file held fake placeholder-shaped data; it matters a great deal more now that it holds
the real 1,513-record catalogue. Setting up Access is the actual fix and is not done.

**Tests**: `scripts/test_ai.js` (46 tests, retrieval/grape-matching logic) and
`scripts/test_auth.js` (18 tests, the sign-up/approval flow) both pass. A GitHub Action
(`.github/workflows/test.yml`) runs both on every push/PR to `main`. It does not deploy
anything — no Cloudflare API token is configured as a repo secret, and setting one up is
also on David, not Claude.

## The one open architectural question that actually matters now

**The live site doesn't read from Supabase for content.** Every tab (Wines, Regions,
Vintage Charts, Glossary, Ask retrieval) still runs off the `W`/`COUNTRIES`/`GLOSS`/`TR`
constants embedded in the HTML file, not the database. The whole point of the Supabase
migration was "Supabase is the only source of truth for data" — that's not true yet in
practice, even though the data itself is now correct and complete in Supabase. Building
the real templated site that queries Supabase directly (making `current-build/` deletable)
is the next big piece of work, treated as separate from incremental fixes because of its
size — confirm with David before starting it, don't just fold it into a smaller task.

## Other known open items, roughly by priority

1. Confirm-email toggle + first account approval (David, dashboard)
2. Edge Function secrets (David, terminal — see above)
3. Cloudflare Access on the production hostname (David, dashboard)
4. Real SMTP provider for Supabase Auth — now optional, since sign-up doesn't need email
   once Confirm Email is off; only matters for password-reset UX at real staff scale
5. `wine_sources` is one-to-many in schema but only 40/1513 wines have one populated;
   fine as designed, just noted
6. No stable product code in the source data (still true, still not solved by guessing —
   see `0001_wines.sql`'s own comments). Wine data load was a one-time script
   (`scripts/migrate_wines.py`), not an upsert; re-running it against a populated table
   duplicates every row

## File manifest

```
HANDOFF.md                              this file
README.md                               shorter, more operational version of the above
.github/workflows/test.yml              runs both test suites on push/PR
current-build/
  cwm-knowledge-base.html               current live build, deployed to Cloudflare Pages
scripts/
  patch_ai.py                           applies the phase 2 retrieval changes to a base file
  test_ai.js                            46-test suite, retrieval logic
  test_auth.js                          18-test suite, sign-up/approval flow
  migrate_wines.py                      one-time wine data load (already run)
supabase/
  migrations/
    0001_wines.sql .. 0008_lock_down_approve_staff.sql
  functions/
    ask/
      index.ts                          Anthropic proxy, deployed, secrets not set
```
