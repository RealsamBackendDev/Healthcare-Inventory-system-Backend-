ALTER TABLE stock_locations DROP CONSTRAINT stock_locations_type_check;
ALTER TABLE stock_locations DROP CONSTRAINT stock_locations_owner_check;

ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_type_check CHECK (
    location_type IN ('lg_warehouse', 'facility', 'in_transit')
);

ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_owner_check CHECK (
    (location_type IN ('lg_warehouse', 'in_transit') AND healthcare_centre_id IS NULL)
    OR (location_type = 'facility' AND healthcare_centre_id IS NOT NULL)
);

CREATE UNIQUE INDEX stock_locations_transit_unique
    ON stock_locations (local_government_id) WHERE location_type = 'in_transit';

INSERT INTO stock_locations (local_government_id, healthcare_centre_id, location_type, name, code)
SELECT lg.id, NULL, 'in_transit', lg.name || ' stock in transit', lg.code || '-TRANSIT'
  FROM local_governments lg
 WHERE NOT EXISTS (
       SELECT 1 FROM stock_locations sl
        WHERE sl.local_government_id = lg.id
          AND sl.location_type = 'in_transit'
 );

ALTER TABLE lg_dispatch_items
    ADD COLUMN transit_batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;

ALTER TABLE facility_transfer_items
    ADD COLUMN transit_batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;

ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (
    movement_type IN ('receipt', 'import', 'opening_stock', 'dispensing', 'adjustment', 'return',
                      'return_restock', 'reconciliation', 'transfer_in', 'transfer_out',
                      'transit_in', 'transit_out', 'write_off')
);

CREATE INDEX IF NOT EXISTS lg_dispatch_items_transit_idx ON lg_dispatch_items (transit_batch_id);

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
    ELSE
        IF NEW.healthcare_centre_id IS NOT NULL THEN
            RAISE EXCEPTION 'Batch % cannot belong to a healthcare centre', NEW.batch_number;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
