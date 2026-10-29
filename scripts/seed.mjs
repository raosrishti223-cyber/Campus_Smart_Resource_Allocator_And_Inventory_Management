import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const connection = await mysql.createConnection({
  host: required("MYSQL_HOST"),
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: required("MYSQL_USER"),
  password: required("MYSQL_PASSWORD"),
  database: process.env.MYSQL_DATABASE ?? "campus_resources",
});

try {
  const adminPassword = required("SEED_ADMIN_PASSWORD");
  const staffPassword = required("SEED_STAFF_PASSWORD");
  const studentPassword = required("SEED_STUDENT_PASSWORD");
  if ([adminPassword, staffPassword, studentPassword].some((password) => password.length < 12)) {
    throw new Error("Seed passwords must be at least 12 characters.");
  }

  await connection.beginTransaction();
  await connection.query(
    "INSERT INTO departments (name, code) VALUES (?, ?), (?, ?), (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)",
    ["Computer Science", "CSE", "Electronics and Communication", "ECE", "Central Stores", "STORE"],
  );
  await connection.query(
    "INSERT INTO categories (name, description) VALUES (?, ?), (?, ?), (?, ?) ON DUPLICATE KEY UPDATE description = VALUES(description)",
    ["Electronics", "Reusable electronic lab equipment", "Furniture", "Shared teaching furniture", "Facilities", "General campus supplies"],
  );

  const [[cse], [ece], [store]] = await Promise.all([
    connection.query("SELECT department_id FROM departments WHERE code = 'CSE'"),
    connection.query("SELECT department_id FROM departments WHERE code = 'ECE'"),
    connection.query("SELECT department_id FROM departments WHERE code = 'STORE'"),
  ]);
  await connection.query(
    "INSERT INTO locations (department_id, name, location_type) VALUES (?, 'CSE Lab 1', 'LAB'), (?, 'ECE Lab 1', 'LAB'), (?, 'Central Store', 'STORE') ON DUPLICATE KEY UPDATE department_id = VALUES(department_id), is_active = TRUE",
    [cse[0].department_id, ece[0].department_id, store[0].department_id],
  );
  const [locations] = await connection.query(
    "SELECT location_id, name FROM locations WHERE name IN ('CSE Lab 1', 'ECE Lab 1', 'Central Store')",
  );
  const locationIds = Object.fromEntries(locations.map((row) => [row.name, row.location_id]));

  const adminHash = await bcrypt.hash(adminPassword, 12);
  const staffHash = await bcrypt.hash(staffPassword, 12);
  const studentHash = await bcrypt.hash(studentPassword, 12);
  await connection.query(
    "INSERT INTO users (department_id, full_name, email, password_hash, role) VALUES (?, 'Campus Administrator', 'admin@campus.local', ?, 'ADMIN'), (?, 'CSE Staff Member', 'staff@campus.local', ?, 'STAFF'), (?, 'CSE Student', 'student@campus.local', ?, 'STUDENT') ON DUPLICATE KEY UPDATE department_id = VALUES(department_id), full_name = VALUES(full_name), password_hash = VALUES(password_hash), role = VALUES(role), is_active = TRUE",
    [cse[0].department_id, adminHash, cse[0].department_id, staffHash, cse[0].department_id, studentHash],
  );

  const [[electronics]] = await connection.query("SELECT category_id FROM categories WHERE name = 'Electronics'");
  const [[furniture]] = await connection.query("SELECT category_id FROM categories WHERE name = 'Furniture'");
  const [[facilities]] = await connection.query("SELECT category_id FROM categories WHERE name = 'Facilities'");
  const seededResources = [
    [electronics.category_id, "ELEC-ARD-001", "Arduino Kit", "kit", "REUSABLE", "Reusable microcontroller and sensor starter kit"],
    [furniture.category_id, "FURN-PROJ-001", "HD Projector", "unit", "REUSABLE", "Shared teaching-room projector"],
    [facilities.category_id, "FAC-EXT-001", "Extension Board", "unit", "REUSABLE", "Surge-protected power extension board"],
    [electronics.category_id, "ELEC-LAP-001", "Campus Laptop", "unit", "REUSABLE", "Shared laptop for teaching and campus work"],
    [electronics.category_id, "ELEC-HUB-001", "USB-C Hub", "unit", "REUSABLE", "Multi-port USB-C adapter for campus laptops"],
    [electronics.category_id, "ELEC-MIC-001", "Digital Microscope", "unit", "REUSABLE", "Digital microscope for laboratory instruction"],
    [furniture.category_id, "FURN-CHA-001", "Office Chair", "unit", "REUSABLE", "Adjustable chair for campus offices and labs"],
    [facilities.category_id, "FAC-PAP-001", "Printer Paper", "ream", "CONSUMABLE", "A4 paper for campus printers"],
    [facilities.category_id, "FAC-GOG-001", "Safety Goggles", "pair", "REUSABLE", "Protective goggles for laboratory use"],
  ];
  await connection.query(
    `INSERT INTO resources (category_id, sku, name, unit, resource_type, description)
     VALUES ${seededResources.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
     ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), name = VALUES(name), unit = VALUES(unit), resource_type = VALUES(resource_type), description = VALUES(description)`,
    seededResources.flat(),
  );
  const [resourceRows] = await connection.query(
    "SELECT resource_id, sku FROM resources WHERE sku IN (?)",
    [seededResources.map((resource) => resource[1])],
  );
  const resourceIds = Object.fromEntries(resourceRows.map((row) => [row.sku, row.resource_id]));
  const inventory = [
    [resourceIds["ELEC-ARD-001"], locationIds["Central Store"], 2, 0, 1],
    [resourceIds["ELEC-ARD-001"], locationIds["CSE Lab 1"], 3, 2, 4],
    [resourceIds["ELEC-ARD-001"], locationIds["ECE Lab 1"], 15, 5, 6],
    [resourceIds["FURN-PROJ-001"], locationIds["Central Store"], 4, 1, 2],
    [resourceIds["FURN-PROJ-001"], locationIds["CSE Lab 1"], 2, 1, 1],
    [resourceIds["FURN-PROJ-001"], locationIds["ECE Lab 1"], 3, 1, 2],
    [resourceIds["FAC-EXT-001"], locationIds["Central Store"], 12, 2, 4],
    [resourceIds["FAC-EXT-001"], locationIds["CSE Lab 1"], 4, 2, 2],
    [resourceIds["ELEC-LAP-001"], locationIds["Central Store"], 6, 2, 3],
    [resourceIds["ELEC-LAP-001"], locationIds["CSE Lab 1"], 2, 1, 2],
    [resourceIds["ELEC-HUB-001"], locationIds["Central Store"], 8, 2, 3],
    [resourceIds["ELEC-HUB-001"], locationIds["CSE Lab 1"], 3, 1, 2],
    [resourceIds["ELEC-MIC-001"], locationIds["Central Store"], 2, 0, 1],
    [resourceIds["ELEC-MIC-001"], locationIds["ECE Lab 1"], 4, 1, 2],
    [resourceIds["FURN-CHA-001"], locationIds["Central Store"], 10, 2, 4],
    [resourceIds["FURN-CHA-001"], locationIds["CSE Lab 1"], 4, 1, 2],
    [resourceIds["FAC-PAP-001"], locationIds["Central Store"], 25, 5, 8],
    [resourceIds["FAC-PAP-001"], locationIds["CSE Lab 1"], 8, 2, 4],
    [resourceIds["FAC-PAP-001"], locationIds["ECE Lab 1"], 6, 2, 3],
    [resourceIds["FAC-GOG-001"], locationIds["Central Store"], 20, 4, 6],
    [resourceIds["FAC-GOG-001"], locationIds["CSE Lab 1"], 10, 3, 5],
    [resourceIds["FAC-GOG-001"], locationIds["ECE Lab 1"], 8, 3, 4],
  ];
  for (const [resourceId, locationId, onHand, minimum, reorder] of inventory) {
    await connection.query(
      "INSERT INTO inventory (resource_id, location_id, on_hand, minimum_required, reorder_level) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE minimum_required = VALUES(minimum_required), reorder_level = VALUES(reorder_level)",
      [resourceId, locationId, onHand, minimum, reorder],
    );
  }

  const [[staff]] = await connection.query("SELECT user_id FROM users WHERE email = 'staff@campus.local'");
  const [[requestCount]] = await connection.query("SELECT COUNT(*) AS count FROM resource_requests");
  if (Number(requestCount.count) === 0) {
    await connection.query(
      "INSERT INTO resource_requests (department_id, resource_id, requested_by, quantity, priority, needed_by, purpose) VALUES (?, ?, ?, 10, 'HIGH', DATE_ADD(CURRENT_DATE, INTERVAL 14 DAY), 'Microcontroller kits needed for the embedded systems laboratory sessions')",
      [cse[0].department_id, resourceIds["ELEC-ARD-001"], staff.user_id],
    );
  }
  await connection.commit();

  console.log("Seed complete. Sign in with admin@campus.local, staff@campus.local, or student@campus.local and the corresponding configured password.");
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
