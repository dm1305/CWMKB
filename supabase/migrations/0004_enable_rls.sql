-- 0004_enable_rls.sql
-- Six tables were created by RLS-disabled default: wines, wine_grapes,
-- wine_critic_links, wine_sources, grape_synonyms, region_grapes. The
-- Supabase security advisor flagged all six as fully exposed to the anon
-- role, meaning anyone with the public anon key could read or write every
-- row, including full pricing and cost tiers.
--
-- Staff-facing knowledge base, invite-only auth (no public signup): only
-- authenticated staff may read. No client-side writes are expected; data
-- loads happen via the service role key from admin scripts, which bypasses
-- RLS entirely, so no insert/update/delete policy is added here.
--
-- APPLIED to jhixcmtbigyjqhjtiaik on 2026-09-04. Security advisor confirmed
-- clean (no lints) immediately after.

alter table wines enable row level security;
alter table wine_grapes enable row level security;
alter table wine_critic_links enable row level security;
alter table wine_sources enable row level security;
alter table grape_synonyms enable row level security;
alter table region_grapes enable row level security;

create policy staff_read on wines for select to authenticated using (true);
create policy staff_read on wine_grapes for select to authenticated using (true);
create policy staff_read on wine_critic_links for select to authenticated using (true);
create policy staff_read on wine_sources for select to authenticated using (true);
create policy staff_read on grape_synonyms for select to authenticated using (true);
create policy staff_read on region_grapes for select to authenticated using (true);
