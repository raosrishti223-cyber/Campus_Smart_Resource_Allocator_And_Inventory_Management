USE campus_resources;

-- SELECT, JOIN and ORDER BY: inventory by campus location.
SELECT r.sku, r.name, l.name AS location, i.on_hand, i.checked_out, i.minimum_required,
       GREATEST(i.on_hand - i.checked_out - i.minimum_required, 0) AS safely_reallocatable
FROM inventory i
JOIN resources r ON r.resource_id = i.resource_id
JOIN locations l ON l.location_id = i.location_id
ORDER BY r.name, l.name;

-- GROUP BY and aggregate functions: total stock by department.
SELECT d.code, d.name, SUM(i.on_hand) AS units_held,
       COUNT(DISTINCT i.resource_id) AS resource_types
FROM departments d
JOIN locations l ON l.department_id = d.department_id
JOIN inventory i ON i.location_id = l.location_id
GROUP BY d.department_id, d.code, d.name
ORDER BY units_held DESC;

-- HAVING: departments holding more than five units of a resource.
SELECT d.name, r.name AS resource_name, SUM(i.on_hand) AS units_held
FROM inventory i
JOIN locations l ON l.location_id = i.location_id
JOIN departments d ON d.department_id = l.department_id
JOIN resources r ON r.resource_id = i.resource_id
GROUP BY d.department_id, d.name, r.resource_id, r.name
HAVING SUM(i.on_hand) > 5
ORDER BY units_held DESC;

-- Subquery: resources whose stock is below the average resource stock.
SELECT resource_id, resource_name, total_on_hand
FROM v_resource_availability
WHERE total_on_hand < (
  SELECT AVG(total_on_hand)
  FROM v_resource_availability
);

-- INSERT: create a request through the application after authentication.
-- UPDATE: sp_approve_transfer updates inventory and request fulfillment atomically.
SELECT request_id, status, quantity, fulfilled_quantity
FROM resource_requests
ORDER BY created_at DESC;

-- DELETE: use a connection-local temporary table so no application data is changed.
CREATE TEMPORARY TABLE dml_delete_demo (
  demo_id INT PRIMARY KEY,
  label VARCHAR(40) NOT NULL
);
INSERT INTO dml_delete_demo (demo_id, label) VALUES (1, 'Temporary example');
DELETE FROM dml_delete_demo WHERE demo_id = 1;
SELECT COUNT(*) AS remaining_demo_rows FROM dml_delete_demo;
DROP TEMPORARY TABLE dml_delete_demo;

-- Indexed lookup used by inventory search.
EXPLAIN
SELECT resource_id, sku, name
FROM resources
WHERE name LIKE 'Arduino%';
