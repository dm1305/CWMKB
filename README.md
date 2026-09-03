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

## Status, as of 2 September 2026

Written but not yet applied or deployed. Nothing in this repo is live.

| Piece | State |
|---|---|
| Supabase project | Created (`cwm-knowledge-base`, eu-west-1). Empty. |
| Migrations 0001 to 0003 | Written, reviewed, **not yet run** against the project |
| `supabase/functions/ask` | Written, **not yet deployed** |
| Auth (invited staff only) | Not yet configured |
| Live site rebuild on push/webhook | Not yet built. Site is currently self-hosted; how it deploys hasn't been established, and is being treated as a separate piece of work for now |

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

```bash
supabase link --project-ref jhixcmtbigyjqhjtiaik
supabase db push
```

Row counts should be checked before and after any bulk data load, per
project convention. The migrations create empty tables; loading the actual
1,513 wines is a separate, scripted step once the product code question
above is settled.

## Deploying the Edge Function

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref jhixcmtbigyjqhjtiaik
supabase secrets set CWM_SYSTEM_PROMPT="$(cat sys_prompt.txt)" --project-ref jhixcmtbigyjqhjtiaik
supabase functions deploy ask --project-ref jhixcmtbigyjqhjtiaik
```

The function fails closed: it returns 503 if either secret is missing,
rather than answering without the integrity rules in place.

## Repository layout

```
current-build/
  cwm-knowledge-base.html       the interim single-file build, see note below
supabase/
  migrations/
    0001_wines.sql              wines + grapes + critic links + sources
    0002_grape_reference.sql    synonym and region-to-grape reference data
    0003_training_completions.sql   append-only compliance records
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

**Its Ask feature still calls `api.anthropic.com` directly with a
client-side key field.** It has not been switched to the Edge Function in
this repo. Opening this file and testing the AI advisor will not exercise
`supabase/functions/ask`, and needs a valid key pasted into the page itself
to do anything. Once the key is rotated (see the earlier conversation, the
old one was exposed and should be treated as compromised) and the Edge
Function is deployed, this file's fetch call is what needs redirecting.

This file, and this note, should be deleted once the real templated site
is pulling data from Supabase and no data is hard-coded here.
