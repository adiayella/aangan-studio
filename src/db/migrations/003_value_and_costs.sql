-- Internal estimates live in their own table: no grants and no policies for "authenticated",
-- so designers and the dashboard can never read them. Only the backend (table owner) can.
create table if not exists estimates (
  enquiry_id          uuid primary key references enquiries(id) on delete cascade,
  label               text not null default 'INTERNAL INDICATIVE ESTIMATE — NOT A QUOTATION',
  status              text not null check (status in ('ESTIMATED','INSUFFICIENT_DATA','NOT_APPLICABLE')),
  basis               text,
  designed_area_sqft  numeric,
  tier_established    boolean not null default false,
  scenarios           jsonb not null default '[]',
  pipeline_low_inr    numeric,
  pipeline_high_inr   numeric,          -- null = open-ended (e.g. luxury); never invented
  missing             text[] not null default '{}',
  computed_at         timestamptz not null default now()
);
alter table estimates enable row level security;

alter table enquiries rename column deal_value_inr to confirmed_deal_value_inr;
alter table enquiries add column if not exists actual_revenue_inr numeric;
alter table enquiries add column if not exists decline_reason text;
alter table enquiries add column if not exists follow_up_status text;

alter table calls add column if not exists answered boolean;

-- Cost ledger: ACTUAL (provider-reported), ESTIMATED (calculated from verified rates), UNAVAILABLE.
alter table usage_costs drop constraint if exists usage_costs_basis_check;
update usage_costs set basis = upper(basis);
alter table usage_costs add constraint usage_costs_basis_check check (basis in ('ACTUAL','ESTIMATED','UNAVAILABLE'));
alter table usage_costs add column if not exists period_start date;
alter table usage_costs add column if not exists period_end date;
alter table usage_costs add column if not exists note text;
