ALTER TABLE requisition_items
    DROP CONSTRAINT IF EXISTS requisition_items_approved_check;

ALTER TABLE requisition_items
    ADD CONSTRAINT requisition_items_approved_check
    CHECK (approved_quantity >= 0);
