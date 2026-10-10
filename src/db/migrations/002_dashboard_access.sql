-- Row-level security for the designer dashboard (Neon Data API, role "authenticated").
-- The backend connects as the table owner and is not affected by these policies.

alter table designers add column if not exists role text not null default 'designer' check (role in ('designer','admin'));

create or replace function public.current_designer_id() returns uuid
  language sql stable security definer set search_path = public as
  $$ select id from designers where auth_user_id = auth.user_id() and active limit 1 $$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from designers where auth_user_id = auth.user_id() and active and role = 'admin') $$;

grant usage on schema public to authenticated;
grant execute on function public.current_designer_id(), public.is_admin() to authenticated;
grant select on designers, customers, calls, enquiries, appointments, notifications, designer_leads to authenticated;
grant update (stage) on enquiries to authenticated;   -- designers may only move a lead between stages

alter table designers     enable row level security;
alter table customers     enable row level security;
alter table calls         enable row level security;
alter table enquiries     enable row level security;
alter table appointments  enable row level security;
alter table notifications enable row level security;

drop policy if exists designers_read on designers;
create policy designers_read on designers for select to authenticated
  using (is_admin() or auth_user_id = auth.user_id());

drop policy if exists enquiries_read on enquiries;
create policy enquiries_read on enquiries for select to authenticated
  using (is_admin() or designer_id = current_designer_id());

drop policy if exists enquiries_stage on enquiries;
create policy enquiries_stage on enquiries for update to authenticated
  using (is_admin() or designer_id = current_designer_id())
  with check (is_admin() or designer_id = current_designer_id());

drop policy if exists customers_read on customers;
create policy customers_read on customers for select to authenticated
  using (is_admin() or exists (select 1 from enquiries e where e.customer_id = customers.id and e.designer_id = current_designer_id()));

drop policy if exists calls_read on calls;
create policy calls_read on calls for select to authenticated
  using (is_admin() or exists (select 1 from enquiries e where e.call_id = calls.id and e.designer_id = current_designer_id()));

drop policy if exists appointments_read on appointments;
create policy appointments_read on appointments for select to authenticated
  using (is_admin() or designer_id = current_designer_id());

drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select to authenticated
  using (is_admin() or exists (select 1 from enquiries e where e.id = notifications.enquiry_id and e.designer_id = current_designer_id()));

-- Knowledge base, usage costs and audit log stay backend-only (no grants, no policies).
