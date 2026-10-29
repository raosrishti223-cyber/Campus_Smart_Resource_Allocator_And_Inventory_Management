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

const demoDepartments = [
  { code: "CSE", name: "Computer Science" },
  { code: "ECE", name: "Electronics and Communication" },
  { code: "MECH", name: "Mechanical Engineering" },
  { code: "CIVIL", name: "Civil Engineering" },
  { code: "EEE", name: "Electrical Engineering" },
];

function accountFor(role, number, departmentId) {
  const prefix = role === "STAFF" ? "staff" : "student";
  const paddedNumber = String(number).padStart(2, "0");
  return {
    fullName: `Demo ${role === "STAFF" ? "Staff" : "Student"} ${paddedNumber}`,
    email: `${prefix}${paddedNumber}@campus.local`,
    password: `${prefix[0].toUpperCase()}${prefix.slice(1)}${paddedNumber}@Demo`,
    role,
    departmentId,
  };
}

try {
  const accountDepartments = [];
  await connection.beginTransaction();

  const [admins] = await connection.execute(
    `SELECT user_id FROM users
     WHERE email = 'admin@campus.local' AND role = 'ADMIN' AND is_active = TRUE
     LIMIT 1 FOR UPDATE`,
  );
  if (admins.length === 0) {
    throw new Error("Active admin@campus.local was not found. Run npm run db:seed first.");
  }
  const adminId = admins[0].user_id;

  for (const department of demoDepartments) {
    const [existingDepartments] = await connection.execute(
      "SELECT department_id, code, name FROM departments WHERE code = ? OR name = ? FOR UPDATE",
      [department.code, department.name],
    );
    if (existingDepartments.length > 1) {
      throw new Error(`Department code/name conflict for ${department.code} (${department.name}).`);
    }
    const existing = existingDepartments[0];
    if (existing && (existing.code !== department.code || existing.name !== department.name)) {
      throw new Error(`Department code/name conflict for ${department.code} (${department.name}).`);
    }

    let departmentId;
    if (existing) {
      departmentId = existing.department_id;
    } else {
      const [result] = await connection.execute(
        "INSERT INTO departments (name, code) VALUES (?, ?)",
        [department.name, department.code],
      );
      departmentId = result.insertId;
    }

    const [locations] = await connection.execute(
      "SELECT location_id FROM locations WHERE department_id = ? AND is_active = TRUE LIMIT 1",
      [departmentId],
    );
    if (locations.length === 0) {
      const locationName = `Demo ${department.code} Office`;
      const [namedLocations] = await connection.execute(
        "SELECT location_id, department_id FROM locations WHERE name = ? FOR UPDATE",
        [locationName],
      );
      if (namedLocations.length > 0 && String(namedLocations[0].department_id) !== String(departmentId)) {
        throw new Error(`A different department already uses the location name ${locationName}.`);
      }
      if (namedLocations.length === 0) {
        await connection.execute(
          "INSERT INTO locations (department_id, name, location_type) VALUES (?, ?, 'OFFICE')",
          [departmentId, locationName],
        );
      }
    }

    accountDepartments.push(departmentId);
  }

  const accounts = [
    ...Array.from({ length: 25 }, (_, index) => accountFor("STAFF", index + 1, accountDepartments[index % accountDepartments.length])),
    ...Array.from({ length: 50 }, (_, index) => accountFor("STUDENT", index + 1, accountDepartments[index % accountDepartments.length])),
  ];
  let created = 0;
  let alreadyPresent = 0;
  for (const account of accounts) {
    const [existingUsers] = await connection.execute(
      "SELECT user_id, full_name, role, department_id, password_hash FROM users WHERE email = ? FOR UPDATE",
      [account.email],
    );
    const existing = existingUsers[0];
    if (existing) {
      if (
        existing.full_name !== account.fullName ||
        existing.role !== account.role ||
        String(existing.department_id) !== String(account.departmentId)
      ) {
        throw new Error(`The demo email ${account.email} is already used by a different account.`);
      }
      if (!(await bcrypt.compare(account.password, existing.password_hash))) {
        throw new Error(`The demo email ${account.email} already exists with a different password.`);
      }
      alreadyPresent += 1;
      continue;
    }

    const passwordHash = await bcrypt.hash(account.password, 12);
    const [result] = await connection.execute(
      `INSERT INTO users (department_id, full_name, email, password_hash, role)
       VALUES (?, ?, ?, ?, ?)`,
      [account.departmentId, account.fullName, account.email, passwordHash, account.role],
    );
    await connection.execute(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id)
       VALUES (?, 'USER_CREATED', 'user', ?)`,
      [adminId, result.insertId],
    );
    created += 1;
  }

  await connection.commit();
  console.log(`Demo users ready: ${created} created by admin, ${alreadyPresent} already existed; 25 staff and 50 students total.`);
  console.log("Staff login: staff01@campus.local through staff25@campus.local; password pattern Staff01@Demo through Staff25@Demo.");
  console.log("Student login: student01@campus.local through student50@campus.local; password pattern Student01@Demo through Student50@Demo.");
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
