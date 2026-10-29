USE campus_resources;

ALTER TABLE procurement_requests
  ADD COLUMN supplier VARCHAR(160) NULL AFTER justification,
  ADD COLUMN ordered_at TIMESTAMP NULL AFTER supplier,
  ADD COLUMN received_at TIMESTAMP NULL AFTER ordered_at,
  ADD COLUMN received_location_id BIGINT UNSIGNED NULL AFTER received_at,
  ADD CONSTRAINT fk_procurement_received_location
    FOREIGN KEY (received_location_id) REFERENCES locations (location_id) ON DELETE SET NULL;
