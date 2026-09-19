-- MHN Management RBAC foundation
-- Phase 1: roles, permissions, user-role assignments, and locked-down RLS.
--
-- IMPORTANT:
-- - This migration intentionally does NOT create the first owner.
-- - The first owner must be bootstrapped manually by an operator with direct
--   database administration access after this migration is applied.
-- - Edge Functions that need these tables must use the Supabase service-role
--   credential from the Edge Function runtime environment only.
-- - The service-role credential must NEVER be exposed to the frontend or committed
--   to GitHub.
-- - No role/permission claims are stored in JWTs. Authorization code must query
--   the current database state on every request.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (user_id)
);

create index if not exists user_roles_role_id_idx
  on public.user_roles (role_id);

create index if not exists role_permissions_permission_id_idx
  on public.role_permissions (permission_id);

create index if not exists user_profiles_status_idx
  on public.user_profiles (status);

alter table public.user_profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

-- These RBAC tables are server-side authorization data.
-- Direct PostgREST access is denied for both anon and authenticated clients.
-- Trusted Edge Functions use the service-role credential and therefore bypass
-- these client-facing RLS restrictions.

revoke all on public.user_profiles from anon, authenticated;
revoke all on public.roles from anon, authenticated;
revoke all on public.permissions from anon, authenticated;
revoke all on public.role_permissions from anon, authenticated;
revoke all on public.user_roles from anon, authenticated;

drop policy if exists user_profiles_deny_client_access
  on public.user_profiles;

create policy user_profiles_deny_client_access
  on public.user_profiles
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists roles_deny_client_access
  on public.roles;

create policy roles_deny_client_access
  on public.roles
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists permissions_deny_client_access
  on public.permissions;

create policy permissions_deny_client_access
  on public.permissions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists role_permissions_deny_client_access
  on public.role_permissions;

create policy role_permissions_deny_client_access
  on public.role_permissions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists user_roles_deny_client_access
  on public.user_roles;

create policy user_roles_deny_client_access
  on public.user_roles
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Initial role catalog.
insert into public.roles (key, name, description)
values
  ('owner', '最高管理者', 'Full MHN Management control.'),
  ('admin', '一般管理者', 'Day-to-day management without owner-level user/system control.'),
  ('editor', '編集担当', 'News and emergency-content editing/publishing.'),
  ('viewer', '閲覧担当', 'Read-only management access.')
on conflict (key) do nothing;

-- Initial permission catalog.
insert into public.permissions (key, name, description)
values
  ('news.read', 'News read', 'Read news management data.'),
  ('news.write', 'News write', 'Create and edit news.'),
  ('news.publish', 'News publish', 'Publish news.'),
  ('news.delete', 'News delete', 'Delete news.'),
  ('emergency.read', 'Emergency read', 'Read emergency-news management data.'),
  ('emergency.write', 'Emergency write', 'Create and edit emergency news.'),
  ('emergency.publish', 'Emergency publish', 'Publish emergency news.'),
  ('revenue.read', 'Revenue read', 'Access the revenue workflow; sensitive revenue data still requires AAL2 and a short-lived revenue grant.'),
  ('license.read', 'License read', 'Read license-management data.'),
  ('license.write', 'License write', 'Create or modify license-management data.'),
  ('users.read', 'Users read', 'Read administrative user-management data.'),
  ('users.manage', 'Users manage', 'Create, disable, and manage user roles; owner-only.'),
  ('audit.read', 'Audit read', 'Read audit logs.'),
  ('system.read', 'System read', 'Read system-management data.'),
  ('system.manage', 'System manage', 'Modify system-level settings; owner-only.')
on conflict (key) do nothing;

-- Initial role/permission mapping.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.key in (
    'news.read',
    'news.write',
    'news.publish',
    'news.delete',
    'emergency.read',
    'emergency.write',
    'emergency.publish',
    'revenue.read',
    'license.read',
    'license.write',
    'users.read',
    'users.manage',
    'audit.read',
    'system.read',
    'system.manage'
  )
where r.key = 'owner'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.key in (
    'news.read',
    'news.write',
    'news.publish',
    'news.delete',
    'emergency.read',
    'emergency.write',
    'emergency.publish',
    'revenue.read',
    'license.read',
    'license.write',
    'users.read',
    'audit.read',
    'system.read'
  )
where r.key = 'admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.key in (
    'news.read',
    'news.write',
    'news.publish',
    'emergency.read',
    'emergency.write',
    'emergency.publish'
  )
where r.key = 'editor'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p
  on p.key in (
    'news.read',
    'emergency.read'
  )
where r.key = 'viewer'
on conflict do nothing;

-- No user_roles rows are inserted here.
-- The first owner is intentionally created only through the documented
-- manual bootstrap procedure after migration review/application.
