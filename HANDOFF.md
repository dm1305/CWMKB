# CWM Knowledge Base, handoff to Claude Code

Written 3 September 2026, end of a long claude.ai session, for picking this up cold in a
new environment with none of that session's context. Everything below is checked against
actual tool output from that session, not recalled from memory. Where something is genuinely
unconfirmed, it's marked as such rather than stated as fact.

## What this is

Cambridge Wine Merchants (CWM) is building a staff-facing knowledge base: 1,513 wines,
spirits and beer/cider reference data, regional vintage charts, a glossary, staff training
modules, and an AI "Ask" feature backed by the Anthropic API. David has decision-making
authority over its direction, including buying, training, and compliance content. Longer
term, there's an ambition to turn this into a SaaS product for other wine merchants, though
the architecture needs real changes before that's realistic, this isn't imminent.

## What we're trying to achieve

The target architecture, agreed early and not yet fully built:

- **Supabase is the only source of truth for data.** Wines, spirits, beer/cider, regions,
  glossary, vintage scores. Nothing hard-coded into the site.
- **GitHub is the only source of truth for code.** Site templates, build scripts, Edge
  Functions, and the schema itself as versioned migrations under `supabase/migrations/`.
- **A change to either should flow through automatically.** A GitHub Action rebuilds on
  push, a Supabase webhook rebuilds on data change. Nobody manually copies data into a
  template or manually redeploys.

None of that automation exists yet. What's live today is the old architecture: a single
HTML file with all data embedded as JS constants, hand-downloaded and hand-deployed.

## Non-negotiable working rules, carry these forward

These came from David directly and shaped every decision in the prior session. They should
keep shaping this one.

- **Never guess.** Don't invent, estimate, or infer a fact (ABV, grape %, region, tasting
  note, price, stock, anything) that isn't in the source data or confirmed by David. Missing
  means null and flagged, not filled with something plausible.
- **Grape breakdowns carry a provenance tier**: VERIFIED, APPELLATION, STATED, HOUSE, or GAP.
  Never upgrade a tier without a cited source. Never state a fact more confidently than its
  tier allows.
- **Every added field or citation needs its source**: name, URL, date checked.
- **Write real code for data work, never hand-transcribe.** 1,500+ wines means manual
  transcription is exactly how unverified guesses creep in.
- **Show destructive or hard-to-reverse code before running it** against production,
  schema changes, bulk inserts or updates.
- **When a field's meaning isn't obvious, ask, don't assume.** This came up repeatedly with
  internal-looking fields in the source data, see Open questions below.
- **Never average critic scores across incompatible scales.**
- **Spirits data stays structurally separate from wine data.**

## How the current build works

`current-build/cwm-knowledge-base.html` in this package is the interim, currently-live
architecture. All data is embedded as JS constants (`W` for wines, `COUNTRIES`, `GLOSS`,
`TR` for training, `REGIONS`/`LIC` for vintage scores). Opening it loads the entire
knowledge base into memory, that's also why it's 2.6MB and why anyone with view-source
gets everything, cost tiers included.

**The Ask feature retrieves before it asks.** A local `retrieve(question)` function scores
the question against the embedded data (name weighted highest, then origin, then style,
then description) and builds a plain-text extract of the best matches, typically 4,000 to
12,000 characters. Only that extract, plus the system prompt and a capped conversation
history, goes to `api.anthropic.com`. Nothing is uploaded, indexed, or stored anywhere else.
A "Records it read" panel in the UI is generated from the same `used` array the model was
actually given, not from the model's own claims, so it can't misreport its sources.

**Phase 2 retrieval improvements**, built and verified this session, `scripts/patch_ai.py`
applies these to a base file:

- Accent folding (`Semillon` now reaches the 16 `Sémillon` wines, previously zero)
- Grape synonyms (`Shiraz` reaches `Syrah`'s 162 wines; deliberately excludes `Petite Sirah`
  from mapping to Syrah, since it's actually Durif, and `Auxerrois`, which means Malbec in
  Cahors but is a different, genuine Alsace grape in this range)
