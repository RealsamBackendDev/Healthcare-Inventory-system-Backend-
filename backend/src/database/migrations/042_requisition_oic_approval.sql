ALTER TABLE requisitions DROP CONSTRAINT IF EXISTS requisitions_status_check;

ALTER TABLE requisitions
  ADD CONSTRAINT requisitions_status_check
  CHECK (status IN ('draft', 'pending_oic', 'pending_approval', 'approved', 'rejected', 'cancelled', 'closed'));

CREATE INDEX IF NOT EXISTS requisitions_pending_oic_idx
  ON requisitions (healthcare_centre_id, status)
  WHERE status = 'pending_oic';
