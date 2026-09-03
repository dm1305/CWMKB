-- 0001_wines.sql
-- Wines and their normalised child tables.
--
-- Built by inspecting the real W array in cwm-knowledge-base-patched.html
-- (1,513 records), not by guessing at a schema. Every column below maps to
-- a field observed in that data. Where a field's MEANING was not obvious
-- from the data alone, it is included (never dropped) but flagged below,
-- per the project rule: ask rather than assume.
--
-- NOT YET APPLIED. Review before running `supabase db push`.

-- ============================================================
-- OPEN QUESTION 1, blocking: no stable identifier
-- ============================================================
-- The source data has no product code or SKU. `id` below is a fresh
-- uuid generated on import. That is fine for a one-off load, but it means
-- a second import of the same spreadsheet would create 1,513 NEW rows
-- rather than updating the existing ones, because there is nothing to
-- match on.
--
-- Cambridge Wine's own product pages carry a "Product Code" (e.g. 969037
-- seen on the Estaca page). If that code exists in the PIM export, it
-- should populate `source_key` and become the real match key for future
-- imports. Left nullable and unused until confirmed.

-- ============================================================
-- OPEN QUESTIONS 2 to 4, non-blocking: three fields of unconfirmed meaning
-- ============================================================
-- chase              int, populated on 1437/1513. Values seen: 1, 2.
--                     Meaning not established from the data. Possibly a
--                     buying/re-order priority code. Kept as-is.
-- prestige            bool, populated on 156/1513 (all true where present).
--                     Reads like a flagship/prestige-cuvee flag but that is
--                     a guess at intent, not a confirmed one.
-- vintage_chart_key   text (was `vrow`), populated on 698/1513, values like
--                     "Priorat|Garnacha and Cariñena". This matches the
--                     pipe-delimited region|style lookup key pattern used
--                     elsewhere in the site's vintage chart code, so it is
--                     very likely a join key into the vintage assessments
--                     table, not a free-text field. Inferred from code,
--                     not confirmed by you, so noted rather than enforced
--                     as a foreign key.
--
-- None of these block the migration. They are typed losslessly below and
-- can be renamed or constrained once confirmed.

create table wines (
  id                 uuid primary key default gen_random_uuid(),
  source_key         text,                    -- see Open question 1
  name               text not null,
  producer           text,
  category           text,                    -- e.g. 'Red Wine', 'White Wine'
  colour             text,                    -- e.g. 'Red', 'White'
  style              text,                    -- key into the site's GLASS style map
  format             text,                    -- e.g. '75cl', as printed on site
  ml                 integer,                 -- assumed millilitres from the field name
  vintage            integer,
  nv                 text,                    -- literal 'NV' when non-vintage, else null
  price              numeric(8,2),
  was                numeric(8,2),            -- previous price, for a shown discount
  price_per_6        numeric(8,2),            -- was `p6`, case-of-6 unit price
  price_per_12       numeric(8,2),            -- was `p12`, case-of-12 unit price
  stock              integer,
  in_bond            boolean not null default false,
  dosage             text,                    -- sparkling wines only, e.g. 'Brut Nature'
  tags               text[],                  -- e.g. {Organic, "Old vine"}
  missing_fields     text[],                  -- computed list, drives "not on file" badges
  chase              integer,                 -- see Open question 2
  prestige           boolean,                 -- see Open question 3
  vintage_chart_key  text,                    -- see Open question 4, was `vrow`
  grape_tier         text check (grape_tier in ('VERIFIED','STATED','APPELLATION','HOUSE','GAP')),
  origin_country     text,
  origin_region      text,
  origin_sub_region  text,
  origin_village     text,
  origin_climate     text,
  origin_soil        text,
  description        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column wines.chase is
  'Meaning not confirmed. See migration header. Do not build logic on this until reviewed.';
comment on column wines.prestige is
  'Meaning not confirmed. See migration header. Do not build logic on this until reviewed.';
comment on column wines.vintage_chart_key is
  'Inferred to be a join key into the vintage assessments table. Not confirmed. See migration header.';
comment on column wines.source_key is
  'No source populates this yet. Intended for a stable CWM product code once one is confirmed available.';

create index wines_name_idx on wines using gin (to_tsvector('english', name));
create index wines_style_idx on wines (style);
create index wines_price_idx on wines (price);
create index wines_source_key_idx on wines (source_key);

-- One row per grape in the breakdown. `wines.grape_tier` carries the
-- provenance for the WHOLE breakdown (matches the site's existing
-- convention: one tier per wine, not one per grape).
create table wine_grapes (
  id          bigint generated always as identity primary key,
  wine_id     uuid not null references wines(id) on delete cascade,
  grape_name  text not null,
  percentage  numeric(5,2),
  position    smallint not null default 0   -- preserves original listing order
);

create index wine_grapes_wine_idx on wine_grapes (wine_id);
create index wine_grapes_name_idx on wine_grapes (grape_name);

-- Pre-built search links to critic sites (Jancis Robinson, Decanter, Vinous,
-- Wine-Searcher), populated on all 1,513 wines. These are search URLs, not
-- scores; nothing here is a critic score or a citation of one.
create table wine_critic_links (
  id          bigint generated always as identity primary key,
  wine_id     uuid not null references wines(id) on delete cascade,
  critic_name text not null,
  search_url  text,
  usage_note  text
);

create index wine_critic_links_wine_idx on wine_critic_links (wine_id);

-- Real citations: source name, URL, date checked. Matches the project's
-- own citation rule exactly. Only 40/1513 wines carry one today; the
-- source field was a single object, promoted here to one-to-many since a
-- single wine will plausibly need more than one citation over time (one
-- for ABV, one for an image, and so on). Worth confirming this is the
-- intended shape.
create table wine_sources (
  id            bigint generated always as identity primary key,
  wine_id       uuid not null references wines(id) on delete cascade,
  source_name   text not null,
  source_url    text,
  date_checked  date
);

create index wine_sources_wine_idx on wine_sources (wine_id);

-- Deliberately NOT created here: a critic SCORES table (distinct from the
-- search links above). `critics` is an empty array on all 1,513 current
-- records, so there is no real example to model a schema from. Per the
-- project rule against guessing, this is deferred until at least one
-- populated example exists to design against, rather than shipping an
-- invented shape now.
