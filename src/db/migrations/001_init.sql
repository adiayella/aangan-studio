-- Aangan receptionist: core schema. Run with `npm run db:migrate` once DATABASE_URL is set.
-- No pricing figures are stored anywhere in this schema.

create table if not exists designers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null unique,
  calendar_id   text,
  auth_user_id  text unique,            -- JWT "sub" of the designer's login; used by the dashboard's row-level security
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  phone       text unique,
  email       text,
  hubspot_contact_id text,
  created_at  timestamptz not null default now()
);

create table if not exists calls (
  id               uuid primary key default gen_random_uuid(),
  provider_call_id text unique not null,      -- Voice Vaani's call id; makes webhook retries idempotent
  customer_id      uuid references customers(id),
  status           text not null default 'in_progress',  -- in_progress|completed|disconnected|missed|failed
  started_at       timestamptz,
  ended_at         timestamptz,
  duration_sec     int,
  transcript       text,
  summary          text,
  created_at       timestamptz not null default now()
);

create table if not exists enquiries (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid references calls(id),
  customer_id      uuid references customers(id),
  designer_id      uuid references designers(id),
  segment          text check (segment in ('residential','commercial','unknown')) default 'unknown',
  property_type    text,
  locality         text,
  city             text,
  area_sqft        numeric,
  requirements     text,
  deadline_text    text,
  facts            jsonb not null default '{}',     -- full EnquiryFacts as extracted
  verdict          text check (verdict in ('QUALIFIED','UNQUALIFIED','NEEDS_REVIEW','ESCALATION')),
  criteria         jsonb not null default '[]',     -- per-criterion status + reason (audit trail)
  explanation      text,
  notes            text[] not null default '{}',
  stage            text not null default 'new'
                   check (stage in ('new','contacted','consult_scheduled','consult_done','won','lost')),
  deal_value_inr   numeric,                         -- only set when a real deal value is known
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists enquiries_designer_idx on enquiries(designer_id, created_at desc);

create table if not exists appointments (
  id            uuid primary key default gen_random_uuid(),
  enquiry_id    uuid not null references enquiries(id) on delete cascade,
  designer_id   uuid references designers(id),
  starts_at     timestamptz,
  ends_at       timestamptz,
  mode          text check (mode in ('online','site_visit')),
  location      text,
  meet_link     text,
  status        text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  google_event_id text unique,                     -- set only after Google confirms the booking
  created_at    timestamptz not null default now()
);
-- No double-booking a designer.
create extension if not exists btree_gist;
alter table appointments drop constraint if exists no_double_booking;
alter table appointments add constraint no_double_booking
  exclude using gist (designer_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'confirmed');

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  enquiry_id   uuid references enquiries(id) on delete cascade,
  kind         text not null,               -- designer_handoff|urgent_escalation|...
  recipient    text not null,
  status       text not null default 'queued',  -- queued|sent|failed
  attempts     int not null default 0,
  last_error   text,
  created_at   timestamptz not null default now()
);

create table if not exists hubspot_sync (
  enquiry_id   uuid primary key references enquiries(id) on delete cascade,
  contact_id   text, deal_id text,
  status       text not null default 'pending',  -- pending|synced|failed
  attempts     int not null default 0,
  last_error   text,
  updated_at   timestamptz not null default now()
);

create table if not exists usage_costs (
  id         uuid primary key default gen_random_uuid(),
  call_id    uuid references calls(id) on delete cascade,
  provider   text not null,                 -- vaani|gemini|email|...
  units      numeric, unit_name text,
  amount_inr numeric,
  basis      text not null check (basis in ('billed','estimated','unknown')),
  created_at timestamptz not null default now()
);

create table if not exists kb_entries (
  id        uuid primary key default gen_random_uuid(),
  topic     text not null,
  content   text not null,
  public    boolean not null default true,    -- must stay true for anything the voice agent may read
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  event      text not null,
  ref_id     text,
  detail     jsonb
);

-- What the designer dashboard reads. Designers see only their own leads.
create or replace view designer_leads with (security_invoker = true) as
select e.id, e.created_at, d.name as designer_name,
       c.name as customer_name, c.phone, c.email,
       e.locality, e.city, e.segment, e.property_type, e.area_sqft, e.requirements, e.deadline_text,
       e.verdict, e.criteria, e.notes, ca.summary, e.stage,
       ap.starts_at as consult_start, ap.mode as consult_mode, ap.location as consult_location,
       ap.status as consult_status, ap.meet_link,
       ca.duration_sec as call_duration_sec,
       null::text as hubspot_url,
       coalesce((select n.status from notifications n where n.enquiry_id = e.id order by n.created_at desc limit 1), 'none') as email_status
from enquiries e
left join designers d on d.id = e.designer_id
left join customers c on c.id = e.customer_id
left join calls ca on ca.id = e.call_id
left join lateral (select * from appointments a where a.enquiry_id = e.id order by a.created_at desc limit 1) ap on true
where e.verdict in ('QUALIFIED','NEEDS_REVIEW','ESCALATION');
