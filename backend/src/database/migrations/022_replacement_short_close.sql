ALTER TABLE requisition_items
    ADD COLUMN replacement_authorised_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN closed_short_quantity DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE requisition_items
    ADD CONSTRAINT requisition_items_replacement_check
    CHECK (replacement_authorised_quantity >= 0);

ALTER TABLE requisition_items
    ADD CONSTRAINT requisition_items_closed_short_check
    CHECK (closed_short_quantity >= 0);

UPDATE requisition_items ri
   SET replacement_authorised_quantity = COALESCE(agg.replacement_quantity, 0),
       closed_short_quantity = COALESCE(agg.closed_short_quantity, 0)
  FROM (
    SELECT disp.requisition_id, di.drug_id,
           SUM(CASE WHEN di.discrepancy_resolution = 'reissue'
                    THEN di.missing_quantity + di.damaged_quantity ELSE 0 END) AS replacement_quantity,
           SUM(CASE WHEN di.discrepancy_resolution = 'written_off'
                    THEN di.missing_quantity + di.damaged_quantity ELSE 0 END) AS closed_short_quantity
      FROM lg_dispatch_items di
      JOIN lg_dispatches disp ON disp.id = di.dispatch_id
     WHERE di.discrepancy_status = 'resolved'
     GROUP BY disp.requisition_id, di.drug_id
  ) agg
 WHERE agg.requisition_id = ri.requisition_id
   AND agg.drug_id = ri.drug_id;

CREATE TABLE requisition_short_closures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE RESTRICT,
    requisition_item_id UUID NOT NULL REFERENCES requisition_items(id) ON DELETE RESTRICT,
    drug_id UUID NOT NULL REFERENCES drugs(id) ON DELETE RESTRICT,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    reason TEXT NOT NULL,
    closed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    closed_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX requisition_short_closures_requisition_idx
    ON requisition_short_closures (requisition_id, created_at DESC);
