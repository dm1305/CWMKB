-- 0003_training_completions.sql
-- Training completion records. Depends on auth existing (phase 1).
--
-- The fix for the audit finding that completion records currently have no
-- evidentiary value: a client-side flag can be set by anyone, so it proves
-- nothing. This table is append-only by construction, not by policy that
-- could be turned off. Read the comment on the missing update/delete
-- policies below; the ABSENCE of those policies is the actual control.
--
-- NOT YET APPLIED. Review before running `supabase db push`. Depends on
-- Supabase Auth being configured first (public signup disabled, staff
-- invited individually).

create table training_completions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  module_id     text not null,
  completed_at  timestamptz not null default now(),  -- server clock, never client-supplied
  score         integer,
  answers       jsonb                                 -- what they actually answered, not just pass/fail
);

comment on table training_completions is
  'Append-only by construction. See migration comments before adding any update or '
  'delete policy: their absence is what makes a record here usable as compliance evidence.';

alter table training_completions enable row level security;

create policy staff_insert_own on training_completions
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy staff_read_own on training_completions
  for select to authenticated
  using (auth.uid() = user_id);

-- Deliberately no update policy and no delete policy on this table.
--
-- RLS default-denies any operation with no matching policy. Because no
-- update or delete policy exists, a completion record cannot be altered
-- or removed by any authenticated user, including an administrator using
-- the anon key. That is the control. Adding either policy later, even a
-- narrowly scoped one, would remove it, so do not add one without first
-- deciding how that is meant to coexist with using this table as evidence.

-- A manager-read-across-staff policy is a reasonable future addition, but
-- needs a role claim on the user (e.g. a custom claim or a separate
-- `staff_roles` table) that does not exist yet. Left out of this migration
-- rather than guessed at.
