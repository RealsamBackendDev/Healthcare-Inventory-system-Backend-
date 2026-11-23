CREATE OR REPLACE FUNCTION enforce_batch_expiry_consistency()
RETURNS trigger AS $$
DECLARE
    existing_expiry DATE;
BEGIN
    IF NEW.expiry_date IS NULL OR NEW.stock_location_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT b.expiry_date
      INTO existing_expiry
      FROM batches b
     WHERE b.stock_location_id = NEW.stock_location_id
       AND b.drug_id = NEW.drug_id
       AND b.batch_number = NEW.batch_number
       AND b.expiry_date IS NOT NULL
       AND b.expiry_date <> NEW.expiry_date
     LIMIT 1;

    IF existing_expiry IS NOT NULL THEN
        RAISE EXCEPTION
            'Batch % is already stocked at this location with expiry %. Review the expiry date on this delivery before receiving it again, or use a separate batch number.',
            NEW.batch_number, existing_expiry
            USING ERRCODE = '45B01';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER batches_expiry_consistency_guard
BEFORE INSERT ON batches
FOR EACH ROW
EXECUTE FUNCTION enforce_batch_expiry_consistency();
