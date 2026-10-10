-- Appointments booked in Cal.com (by the Vaani agent in the call, or by anyone) are recorded here from Cal.com's webhook.
alter table appointments alter column enquiry_id drop not null;   -- a booking may arrive that matches no enquiry yet
alter table appointments add column if not exists cal_booking_uid text;
alter table appointments add column if not exists cal_status text;
alter table appointments add column if not exists attendee_email text;
alter table appointments add column if not exists attendee_name text;
alter table appointments add column if not exists attendee_timezone text;
alter table appointments add column if not exists host_email text;
alter table appointments add column if not exists title text;
alter table appointments add column if not exists updated_at timestamptz not null default now();
create unique index if not exists appointments_cal_uid_uq on appointments(cal_booking_uid) where cal_booking_uid is not null;
create index if not exists appointments_attendee_idx on appointments(lower(attendee_email));
