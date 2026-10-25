-- The company is not VAT registered. Charging VAT it is not registered for is an offence, so
-- this is a correction, not a preference -- unlike the capacity policy in 0035, it is applied
-- unconditionally rather than only where nobody has touched the row: a settings row an operator
-- switched to true in error is exactly the case this migration exists to fix.
--
-- Nothing else needs to change: company.vat_bps stays as a historical figure, but
-- SettingsService.vatBps() already returns 0 once vat_registered is false, and InvoiceService
-- already issues a plain "INVOICE" rather than a "TAX INVOICE" on the same flag.
UPDATE "settings"
SET "value" = 'false'::jsonb
WHERE "key" = 'company.vat_registered';
