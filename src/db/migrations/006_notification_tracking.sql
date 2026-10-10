-- One notification per (enquiry, kind): retries update the same row, so an email is never sent twice.
alter table notifications add column if not exists provider_id text;
alter table notifications add column if not exists sent_at timestamptz;
alter table notifications add column if not exists payload jsonb;
create unique index if not exists notifications_enquiry_kind_uq on notifications(enquiry_id, kind);
-- Email bodies contain customer details: keep them backend-only (the dashboard may read status, not payload).
revoke select on notifications from authenticated;
grant select (id, enquiry_id, kind, status, attempts, sent_at, created_at) on notifications to authenticated;
