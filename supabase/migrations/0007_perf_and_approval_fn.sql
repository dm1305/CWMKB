-- 0007_perf_and_approval_fn.sql
-- Three cleanups from a full-project review, all flagged by Supabase's own
-- advisor except the approve_staff() function:
--
-- 1. Every RLS policy called auth.uid() directly, which Postgres
--    re-evaluates per row instead of once per query. Wrapping as
--    (select auth.uid()) lets the planner treat it as a stable
--    subquery. Same access rules, just faster at scale.
-- 2. Two foreign keys had no covering index: staff_profiles.approved_by
--    and training_completions.user_id.
-- 3. staff_profiles.approved_by never actually got set by anything -
--    approvals happened by hand in Table Editor, which has no way to
--    know to fill it in. approve_staff() sets approved_at and
--    approved_by together in one call.
--
-- APPLIED to jhixcmtbigyjqhjtiaik on 2026-09-04. See 0008 for a follow-up
-- fix to this function's default privileges.

drop policy staff_insert_own on training_completions;
drop policy staff_read_own on training_completions;
create policy staff_insert_own on training_completions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy staff_read_own on training_completions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy self_read on staff_profiles;
drop policy self_insert on staff_profiles;
create policy self_read on staff_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy self_insert on staff_profiles for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy staff_read on wines;
drop policy staff_read on wine_grapes;
drop policy staff_read on wine_critic_links;
drop policy staff_read on wine_sources;
drop policy staff_read on grape_synonyms;
drop policy staff_read on region_grapes;

create policy staff_read on wines for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = (select auth.uid()) and sp.approved_at is not null));
create policy staff_read on wine_grapes for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = (select auth.uid()) and sp.approved_at is not null));
create policy staff_read on wine_critic_links for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = (select auth.uid()) and sp.approved_at is not null));
create policy staff_read on wine_sources for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = (select auth.uid()) and sp.approved_at is not null));
create policy staff_read on grape_synonyms for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = (select auth.uid()) and sp.approved_at is not null));
create policy staff_read on region_grapes for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = (select auth.uid()) and sp.approved_at is not null));

create index staff_profiles_approved_by_idx on staff_profiles (approved_by);
create index training_completions_user_id_idx on training_completions (user_id);

create or replace function approve_staff(target_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update staff_profiles
  set approved_at = now(), approved_by = auth.uid()
  where user_id = target_user_id;
$$;

comment on function approve_staff is
  'Run from the Supabase SQL Editor as an admin: select approve_staff(''<user_id>'');
   Sets approved_at and approved_by together, instead of editing approved_at
   alone in Table Editor and leaving approved_by null forever.';
