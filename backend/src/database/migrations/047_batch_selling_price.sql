ALTER TABLE batches ADD COLUMN IF NOT EXISTS selling_price NUMERIC(14, 2);

CREATE OR REPLACE FUNCTION batch_selling_price_from_cost() RETURNS TRIGGER AS $$
BEGIN
    NEW.selling_price := CASE
        WHEN NEW.unit_cost IS NULL THEN NULL
        ELSE round(NEW.unit_cost * 1.2, 2)
    END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS batches_set_selling_price ON batches;

CREATE TRIGGER batches_set_selling_price
    BEFORE INSERT OR UPDATE OF unit_cost ON batches
    FOR EACH ROW
    EXECUTE FUNCTION batch_selling_price_from_cost();

UPDATE batches
   SET selling_price = round(unit_cost * 1.2, 2)
 WHERE unit_cost IS NOT NULL;

ALTER TABLE dispensing_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(14, 2);

ALTER TABLE vendor_requests ADD COLUMN IF NOT EXISTS requested_value NUMERIC(14, 2) NOT NULL DEFAULT 0;
