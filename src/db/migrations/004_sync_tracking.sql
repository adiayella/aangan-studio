-- HubSpot sync tracking: what was synced, when, and what failed, so failures can be retried safely.
alter table hubspot_sync add column if not exists note_id text;
alter table hubspot_sync add column if not exists last_synced_at timestamptz;
alter table hubspot_sync add column if not exists review_reason text;
alter table hubspot_sync drop constraint if exists hubspot_sync_status_check;
alter table hubspot_sync add constraint hubspot_sync_status_check
  check (status in ('pending','synced','failed','needs_match_review'));
create index if not exists hubspot_sync_status_idx on hubspot_sync(status);
