-- Per-shipment dispatcher override of the collection (pickup) time window.
-- Shape: { [shipmentId]: { cAfter?: string, cBefore?: string, pinnedTime?: string, setAt: string, setBy?: string } }
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS collection_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
