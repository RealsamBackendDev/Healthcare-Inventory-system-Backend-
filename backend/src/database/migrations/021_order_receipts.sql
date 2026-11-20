ALTER TABLE lg_receipts ADD COLUMN order_id UUID REFERENCES lg_orders(id) ON DELETE SET NULL;
ALTER TABLE lg_receipts ADD COLUMN order_number TEXT;

CREATE INDEX lg_receipts_order_idx ON lg_receipts (order_id, received_at DESC);

ALTER TABLE lg_orders DROP CONSTRAINT IF EXISTS lg_orders_status_check;

ALTER TABLE lg_orders ADD CONSTRAINT lg_orders_status_check
  CHECK (status IN ('draft', 'submitted', 'fulfilled', 'partially_received', 'received', 'cancelled'));
