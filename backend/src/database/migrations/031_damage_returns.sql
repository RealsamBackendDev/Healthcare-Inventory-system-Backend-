ALTER TABLE damage_dispositions
    ADD COLUMN return_batch_id UUID REFERENCES batches(id) ON DELETE SET NULL;

ALTER TABLE damage_dispositions
    ADD COLUMN return_to_healthcare_centre_id UUID REFERENCES healthcare_centres(id) ON DELETE SET NULL;

ALTER TABLE damage_dispositions
    ADD COLUMN return_to_name TEXT;

ALTER TABLE damage_dispositions
    ADD COLUMN return_status TEXT NOT NULL DEFAULT 'none';

ALTER TABLE damage_dispositions
    ADD COLUMN return_outcome TEXT;

ALTER TABLE damage_dispositions
    ADD COLUMN return_received_at TIMESTAMPTZ;

ALTER TABLE damage_dispositions
    ADD COLUMN return_received_by_name TEXT;

ALTER TABLE damage_dispositions
    ADD CONSTRAINT damage_dispositions_return_status_check
    CHECK (return_status IN ('none', 'in_transit', 'received'));

ALTER TABLE damage_dispositions
    ADD CONSTRAINT damage_dispositions_return_outcome_check
    CHECK (return_outcome IS NULL OR return_outcome IN ('restocked', 'written_off'));

CREATE INDEX damage_dispositions_return_batch_idx
    ON damage_dispositions (return_batch_id);
