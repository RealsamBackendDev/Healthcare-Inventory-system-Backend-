CREATE OR REPLACE FUNCTION enforce_batch_expiry_consistency()
RETURNS trigger AS $$
DECLARE
    existing_number TEXT;
    existing_expiry DATE;
BEGIN
    IF NEW.stock_location_id IS NULL OR NEW.batch_number IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT b.batch_number, b.expiry_date
      INTO existing_number, existing_expiry
      FROM batches b
     WHERE b.stock_location_id = NEW.stock_location_id
       AND b.drug_id = NEW.drug_id
       AND upper(btrim(b.batch_number)) = upper(btrim(NEW.batch_number))
     ORDER BY b.created_at
     LIMIT 1;

    IF existing_number IS NULL THEN
        RETURN NEW;
    END IF;

    IF existing_expiry IS NOT NULL
       AND NEW.expiry_date IS NOT NULL
       AND existing_expiry <> NEW.expiry_date THEN
        RAISE EXCEPTION
            'Batch % is already stocked at this location with expiry %. Review the expiry date on this delivery before receiving it again, or use a separate batch number.',
            NEW.batch_number, existing_expiry
            USING ERRCODE = '45B01';
    END IF;

    NEW.batch_number := existing_number;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
