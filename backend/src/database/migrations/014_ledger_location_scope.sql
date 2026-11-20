ALTER TABLE stock_movements ALTER COLUMN healthcare_centre_id DROP NOT NULL;

ALTER TABLE stock_movements ADD COLUMN stock_location_id UUID REFERENCES stock_locations(id) ON DELETE RESTRICT;
ALTER TABLE stock_movements ADD COLUMN local_government_id UUID REFERENCES local_governments(id) ON DELETE RESTRICT;
ALTER TABLE stock_movements ADD COLUMN correlation_id TEXT;

UPDATE stock_movements m
   SET stock_location_id = b.stock_location_id,
       local_government_id = b.local_government_id,
       healthcare_centre_id = COALESCE(m.healthcare_centre_id, b.healthcare_centre_id)
  FROM batches b
 WHERE b.id = m.batch_id;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_scope_check CHECK (
    healthcare_centre_id IS NOT NULL OR stock_location_id IS NOT NULL
  );

CREATE INDEX stock_movements_location_created_idx ON stock_movements (stock_location_id, created_at DESC);
CREATE INDEX stock_movements_lg_created_idx ON stock_movements (local_government_id, created_at DESC);
CREATE INDEX stock_movements_batch_idx ON stock_movements (batch_id);

CREATE OR REPLACE FUNCTION set_stock_movement_scope()
RETURNS TRIGGER AS $$
DECLARE
    batch_row RECORD;
BEGIN
    SELECT b.stock_location_id, b.local_government_id, b.healthcare_centre_id
      INTO batch_row
      FROM batches b
     WHERE b.id = NEW.batch_id;

    IF batch_row.stock_location_id IS NULL THEN
        RAISE EXCEPTION 'Stock movement batch % has no stock location', NEW.batch_id;
    END IF;

    IF NEW.stock_location_id IS NULL THEN
        NEW.stock_location_id := batch_row.stock_location_id;
    ELSIF NEW.stock_location_id <> batch_row.stock_location_id THEN
        RAISE EXCEPTION 'Stock movement location does not match batch %', NEW.batch_id;
    END IF;

    IF NEW.local_government_id IS NULL THEN
        NEW.local_government_id := batch_row.local_government_id;
    ELSIF NEW.local_government_id <> batch_row.local_government_id THEN
        RAISE EXCEPTION 'Stock movement local government does not match batch %', NEW.batch_id;
    END IF;

    IF NEW.healthcare_centre_id IS NULL THEN
        NEW.healthcare_centre_id := batch_row.healthcare_centre_id;
    ELSIF NEW.healthcare_centre_id IS DISTINCT FROM batch_row.healthcare_centre_id THEN
        RAISE EXCEPTION 'Stock movement healthcare centre does not match batch %', NEW.batch_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_movements_set_scope ON stock_movements;

CREATE TRIGGER stock_movements_set_scope
BEFORE INSERT ON stock_movements
FOR EACH ROW
EXECUTE FUNCTION set_stock_movement_scope();

ALTER TABLE batches DROP CONSTRAINT batches_owner_check;
ALTER TABLE batches ADD CONSTRAINT batches_owner_check CHECK (local_government_id IS NOT NULL);

CREATE OR REPLACE FUNCTION assert_batch_owner()
RETURNS TRIGGER AS $$
DECLARE
    location_row RECORD;
BEGIN
    SELECT sl.local_government_id, sl.healthcare_centre_id, sl.location_type
      INTO location_row
      FROM stock_locations sl
     WHERE sl.id = NEW.stock_location_id;

    IF location_row.location_type IS NULL THEN
        RAISE EXCEPTION 'Batch % references an unknown stock location', NEW.batch_number;
    END IF;

    IF NEW.local_government_id IS NULL
       OR location_row.local_government_id <> NEW.local_government_id THEN
        RAISE EXCEPTION 'Batch % local government does not match its stock location', NEW.batch_number;
    END IF;

    IF location_row.location_type = 'facility' THEN
        IF NEW.healthcare_centre_id IS NULL
           OR NEW.healthcare_centre_id <> location_row.healthcare_centre_id THEN
            RAISE EXCEPTION 'Batch % must belong to the healthcare centre of its stock location', NEW.batch_number;
        END IF;
    ELSIF location_row.location_type = 'lg_warehouse' THEN
        IF NEW.healthcare_centre_id IS NOT NULL THEN
            RAISE EXCEPTION 'Warehouse batch % cannot belong to a healthcare centre', NEW.batch_number;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS batches_assert_owner ON batches;

CREATE TRIGGER batches_assert_owner
BEFORE INSERT OR UPDATE ON batches
FOR EACH ROW
EXECUTE FUNCTION assert_batch_owner();
