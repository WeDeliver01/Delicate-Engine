-- Migrate trip_archives financial columns from real (single-precision float)
-- to numeric(14,4) for decimal-safe analytics ingestion. Idempotent.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'trip_archives' AND column_name = 'total_km') = 'real' THEN
    ALTER TABLE trip_archives
      ALTER COLUMN total_km        TYPE numeric(14,4) USING total_km::numeric(14,4),
      ALTER COLUMN total_revenue   TYPE numeric(14,4) USING total_revenue::numeric(14,4),
      ALTER COLUMN total_fuel_cost TYPE numeric(14,4) USING total_fuel_cost::numeric(14,4),
      ALTER COLUMN total_margin    TYPE numeric(14,4) USING total_margin::numeric(14,4),
      ALTER COLUMN total_dead_km   TYPE numeric(14,4) USING total_dead_km::numeric(14,4);

    ALTER TABLE trip_archives
      ALTER COLUMN total_km        SET DEFAULT 0,
      ALTER COLUMN total_revenue   SET DEFAULT 0,
      ALTER COLUMN total_fuel_cost SET DEFAULT 0,
      ALTER COLUMN total_margin    SET DEFAULT 0,
      ALTER COLUMN total_dead_km   SET DEFAULT 0;
  END IF;
END $$;
