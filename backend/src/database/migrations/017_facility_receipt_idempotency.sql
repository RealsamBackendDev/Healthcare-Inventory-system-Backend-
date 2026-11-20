ALTER TABLE receipts ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX receipts_idempotency_unique
    ON receipts (healthcare_centre_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;
