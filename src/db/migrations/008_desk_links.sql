-- Private links for the Designer Desk (no email/password). Only a SHA-256 hash of each key is stored.
-- designer_id null = team link (sees every enquiry); otherwise the link sees only that designer's leads.
create table if not exists access_keys (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  key_hash     text not null unique,
  designer_id  uuid references designers(id) on delete cascade,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table access_keys enable row level security;   -- backend only: no grants, no policies for the dashboard roles
