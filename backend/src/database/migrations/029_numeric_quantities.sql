ALTER TABLE batches
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4),
    ALTER COLUMN unit_cost TYPE NUMERIC(14,4) USING unit_cost::numeric(14,4);

ALTER TABLE dispensing_items
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4);

ALTER TABLE drugs
    ALTER COLUMN minimum_stock_level TYPE NUMERIC(14,4) USING minimum_stock_level::numeric(14,4);

ALTER TABLE facility_drug_settings
    ALTER COLUMN minimum_stock_level TYPE NUMERIC(14,4) USING minimum_stock_level::numeric(14,4);

ALTER TABLE facility_transfer_items
    ALTER COLUMN accepted_quantity TYPE NUMERIC(14,4) USING accepted_quantity::numeric(14,4),
    ALTER COLUMN damaged_quantity TYPE NUMERIC(14,4) USING damaged_quantity::numeric(14,4),
    ALTER COLUMN missing_quantity TYPE NUMERIC(14,4) USING missing_quantity::numeric(14,4),
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4),
    ALTER COLUMN replacement_authorised_quantity TYPE NUMERIC(14,4) USING replacement_authorised_quantity::numeric(14,4),
    ALTER COLUMN unit_cost TYPE NUMERIC(14,4) USING unit_cost::numeric(14,4);

ALTER TABLE facility_transfer_receipt_items
    ALTER COLUMN accepted_quantity TYPE NUMERIC(14,4) USING accepted_quantity::numeric(14,4),
    ALTER COLUMN damaged_quantity TYPE NUMERIC(14,4) USING damaged_quantity::numeric(14,4),
    ALTER COLUMN missing_quantity TYPE NUMERIC(14,4) USING missing_quantity::numeric(14,4);

ALTER TABLE facility_transfer_receipts
    ALTER COLUMN accepted_quantity TYPE NUMERIC(14,4) USING accepted_quantity::numeric(14,4),
    ALTER COLUMN damaged_quantity TYPE NUMERIC(14,4) USING damaged_quantity::numeric(14,4),
    ALTER COLUMN missing_quantity TYPE NUMERIC(14,4) USING missing_quantity::numeric(14,4);

ALTER TABLE facility_transfer_request_items
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4);

ALTER TABLE facility_transfers
    ALTER COLUMN total_quantity TYPE NUMERIC(14,4) USING total_quantity::numeric(14,4);

ALTER TABLE lg_consolidation_items
    ALTER COLUMN gap_quantity TYPE NUMERIC(14,4) USING gap_quantity::numeric(14,4),
    ALTER COLUMN requested_quantity TYPE NUMERIC(14,4) USING requested_quantity::numeric(14,4),
    ALTER COLUMN warehouse_quantity TYPE NUMERIC(14,4) USING warehouse_quantity::numeric(14,4);

ALTER TABLE lg_consolidation_sources
    ALTER COLUMN requested_quantity TYPE NUMERIC(14,4) USING requested_quantity::numeric(14,4);

ALTER TABLE lg_consolidations
    ALTER COLUMN gap_quantity TYPE NUMERIC(14,4) USING gap_quantity::numeric(14,4),
    ALTER COLUMN total_quantity TYPE NUMERIC(14,4) USING total_quantity::numeric(14,4);

ALTER TABLE lg_dispatch_items
    ALTER COLUMN accepted_quantity TYPE NUMERIC(14,4) USING accepted_quantity::numeric(14,4),
    ALTER COLUMN damaged_quantity TYPE NUMERIC(14,4) USING damaged_quantity::numeric(14,4),
    ALTER COLUMN missing_quantity TYPE NUMERIC(14,4) USING missing_quantity::numeric(14,4),
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4),
    ALTER COLUMN unit_cost TYPE NUMERIC(14,4) USING unit_cost::numeric(14,4);

ALTER TABLE lg_dispatch_receipts
    ALTER COLUMN accepted_quantity TYPE NUMERIC(14,4) USING accepted_quantity::numeric(14,4),
    ALTER COLUMN damaged_quantity TYPE NUMERIC(14,4) USING damaged_quantity::numeric(14,4),
    ALTER COLUMN missing_quantity TYPE NUMERIC(14,4) USING missing_quantity::numeric(14,4);

ALTER TABLE lg_dispatches
    ALTER COLUMN accepted_quantity TYPE NUMERIC(14,4) USING accepted_quantity::numeric(14,4),
    ALTER COLUMN damaged_quantity TYPE NUMERIC(14,4) USING damaged_quantity::numeric(14,4),
    ALTER COLUMN missing_quantity TYPE NUMERIC(14,4) USING missing_quantity::numeric(14,4);

ALTER TABLE lg_order_items
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4),
    ALTER COLUMN requested_quantity TYPE NUMERIC(14,4) USING requested_quantity::numeric(14,4),
    ALTER COLUMN warehouse_quantity TYPE NUMERIC(14,4) USING warehouse_quantity::numeric(14,4);

ALTER TABLE lg_orders
    ALTER COLUMN total_quantity TYPE NUMERIC(14,4) USING total_quantity::numeric(14,4);

ALTER TABLE lg_receipt_items
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4),
    ALTER COLUMN unit_cost TYPE NUMERIC(14,4) USING unit_cost::numeric(14,4);

ALTER TABLE lg_threshold_approvals
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4),
    ALTER COLUMN value TYPE NUMERIC(14,4) USING value::numeric(14,4);

ALTER TABLE receipt_items
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4),
    ALTER COLUMN unit_cost TYPE NUMERIC(14,4) USING unit_cost::numeric(14,4);

ALTER TABLE requisition_items
    ALTER COLUMN approved_quantity TYPE NUMERIC(14,4) USING approved_quantity::numeric(14,4),
    ALTER COLUMN closed_short_quantity TYPE NUMERIC(14,4) USING closed_short_quantity::numeric(14,4),
    ALTER COLUMN replacement_authorised_quantity TYPE NUMERIC(14,4) USING replacement_authorised_quantity::numeric(14,4),
    ALTER COLUMN requested_quantity TYPE NUMERIC(14,4) USING requested_quantity::numeric(14,4),
    ALTER COLUMN suggested_quantity TYPE NUMERIC(14,4) USING suggested_quantity::numeric(14,4);

ALTER TABLE requisition_short_closures
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4);

ALTER TABLE return_request_items
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4);

ALTER TABLE stock_adjustments
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4);

ALTER TABLE stock_movements
    ALTER COLUMN quantity TYPE NUMERIC(14,4) USING quantity::numeric(14,4);
