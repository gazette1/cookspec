-- The new-user trigger function runs as SECURITY DEFINER and must not be
-- callable through the exposed RPC surface. Flagged by the Supabase security
-- advisor at provisioning.

revoke execute on function public.handle_new_user() from anon, authenticated, public;
