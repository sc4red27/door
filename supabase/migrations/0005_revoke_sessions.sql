-- =============================================================================
-- 0005_revoke_sessions.sql   (PROPOSAL - not yet applied, app code not wired)
--
-- H1b  When an admin resets a password, every session of that user must end,
--      otherwise someone who took over the account keeps it (and, because a
--      reset puts the account back into first-sign-in mode, could set a new
--      email and password again).
--
-- Supabase's admin API cannot sign out a user by id; it can only sign out
-- the holder of a given JWT. This function deletes the user's sessions
-- (their refresh tokens go with them via ON DELETE CASCADE), so no session
-- can be renewed. Access tokens already issued stay valid until they expire
-- (1 hour by default); the app re-checks the session with the Auth server
-- before password and email changes, so those tokens cannot be used for that.
--
-- Callable only by the service role (the server, after its admin check).
-- After approval, src/actions/admin.ts resetPassword will call it and report
-- failure if it fails.
-- =============================================================================

begin;

create or replace function public.revoke_user_sessions(p_user uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

commit;

-- Rollback:
--   drop function if exists public.revoke_user_sessions(uuid);
-- Sessions deleted while the function existed cannot be restored; affected
-- users simply sign in again.
-- =============================================================================
