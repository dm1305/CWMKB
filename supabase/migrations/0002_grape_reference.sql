-- 0002_grape_reference.sql
-- Grape synonyms and region-to-grape reference data.
--
-- This is reference data, not inference: "Shiraz" and "Syrah" are the same
-- grape as a matter of fact, and Chablis being Chardonnay is fixed by
-- appellation law. Widening a search on this basis is not guessing.
--
-- The seed data below was extracted from the running GSYN and RGRAPE
-- objects inside the already-tested cwm-knowledge-base.html (46 passing
-- jsdom tests), not retyped by hand, so the two systems cannot drift apart
-- on day one. If the client-side table is edited later, regenerate this
-- file from it rather than editing both by hand.
--
-- NOT YET APPLIED. Review before running `supabase db push`.

create table grape_synonyms (
  term       text primary key,   -- lowercase, as a member of staff would type it
  canonical  text not null       -- the name as stored in wine_grapes.grape_name
);

comment on table grape_synonyms is
  'Alternate names and regional synonyms for grapes already present in the wine range. '
  'Widens matching only; never used to populate a wine''s own grape_name.';

-- REQUIRED: appellation law fixes this grape. May be stated as fact.
-- TYPICAL:  the norm, not the rule. Must be hedged when surfaced in an answer.
create table region_grapes (
  region      text not null,
  grape       text not null,
  confidence  text not null check (confidence in ('REQUIRED', 'TYPICAL', 'PERMITTED')),
  primary key (region, grape)
);

comment on table region_grapes is
  'Appellation or regional grape association. Widens search only. REQUIRED rows may be '
  'stated as fact; TYPICAL rows must be hedged, matching the wording already used in the '
  'site''s AI advisor prompt.';

-- Deliberately excluded from this table, so the exclusions are not lost to
-- a future editor:
--   'sirah'      - Petite Sirah is Durif, a distinct grape from Syrah
--   'auxerrois'  - means Malbec in Cahors, but is a different, distinct
--                   Alsace white grape in this range
--   'grenache'   - left to plain word matching; Grenache Blanc and
--                   Grenache Gris are both in the range and a bare
--                   "Grenache" synonym would misdirect toward Grenache Noir


-- Seed data, extracted 2026-09-02 from the tested client-side GSYN/RGRAPE tables

insert into grape_synonyms (term, canonical) values
  ('shiraz', 'Syrah'),
  ('garnacha', 'Grenache Noir'),
  ('garnacha tinta', 'Grenache Noir'),
  ('cannonau', 'Grenache Noir'),
  ('garnacha blanca', 'Grenache Blanc'),
  ('pinot grigio', 'Pinot Gris'),
  ('grauburgunder', 'Pinot Gris'),
  ('rulander', 'Pinot Gris'),
  ('pinot nero', 'Pinot Noir'),
  ('spatburgunder', 'Pinot Noir'),
  ('blauburgunder', 'Pinot Noir'),
  ('zinfandel', 'Primitivo'),
  ('tinta roriz', 'Tempranillo'),
  ('aragonez', 'Tempranillo'),
  ('tinto fino', 'Tempranillo'),
  ('tinta del pais', 'Tempranillo'),
  ('cencibel', 'Tempranillo'),
  ('ull de llebre', 'Tempranillo'),
  ('monastrell', 'Mourvedre'),
  ('mataro', 'Mourvedre'),
  ('pinot meunier', 'Meunier'),
  ('steen', 'Chenin Blanc'),
  ('alvarinho', 'Albarino'),
  ('cot', 'Malbec'),
  ('auxerrois du lot', 'Malbec'),
  ('carinena', 'Carignan'),
  ('mazuelo', 'Carignan'),
  ('samso', 'Carignan'),
  ('carignan noir', 'Carignan'),
  ('brunello', 'Sangiovese'),
  ('prugnolo gentile', 'Sangiovese'),
  ('morellino', 'Sangiovese'),
  ('spanna', 'Nebbiolo'),
  ('chiavennasca', 'Nebbiolo'),
  ('trebbiano', 'Ugni Blanc'),
  ('weissburgunder', 'Pinot Blanc'),
  ('macabeu', 'Macabeo'),
  ('viura', 'Macabeo');

insert into region_grapes (region, grape, confidence) values
  ('chablis', 'Chardonnay', 'REQUIRED'),
  ('sancerre', 'Sauvignon Blanc', 'REQUIRED'),
  ('pouilly-fume', 'Sauvignon Blanc', 'REQUIRED'),
  ('barolo', 'Nebbiolo', 'REQUIRED'),
  ('barbaresco', 'Nebbiolo', 'REQUIRED'),
  ('chianti', 'Sangiovese', 'REQUIRED'),
  ('brunello di montalcino', 'Sangiovese', 'REQUIRED'),
  ('muscadet', 'Melon de Bourgogne', 'REQUIRED'),
  ('prosecco', 'Glera', 'REQUIRED'),
  ('gavi', 'Cortese', 'REQUIRED'),
  ('beaujolais', 'Gamay', 'REQUIRED'),
  ('cahors', 'Malbec', 'REQUIRED'),
  ('vouvray', 'Chenin Blanc', 'REQUIRED'),
  ('hermitage', 'Syrah', 'REQUIRED'),
  ('cote-rotie', 'Syrah', 'REQUIRED'),
  ('rioja', 'Tempranillo', 'TYPICAL'),
  ('soave', 'Garganega', 'TYPICAL'),
  ('valpolicella', 'Corvina', 'TYPICAL'),
  ('valpolicella', 'Rondinella', 'TYPICAL'),
  ('chateauneuf-du-pape', 'Grenache Noir', 'TYPICAL'),
  ('rias baixas', 'Albarino', 'TYPICAL'),
  ('marlborough', 'Sauvignon Blanc', 'TYPICAL'),
  ('champagne', 'Chardonnay', 'TYPICAL'),
  ('champagne', 'Pinot Noir', 'TYPICAL'),
  ('champagne', 'Meunier', 'TYPICAL');
