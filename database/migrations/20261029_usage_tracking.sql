USE campus_resources;

ALTER TABLE resources
  ADD COLUMN resource_type ENUM('REUSABLE', 'CONSUMABLE') NOT NULL DEFAULT 'REUSABLE'
  AFTER unit;

UPDATE resources SET resource_type = 'CONSUMABLE' WHERE sku = 'FAC-PAP-001';

ALTER TABLE inventory
  ADD COLUMN checked_out INT UNSIGNED NOT NULL DEFAULT 0 AFTER on_hand,
  ADD CONSTRAINT chk_inventory_checked_out CHECK (checked_out <= on_hand);

ALTER TABLE stock_transactions
  MODIFY COLUMN transaction_type
    ENUM('RECEIPT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'CHECKOUT', 'RETURN', 'CONSUME')
    NOT NULL;

CREATE TABLE resource_usage (
  usage_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resource_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  action ENUM('CHECKOUT', 'RETURN', 'CONSUME') NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_resource_usage_quantity CHECK (quantity > 0),
  CONSTRAINT fk_usage_resource FOREIGN KEY (resource_id)
    REFERENCES resources (resource_id) ON DELETE RESTRICT,
  CONSTRAINT fk_usage_location FOREIGN KEY (location_id)
    REFERENCES locations (location_id) ON DELETE RESTRICT,
  CONSTRAINT fk_usage_actor FOREIGN KEY (actor_id)
    REFERENCES users (user_id) ON DELETE RESTRICT,
  INDEX idx_usage_resource_location_created (resource_id, location_id, created_at)
);
