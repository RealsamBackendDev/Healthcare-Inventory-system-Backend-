ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;

ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (
    movement_type IN ('receipt', 'import', 'opening_stock', 'dispensing', 'adjustment', 'return',
                      'return_restock', 'reconciliation', 'transfer_in', 'transfer_out',
                      'transit_in', 'transit_out', 'write_off', 'quarantine')
);
