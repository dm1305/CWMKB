# Cambridge Wine Merchants Knowledge Base

Staff-facing wine, spirits, and beer/cider knowledge base and AI advisor.

## Source of truth

- **Supabase** holds the data: wines, spirits, beer/cider, regions, glossary,
  vintage scores. No content is hard-coded into the site.
- **This repo** holds the code: site templates, build scripts, Edge
  Functions, and the schema itself as versioned migrations under
  `supabase/migrations/`.

A change to either should flow through to the live site automatically. That
automation does not exist yet; see Status below.

## Status, as of 4 September 2026

Schema, data, Edge Function, auth and hosting are all live.

| Piece | State |
|---|---|
| Supabase project | `cwm-knowledge-base`, eu-west-1. Schema applied, RLS on, populated. |
| GitHub | `dm1305/CWMKB` is the authoritative repo, this working copy tracks it |
| Migrations 0001 to 0006 | **Applied.** 0004 enables RLS; 0005 adds `staff_profiles` approval-gated access; 0006 changes `wines.stock` to text (real values like "120+" aren't integers) |
| Wine data | **Loaded.** All 1,513 wines + 1,669 grapes + 6,052 critic links + 40 sources, via `scripts/migrate_wines.py`. One-time load, re-running it against a non-empty `wines` table will duplicate every row — see the product-code note below |
| `supabase/functions/ask` | **Deployed**, `verify_jwt: true`. Still 503s until `ANTHROPIC_API_KEY` / `CWM_SYSTEM_PROMPT` secrets are set |
| Auth | **Self-service sign-up, gated by admin approval** (not invite-only — that was reversed after the Supabase invite/recovery email flow proved too unreliable to keep debugging; see `staff_profiles`). Approve new accounts in the Supabase dashboard's Table Editor by setting `approved_at`. "Confirm email" still needs disabling in Auth settings for sign-up to be instant rather than another email round-trip |
| Hosting | **Live** at `https://cwm-knowledge-base.pages.dev` (Cloudflare Pages). No Cloudflare Access in front of it yet — the page's login gate is a UX layer, not real protection, since the HTML build still embeds all data client-side (see note below) |
| Live site rebuild on push/webhook | Not yet built. Deploys are manual (`wrangler pages deploy`) for now |

## Before running the migrations

Two open questions in `0001_wines.sql`, read the comments at the top of
that file:

1. **No stable product code.** The source spreadsheet has no ID that
   survives a re-import. Cambridge Wine's own site shows a "Product Code"
   per wine; if the PIM export carries it, it should become the match key.
   Without it, re-running an import creates duplicate rows rather than
   updating existing ones.
2. **Three fields of unconfirmed meaning**: `chase`, `prestige`,
   `vintage_chart_key`. Kept and typed, not dropped, but flagged rather
   than assumed.

## Running the migrations

0001 to 0006 are applied to `jhixcmtbigyjqhjtiaik` already. Any new migration
after this point:

```bash
supabase link --project-ref jhixcmtbigyjqhjtiaik
supabase db push
```

Row counts should be checked before and after any bulk data load, per
project convention.

## Loading the wine data

Already done once (see Status). To understand how, or if the data ever
needs reloading into a fresh project:

```bash
python3 scripts/migrate_wines.py > /tmp/wines_import.sql
```

Generates one-time INSERT statements for `wines`, `wine_grapes`,
`wine_critic_links` and `wine_sources` from the `W` array embedded in
`current-build/cwm-knowledge-base.html`. No upsert/match logic — the
source data has no stable product code (see below), so this is purely
additive. Running it against a non-empty `wines` table duplicates every
row rather than updating anything.

## Deploying the Edge Function

Already deployed. To redeploy after a code change, or set the secrets it's
still waiting on:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref jhixcmtbigyjqhjtiaik
supabase secrets set CWM_SYSTEM_PROMPT="$(cat sys_prompt.txt)" --project-ref jhixcmtbigyjqhjtiaik
supabase functions deploy ask --project-ref jhixcmtbigyjqhjtiaik
```

The function fails closed: it returns 503 if either secret is missing,
rather than answering without the integrity rules in place.

## Repository layout

```
HANDOFF.md                      fuller context: goals, true current status, next steps
current-build/
  cwm-knowledge-base.html       the interim single-file build, see note below
scripts/
  patch_ai.py                  applies the phase 2 retrieval changes to a base file
  test_ai.js                   46-test jsdom suite backing those changes
  migrate_wines.py             one-time wine data load, see above
supabase/
  migrations/
    0001_wines.sql              wines + grapes + critic links + sources
    0002_grape_reference.sql    synonym and region-to-grape reference data
    0003_training_completions.sql   append-only compliance records
    0004_enable_rls.sql         authenticated-only read policies on the six tables above
    0005_staff_approval.sql     staff_profiles + approval-gated read policies
    0006_stock_to_text.sql      wines.stock int -> text, real values include "120+"
  functions/
    ask/
      index.ts                  Anthropic proxy, key never reaches the browser
```

## About `current-build/cwm-knowledge-base.html`

This is not the target architecture, it's what's running today while that
architecture is built. All data (1,513 wines, regions, glossary, training
modules) is embedded as JS constants inside this one file, which is the
opposite of "Supabase is the only source of truth for data". It's included
here so the repo reflects what's actually live, and as a known-good
fallback, not as the site template to build on.

Includes the phase 2 retrieval improvements (accent folding, grape
synonyms, phrase-aware matching, region hints, recommendation spread),
verified by a 46-test jsdom suite.

**Its Ask feature now calls `supabase/functions/ask`, authenticated with
the signed-in user's session token — no client-side key field anymore.**
The whole page is gated behind sign-in (`#gate`), not just the Ask tab.
Signing up doesn't hand out access on its own: new accounts sit pending
in `staff_profiles` until an admin approves them in the dashboard.

The wine/spirits/glossary/training data is still embedded as JS constants
in this file regardless of any of that. The sign-in gate stops casual
browsing; it does not stop view-source. Real protection for this interim
build is Cloudflare Access in front of the hostname, not yet set up.

This file, and this note, should be deleted once the real templated site
is pulling data from Supabase and no data is hard-coded here.
