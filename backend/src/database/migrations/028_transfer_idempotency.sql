ALTER TABLE facility_transfers ADD COLUMN decision_idempotency_key TEXT;

ALTER TABLE facility_transfer_receipts ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX facility_transfer_receipts_idempotency_unique
    ON facility_transfer_receipts (transfer_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;
