-- 0005_staff_approval.sql
-- Self-service sign-up replaces the invite-only model, but read access to
-- wines/reference data still requires an admin to approve the account
-- first. A session alone is no longer sufficient.
--
-- APPLIED to jhixcmtbigyjqhjtiaik on 2026-09-04. Security advisor showed
-- no new critical/RLS findings immediately after.

create table staff_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  requested_at timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  uuid references auth.users(id)
);

comment on table staff_profiles is
  'Tracks admin approval for self-signed-up accounts. No update/delete
   policy for the authenticated role: approval is granted by an admin
   directly in the Supabase dashboard (service role bypasses RLS), not
   through the app, matching training_completions append-only pattern.';

alter table staff_profiles enable row level security;

create policy self_read on staff_profiles for select to authenticated using (auth.uid() = user_id);
create policy self_insert on staff_profiles for insert to authenticated with check (auth.uid() = user_id);

drop policy staff_read on wines;
drop policy staff_read on wine_grapes;
drop policy staff_read on wine_critic_links;
drop policy staff_read on wine_sources;
drop policy staff_read on grape_synonyms;
drop policy staff_read on region_grapes;

create policy staff_read on wines for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = auth.uid() and sp.approved_at is not null));
create policy staff_read on wine_grapes for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = auth.uid() and sp.approved_at is not null));
create policy staff_read on wine_critic_links for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = auth.uid() and sp.approved_at is not null));
create policy staff_read on wine_sources for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = auth.uid() and sp.approved_at is not null));
create policy staff_read on grape_synonyms for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = auth.uid() and sp.approved_at is not null));
create policy staff_read on region_grapes for select to authenticated using (
  exists (select 1 from staff_profiles sp where sp.user_id = auth.uid() and sp.approved_at is not null));