- Phrase-aware matching (`Pinot Grigio` no longer returns all 209 Pinot Noir wines by
  matching the word "Pinot" alone)
- Region-to-grape hints (Rioja widens to Tempranillo, tagged TYPICAL not REQUIRED, since
  appellation law doesn't mandate it the way Chablis mandates Chardonnay)
- Recommendation spread: 3 to 6 wines, capped at 2 per style bucket, spread across the
  price range rather than clustered at the budget ceiling
- Budget parsing (under/over/around/between)

Verified by `scripts/test_ai.js`, a 46-test jsdom suite. **Confirmed passing right now**,
not a stale claim: `46 passed, 0 failed`, re-run immediately before writing this document.
Needs `npm install jsdom` before running.

**Deliberately not attempted: acidity, body, tannin.** Checked directly against all 1,513
descriptions before building anything, they contain zero sensory content, they're generated
purely from origin, grape, and appellation text. An early attempt to parse "acidity" from
them returned 231 hits that were all the substring inside "limestone". Style bucket plus
grape is the weight axis instead. If real tasting-note data ever exists, this is worth
revisiting, but don't infer it from grape or region, that's exactly the kind of confident
guess this project exists to avoid.

**The Ask feature's API call is still client-side and direct.** It calls
`api.anthropic.com` from the browser with a pasted-in key field. It has not been switched
to call the Edge Function below. That switch is a real next step, not done.

## What's been built toward the target architecture, and its true status

Precise on purpose, "written" and "applied" are not the same thing and got confused more
than once in the prior session.

**Supabase**: project created, `cwm-knowledge-base`, ref `jhixcmtbigyjqhjtiaik`,
`eu-west-1`, org `dkxfrtzosrnwrptaddic`, confirmed `ACTIVE_HEALTHY`, £0/month on the
current plan. **Confirmed empty**: no tables, no deployed function, no secrets set, no auth
configured. Confirmed via `list_edge_functions` returning `[]` as the most recent check.

**Three migrations exist in `supabase/migrations/`, none applied**:
- `0001_wines.sql`, wines plus normalised `wine_grapes`, `wine_critic_links`, `wine_sources`
  tables, built from the real field shapes in the actual 1,513-record data, not guessed
- `0002_grape_reference.sql`, `grape_synonyms` and `region_grapes`, seed data extracted
  programmatically from the tested, running JS in the HTML build, not retyped by hand, so
  the two systems can't drift apart on day one
- `0003_training_completions.sql`, append-only by construction: RLS enabled, insert and
  select policies for a user's own rows, deliberately **no update or delete policy at all**.
  That absence is the actual control, it's what makes a record here usable as compliance
  evidence rather than a client-side flag anyone could alter. Depends on auth existing first

**Edge Function exists at `supabase/functions/ask/index.ts`, not deployed.** Holds the
Anthropic key server-side once it is. Fails closed on purpose: returns 503 if
`ANTHROPIC_API_KEY` or `CWM_SYSTEM_PROMPT` isn't set, rather than answering without the
integrity rules loaded. Model is allowlisted and pinned server-side, `max_tokens` capped,
so an authenticated login can't become unmetered API access.

**The original Anthropic API key was exposed in a deployed public HTML file and must be
treated as compromised.** Rotation and revocation status: **not confirmed done** in the
prior session, flagged repeatedly as the most urgent outstanding item, never got explicit
confirmation back that it happened. Check this first.

**GitHub: the actual open problem.** Two repos surfaced in the prior session:
- `dm1305/CWM`, private, 4 commits as last seen. Had a duplicate-nesting problem, a zip
  dragged in as a folder rather than extracted, and migrations very likely missing from
  the real path as a result. Never reconfirmed fixed.
- `dm1305/CWMKB`, public, 1 commit as last seen. Structure was directly verified correct via
  screenshot, all three migrations in the right path, function in the right path, HTML
  build in the right path.

David stated explicitly: **"the project is not held in CWMKB."** He was asked twice which
repo is the real one and never answered before this handoff was requested. This is the
single most important thing to resolve before doing anything else GitHub-related. Don't
assume either repo is current without asking.

**Cloudflare**: a Pages project exists and is deployed, per David directly, name not
recorded. Cloudflare Access setup was in progress, walked through a manual Zero Trust
Access Application pointed at the production hostname specifically, since Cloudflare's own
one-click "enable access policy" toggle only covers preview deployment links, not the real
`*.pages.dev` production URL, confirmed against Cloudflare's current docs, not assumed.
**Not confirmed complete.** The last step given was to verify it in a private browser
window; no confirmation came back either way.

## Open questions, don't resolve these by guessing

- **No stable product code exists on any wine.** The source spreadsheet has no ID that
  survives a re-import. `source_key` is null on every row. Cambridge Wine's own product
  pages show a "Product Code" per wine (e.g. 969037 seen on the Estaca page); if the PIM
  export carries it, that should become the real match key. Without it, re-running an
  import creates duplicate rows rather than updating existing ones.
- **Three fields of unconfirmed meaning** in the source data: `chase` (int, populated on
  1,437/1,513, values seen are 1 and 2, purpose unknown), `prestige` (bool, 156/1,513, reads
  like a flagship-cuvée flag but that's a guess at intent), `vintage_chart_key` (text,
  698/1,513, pattern-matches a region-plus-style lookup key used elsewhere in the vintage
  chart code, so likely a join key, but inferred from code, not confirmed by David).
- **`wine_sources` was designed as one-to-many** (a wine can have several citations) rather
  than the single-object shape the source data currently uses. Worth confirming that's the
  right call before it's load-bearing.
- **Which GitHub repo is real.** See above.

## Next steps, roughly in order

1. Confirm the Anthropic key was actually rotated and the old one revoked, check the usage
   logs on the old key for anything unrecognised while there
2. **Get a straight answer on which GitHub repo is authoritative**, and get its structure
   matching the seven-path layout below, verified, not assumed
3. Disable public signup in Supabase Auth, invite staff individually
4. Show David the three migration files fresh (they haven't changed, but "show before
   running" applies every time), then apply them: `supabase db push`
5. Set both secrets and deploy the function:
   ```
   supabase secrets set ANTHROPIC_API_KEY=... --project-ref jhixcmtbigyjqhjtiaik
   supabase secrets set CWM_SYSTEM_PROMPT="$(cat sys_prompt.txt)" --project-ref jhixcmtbigyjqhjtiaik
   supabase functions deploy ask --project-ref jhixcmtbigyjqhjtiaik
   ```
6. Point the HTML build's Ask feature at the deployed function instead of calling
   `api.anthropic.com` directly, and remove the client-side key field entirely
7. Resolve the product code question, then write a real, scripted data migration from the
   spreadsheet into the `wines` table, checking row counts before and after
8. Verify the Cloudflare Access application actually gates the live production URL, not
   just preview links, test logged out in a private window
9. Only after all of the above: revisit the templated-site build that actually reads from
   Supabase instead of embedding data, which is what makes `current-build/` deletable

## File manifest

```
HANDOFF.md                              this file
README.md                               shorter, more operational version of the above
.gitignore
current-build/
  cwm-knowledge-base.html               current live build, phase 2 improvements included
scripts/
  patch_ai.py                           applies the phase 2 retrieval changes to a base file
  test_ai.js                            46-test jsdom suite, needs `npm install jsdom` first
supabase/
  migrations/
    0001_wines.sql
    0002_grape_reference.sql
    0003_training_completions.sql
  functions/
    ask/
      index.ts
```
