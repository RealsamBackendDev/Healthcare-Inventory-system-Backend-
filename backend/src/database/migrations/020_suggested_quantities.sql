ALTER TABLE requisition_items ADD COLUMN suggested_quantity DOUBLE PRECISION;

ALTER TABLE requisition_items
    ADD CONSTRAINT requisition_items_suggested_check
    CHECK (suggested_quantity IS NULL OR (suggested_quantity >= 0 AND suggested_quantity <= requested_quantity));
