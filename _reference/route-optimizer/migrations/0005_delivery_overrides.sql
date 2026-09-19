-- Per-shipment dispatcher override of the delivery time window.
-- Shape: { [shipmentId]: { dAfter?: string, dBefore?: string, setAt: string, setBy?: string } }
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS delivery_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
