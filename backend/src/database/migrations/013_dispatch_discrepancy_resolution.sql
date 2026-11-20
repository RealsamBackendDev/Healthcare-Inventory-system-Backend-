ALTER TABLE lg_dispatch_items
    ADD COLUMN discrepancy_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN discrepancy_resolution TEXT,
    ADD COLUMN discrepancy_note TEXT,
    ADD COLUMN resolved_at TIMESTAMPTZ,
    ADD COLUMN resolved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN resolved_by_name TEXT;

ALTER TABLE lg_dispatch_items
    ADD CONSTRAINT lg_dispatch_items_discrepancy_status_check
    CHECK (discrepancy_status IN ('none', 'open', 'resolved'));

ALTER TABLE lg_dispatch_items
    ADD CONSTRAINT lg_dispatch_items_discrepancy_resolution_check
    CHECK (discrepancy_resolution IS NULL OR discrepancy_resolution IN ('reissue', 'written_off'));

UPDATE lg_dispatch_items
   SET discrepancy_status = 'open'
 WHERE missing_quantity > 0;

CREATE INDEX lg_dispatch_items_discrepancy_idx
    ON lg_dispatch_items (discrepancy_status)
 WHERE discrepancy_status = 'open';
