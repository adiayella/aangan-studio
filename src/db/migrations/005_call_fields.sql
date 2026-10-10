-- Fields the webhook pipeline needs on calls.
alter table calls add column if not exists caller_phone text;
alter table calls add column if not exists end_reason text;
alter table calls add column if not exists analysis_status text not null default 'pending'
  check (analysis_status in ('pending','completed','failed'));
alter table calls add column if not exists analysis_error text;
create index if not exists calls_analysis_idx on calls(analysis_status);
