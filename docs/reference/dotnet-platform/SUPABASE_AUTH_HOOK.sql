-- ============================================================================
-- Delicate Couriers — Supabase Custom Access Token Auth Hook
--
-- WHAT THIS DOES
--   Every time Supabase issues an access token (sign-in, refresh, OAuth round-
--   trip, magic-link, etc.) it calls this function with the draft JWT payload.
--   We enrich it with two top-level claims the .NET API needs:
--
--     - tenant_id : int   (which tenant this user belongs to)
--     - app_role  : text  ("User" | "Admin" | "SuperAdmin")
--
--   Source of truth is the public."User" table; we look the row up by
--   SupabaseUserId (= auth.users.id = the JWT "sub" claim). If no row exists
--   yet we fall back to whatever was stamped into raw_app_meta_data by the
--   admin-provisioning code path (SupabaseAdminService.CreateUserAsync).
--
-- HOW TO INSTALL
--   1) Run this file as the postgres role in your Supabase project (SQL editor
--      or `psql`). It is idempotent.
--   2) Supabase Dashboard -> Authentication -> Hooks -> "Custom Access Token"
--      -> select function `public.custom_access_token_hook` -> Save.
--   3) Sign out and sign in again so a fresh JWT is issued. Decode it at
--      jwt.io and confirm `tenant_id` and `app_role` are present at the top
--      level of the payload.
-- ============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims        jsonb := coalesce(event->'claims', '{}'::jsonb);
  uid           uuid  := (event->>'user_id')::uuid;
  v_tenant_id   int;
  v_role        text;
  v_app_meta    jsonb;
begin
  -- 1) Prefer the local profile row (system of record).
  select u."TenantID", u."Role"
    into v_tenant_id, v_role
    from public."User" u
   where u."SupabaseUserId" = uid
   limit 1;

  -- 2) Fall back to whatever the admin-provisioning code stamped into
  --    raw_app_meta_data on the auth user (used right after creation, before
  --    the local row is queried for the first time).
  if v_tenant_id is null or v_role is null then
    select au.raw_app_meta_data
      into v_app_meta
      from auth.users au
     where au.id = uid
     limit 1;

    if v_app_meta is not null then
      if v_tenant_id is null and (v_app_meta ? 'tenant_id') then
        begin
          v_tenant_id := (v_app_meta->>'tenant_id')::int;
        exception when others then
          v_tenant_id := null;
        end;
      end if;
      if v_role is null and (v_app_meta ? 'app_role') then
        v_role := v_app_meta->>'app_role';
      end if;
    end if;
  end if;

  -- 3) Stamp claims (only when we actually resolved a value).
  if v_tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id), true);
  end if;
  if v_role is not null then
    claims := jsonb_set(claims, '{app_role}',  to_jsonb(v_role),     true);
  end if;

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

-- Lock down execute: only Supabase's auth roles should ever invoke it.
revoke all on function public.custom_access_token_hook(jsonb) from public;
revoke all on function public.custom_access_token_hook(jsonb) from anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- The function reads from public."User"; supabase_auth_admin needs SELECT on it.
grant usage on schema public to supabase_auth_admin;
grant select on table public."User" to supabase_auth_admin;
