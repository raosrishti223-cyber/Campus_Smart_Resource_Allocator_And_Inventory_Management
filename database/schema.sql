CREATE DATABASE IF NOT EXISTS campus_resources
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE campus_resources;

CREATE TABLE IF NOT EXISTS departments (
  department_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  code VARCHAR(16) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  user_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id BIGINT UNSIGNED NULL,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN', 'STAFF', 'STUDENT') NOT NULL DEFAULT 'STAFF',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_department FOREIGN KEY (department_id)
    REFERENCES departments (department_id) ON DELETE SET NULL
);

ALTER TABLE users
  MODIFY COLUMN role ENUM('ADMIN', 'STAFF', 'STUDENT') NOT NULL DEFAULT 'STAFF';

CREATE TABLE IF NOT EXISTS categories (
  category_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) NULL
);

CREATE TABLE IF NOT EXISTS locations (
  location_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL UNIQUE,
  location_type ENUM('STORE', 'LAB', 'OFFICE', 'OTHER') NOT NULL DEFAULT 'LAB',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_locations_department FOREIGN KEY (department_id)
    REFERENCES departments (department_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS resources (
  resource_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id BIGINT UNSIGNED NOT NULL,
  sku VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(140) NOT NULL,
  unit VARCHAR(32) NOT NULL DEFAULT 'unit',
  resource_type ENUM('REUSABLE', 'CONSUMABLE') NOT NULL DEFAULT 'REUSABLE',
  description VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_resources_category FOREIGN KEY (category_id)
    REFERENCES categories (category_id) ON DELETE RESTRICT,
  INDEX idx_resources_name (name)
);

CREATE TABLE IF NOT EXISTS inventory (
  inventory_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resource_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  on_hand INT UNSIGNED NOT NULL DEFAULT 0,
  checked_out INT UNSIGNED NOT NULL DEFAULT 0,
  minimum_required INT UNSIGNED NOT NULL DEFAULT 0,
  reorder_level INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_inventory_resource_location UNIQUE (resource_id, location_id),
  CONSTRAINT chk_inventory_checked_out CHECK (checked_out <= on_hand),
  CONSTRAINT chk_inventory_reorder CHECK (reorder_level >= 0),
  CONSTRAINT fk_inventory_resource FOREIGN KEY (resource_id)
    REFERENCES resources (resource_id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_location FOREIGN KEY (location_id)
    REFERENCES locations (location_id) ON DELETE RESTRICT,
  INDEX idx_inventory_location (location_id),
  INDEX idx_inventory_resource (resource_id)
);

CREATE TABLE IF NOT EXISTS resource_requests (
  request_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id BIGINT UNSIGNED NOT NULL,
  resource_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  fulfilled_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  priority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('PENDING', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED')
    NOT NULL DEFAULT 'PENDING',
  needed_by DATE NULL,
  purpose VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_request_quantity CHECK (quantity > 0),
  CONSTRAINT chk_request_fulfilled CHECK (fulfilled_quantity <= quantity),
  CONSTRAINT fk_requests_department FOREIGN KEY (department_id)
    REFERENCES departments (department_id) ON DELETE RESTRICT,
  CONSTRAINT fk_requests_resource FOREIGN KEY (resource_id)
    REFERENCES resources (resource_id) ON DELETE RESTRICT,
  CONSTRAINT fk_requests_user FOREIGN KEY (requested_by)
    REFERENCES users (user_id) ON DELETE RESTRICT,
  INDEX idx_requests_status_priority (status, priority, created_at),
  INDEX idx_requests_department (department_id)
);

CREATE TABLE IF NOT EXISTS transfers (
  transfer_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  resource_id BIGINT UNSIGNED NOT NULL,
  source_location_id BIGINT UNSIGNED NOT NULL,
  destination_location_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_transfer_quantity CHECK (quantity > 0),
  CONSTRAINT chk_transfer_locations CHECK (source_location_id <> destination_location_id),
  CONSTRAINT fk_transfers_request FOREIGN KEY (request_id)
    REFERENCES resource_requests (request_id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfers_resource FOREIGN KEY (resource_id)
    REFERENCES resources (resource_id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfers_source FOREIGN KEY (source_location_id)
    REFERENCES locations (location_id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfers_destination FOREIGN KEY (destination_location_id)
    REFERENCES locations (location_id) ON DELETE RESTRICT,
  CONSTRAINT fk_transfers_user FOREIGN KEY (approved_by)
    REFERENCES users (user_id) ON DELETE RESTRICT,
  INDEX idx_transfers_request (request_id, created_at)
);

CREATE TABLE IF NOT EXISTS stock_transactions (
  transaction_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resource_id BIGINT UNSIGNED NOT NULL,
  location_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  transaction_type ENUM('RECEIPT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'CHECKOUT', 'RETURN', 'CONSUME')
    NOT NULL,
  quantity_delta INT NOT NULL,
  reference_type VARCHAR(32) NULL,
  reference_id BIGINT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_stock_delta CHECK (quantity_delta <> 0),
  CONSTRAINT fk_stock_resource FOREIGN KEY (resource_id)
    REFERENCES resources (resource_id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_location FOREIGN KEY (location_id)
    REFERENCES locations (location_id) ON DELETE RESTRICT,
  CONSTRAINT fk_stock_actor FOREIGN KEY (actor_id)
    REFERENCES users (user_id) ON DELETE SET NULL,
  INDEX idx_stock_history (resource_id, location_id, created_at)
);

CREATE TABLE IF NOT EXISTS resource_usage (
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

CREATE TABLE IF NOT EXISTS low_stock_alerts (
  alert_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_id BIGINT UNSIGNED NOT NULL,
  observed_quantity INT UNSIGNED NOT NULL,
  reorder_level INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  CONSTRAINT fk_alert_inventory FOREIGN KEY (inventory_id)
    REFERENCES inventory (inventory_id) ON DELETE CASCADE,
  INDEX idx_alerts_open (resolved_at, created_at)
);

CREATE TABLE IF NOT EXISTS procurement_requests (
  procurement_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NULL,
  resource_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  status ENUM('RECOMMENDED', 'ORDERED', 'RECEIVED', 'CANCELLED')
    NOT NULL DEFAULT 'RECOMMENDED',
  justification VARCHAR(500) NOT NULL,
  supplier VARCHAR(160) NULL,
  ordered_at TIMESTAMP NULL,
  received_at TIMESTAMP NULL,
  received_location_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_procurement_quantity CHECK (quantity > 0),
  CONSTRAINT fk_procurement_request FOREIGN KEY (request_id)
    REFERENCES resource_requests (request_id) ON DELETE SET NULL,
  CONSTRAINT fk_procurement_resource FOREIGN KEY (resource_id)
    REFERENCES resources (resource_id) ON DELETE RESTRICT,
  CONSTRAINT fk_procurement_user FOREIGN KEY (requested_by)
    REFERENCES users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_procurement_received_location FOREIGN KEY (received_location_id)
    REFERENCES locations (location_id) ON DELETE SET NULL,
  INDEX idx_procurement_status (status, created_at)
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id)
    REFERENCES users (user_id) ON DELETE SET NULL,
  INDEX idx_audit_actor_created (actor_id, created_at)
);

CREATE TABLE IF NOT EXISTS maintenance_reports (
  report_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resource_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  reported_by BIGINT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  condition_rating ENUM('GOOD', 'FAIR', 'POOR', 'DAMAGED') NOT NULL,
  severity ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
  notes VARCHAR(2000) NOT NULL,
  tags JSON NOT NULL,
  status ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_maintenance_resource FOREIGN KEY (resource_id)
    REFERENCES resources (resource_id) ON DELETE RESTRICT,
  CONSTRAINT fk_maintenance_department FOREIGN KEY (department_id)
    REFERENCES departments (department_id) ON DELETE SET NULL,
  CONSTRAINT fk_maintenance_reporter FOREIGN KEY (reported_by)
    REFERENCES users (user_id) ON DELETE RESTRICT,
  INDEX idx_maintenance_resource_created (resource_id, created_at),
  INDEX idx_maintenance_status_severity_created (status, severity, created_at)
);

DROP TRIGGER IF EXISTS trg_inventory_low_stock_insert;
DROP TRIGGER IF EXISTS trg_inventory_low_stock_update;
DROP PROCEDURE IF EXISTS sp_approve_transfer;

CREATE OR REPLACE VIEW v_resource_availability AS
SELECT
  r.resource_id,
  r.sku,
  r.name AS resource_name,
  c.name AS category_name,
  r.unit,
  r.resource_type,
  COALESCE(SUM(i.on_hand), 0) AS total_on_hand,
  COALESCE(SUM(i.checked_out), 0) AS total_checked_out,
  COALESCE(SUM(i.minimum_required), 0) AS campus_minimum,
  COALESCE(SUM(
    CASE WHEN i.on_hand > i.checked_out + i.minimum_required
      THEN i.on_hand - i.checked_out - i.minimum_required
      ELSE 0
    END
  ), 0) AS reallocatable,
  COALESCE(MAX(i.on_hand - i.checked_out <= i.reorder_level), 0) AS is_low_stock
FROM resources r
JOIN categories c ON c.category_id = r.category_id
LEFT JOIN inventory i ON i.resource_id = r.resource_id
GROUP BY r.resource_id, r.sku, r.name, c.name, r.unit, r.resource_type;

DELIMITER //

CREATE TRIGGER trg_inventory_low_stock_insert
AFTER INSERT ON inventory
FOR EACH ROW
BEGIN
  IF NEW.on_hand - NEW.checked_out <= NEW.reorder_level THEN
    INSERT INTO low_stock_alerts (inventory_id, observed_quantity, reorder_level)
    VALUES (NEW.inventory_id, NEW.on_hand - NEW.checked_out, NEW.reorder_level);
  END IF;
END//

CREATE TRIGGER trg_inventory_low_stock_update
AFTER UPDATE ON inventory
FOR EACH ROW
BEGIN
  IF NEW.on_hand - NEW.checked_out <= NEW.reorder_level
     AND OLD.on_hand - OLD.checked_out > OLD.reorder_level THEN
    INSERT INTO low_stock_alerts (inventory_id, observed_quantity, reorder_level)
    VALUES (NEW.inventory_id, NEW.on_hand - NEW.checked_out, NEW.reorder_level);
  ELSEIF NEW.on_hand - NEW.checked_out > NEW.reorder_level
     AND OLD.on_hand - OLD.checked_out <= OLD.reorder_level THEN
    UPDATE low_stock_alerts
    SET resolved_at = CURRENT_TIMESTAMP
    WHERE inventory_id = NEW.inventory_id AND resolved_at IS NULL;
  END IF;
END//

CREATE PROCEDURE sp_approve_transfer(
  IN p_request_id BIGINT UNSIGNED,
  IN p_source_location_id BIGINT UNSIGNED,
  IN p_quantity INT UNSIGNED,
  IN p_actor_id BIGINT UNSIGNED
)
BEGIN
  DECLARE v_resource_id BIGINT UNSIGNED;
  DECLARE v_department_id BIGINT UNSIGNED;
  DECLARE v_destination_location_id BIGINT UNSIGNED;
  DECLARE v_remaining INT UNSIGNED;
  DECLARE v_on_hand INT UNSIGNED;
  DECLARE v_checked_out INT UNSIGNED;
  DECLARE v_minimum INT UNSIGNED;
  DECLARE v_request_status VARCHAR(32);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  IF p_quantity = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer quantity must be positive';
  END IF;

  START TRANSACTION;

  SELECT resource_id, department_id, quantity - fulfilled_quantity, status
    INTO v_resource_id, v_department_id, v_remaining, v_request_status
  FROM resource_requests
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF v_request_status IS NULL OR v_request_status NOT IN ('PENDING', 'PARTIALLY_FULFILLED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Request is not available for fulfillment';
  END IF;
  IF p_quantity > v_remaining THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Transfer exceeds the unfulfilled request quantity';
  END IF;

  SELECT location_id INTO v_destination_location_id
  FROM locations
  WHERE department_id = v_department_id AND is_active = TRUE
  ORDER BY location_type = 'LAB' DESC, location_id
  LIMIT 1;

  IF v_destination_location_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Requesting department has no active destination location';
  END IF;
  IF p_source_location_id = v_destination_location_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Source and destination locations must differ';
  END IF;

  SELECT on_hand, checked_out, minimum_required
    INTO v_on_hand, v_checked_out, v_minimum
  FROM inventory
  WHERE resource_id = v_resource_id AND location_id = p_source_location_id
  FOR UPDATE;

  IF v_on_hand IS NULL OR v_checked_out IS NULL OR v_minimum IS NULL
     OR v_on_hand < v_checked_out
     OR v_on_hand - v_checked_out < v_minimum THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Source stock would fall below its protected minimum';
  END IF;
  IF v_on_hand - v_checked_out - v_minimum < p_quantity THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Source stock would fall below its protected minimum';
  END IF;

  UPDATE inventory
  SET on_hand = on_hand - p_quantity
  WHERE resource_id = v_resource_id AND location_id = p_source_location_id;

  INSERT INTO inventory (resource_id, location_id, on_hand, minimum_required, reorder_level)
  VALUES (v_resource_id, v_destination_location_id, p_quantity, 0, 0)
  ON DUPLICATE KEY UPDATE on_hand = on_hand + p_quantity;

  INSERT INTO transfers (
    request_id, resource_id, source_location_id, destination_location_id, quantity, approved_by
  ) VALUES (
    p_request_id, v_resource_id, p_source_location_id, v_destination_location_id, p_quantity, p_actor_id
  );

  INSERT INTO stock_transactions (
    resource_id, location_id, actor_id, transaction_type, quantity_delta, reference_type, reference_id
  ) VALUES
    (v_resource_id, p_source_location_id, p_actor_id, 'TRANSFER_OUT', -p_quantity, 'TRANSFER', LAST_INSERT_ID()),
    (v_resource_id, v_destination_location_id, p_actor_id, 'TRANSFER_IN', p_quantity, 'TRANSFER', LAST_INSERT_ID());

  UPDATE resource_requests
  SET fulfilled_quantity = fulfilled_quantity + p_quantity,
      status = IF(fulfilled_quantity >= quantity, 'FULFILLED', 'PARTIALLY_FULFILLED')
  WHERE request_id = p_request_id;

  INSERT INTO audit_events (actor_id, action, entity_type, entity_id)
  VALUES (p_actor_id, 'TRANSFER_APPROVED', 'resource_request', p_request_id);

  COMMIT;
END//

DELIMITER ;
