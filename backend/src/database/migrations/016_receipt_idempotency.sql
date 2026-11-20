ALTER TABLE lg_receipts ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX lg_receipts_idempotency_unique
    ON lg_receipts (local_government_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;
