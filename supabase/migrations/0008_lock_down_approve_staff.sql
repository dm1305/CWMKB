-- 0008_lock_down_approve_staff.sql
-- Postgres grants EXECUTE on new functions to PUBLIC by default. Left as-is,
-- approve_staff() (security definer, bypasses RLS) would let any signed-up,
-- still-unapproved account call it via RPC and approve themselves - the
-- exact thing the approval gate exists to prevent. The SQL Editor runs as a
-- privileged role and is unaffected by this revoke, which is the only
-- intended way to call this function.
--
-- APPLIED to jhixcmtbigyjqhjtiaik on 2026-09-04. Verified after applying:
-- has_function_privilege('authenticated', 'approve_staff(uuid)', 'execute')
-- and the same for 'anon' both return false.
revoke execute on function approve_staff(uuid) from public;
revoke execute on function approve_staff(uuid) from authenticated;
revoke execute on function approve_staff(uuid) from anon;
