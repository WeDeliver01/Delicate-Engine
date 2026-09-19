-- Driver Analytics tables (Task #13). Idempotent.

CREATE TABLE IF NOT EXISTS drivers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  employee_number text DEFAULT '',
  driver_account_id integer,
  fleet_driver_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS drivers_account_uniq ON drivers (driver_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS drivers_fleet_uniq   ON drivers (fleet_driver_id);

CREATE TABLE IF NOT EXISTS shipments_analytics (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id varchar NOT NULL,
  waybill text NOT NULL,
  delivery_date timestamptz NOT NULL,
  revenue numeric(14,4) NOT NULL DEFAULT 0,
  cogs numeric(14,4),
  currency text NOT NULL DEFAULT 'USD',
  fx_rate_to_base numeric(14,6) NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'delivered',
  route_id text,
  source_project_id text,
  source_archive_id text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shipments_analytics_driver_date_idx
  ON shipments_analytics (driver_id, delivery_date);
CREATE UNIQUE INDEX IF NOT EXISTS shipments_analytics_wb_uniq
  ON shipments_analytics (waybill, driver_id, delivery_date);

CREATE TABLE IF NOT EXISTS expenses (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id varchar NOT NULL,
  shipment_id varchar,
  expense_type text NOT NULL DEFAULT 'fuel',
  amount numeric(14,4) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  fx_rate_to_base numeric(14,6) NOT NULL DEFAULT 1,
  incurred_at timestamptz NOT NULL,
  notes text DEFAULT '',
  source_archive_id text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_driver_date_idx
  ON expenses (driver_id, incurred_at);
