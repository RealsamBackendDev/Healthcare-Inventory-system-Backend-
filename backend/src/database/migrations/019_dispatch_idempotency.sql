ALTER TABLE lg_dispatches ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX lg_dispatches_idempotency_unique
    ON lg_dispatches (local_government_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;
