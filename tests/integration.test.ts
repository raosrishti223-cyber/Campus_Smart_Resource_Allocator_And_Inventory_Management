import assert from "node:assert/strict";
import test from "node:test";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

const appUrl = process.env.TEST_APP_URL;
const staffPassword = process.env.TEST_STAFF_PASSWORD;

test(
  "API protects transfer approvals and administrator account management",
  { skip: !appUrl || !staffPassword ? "Set TEST_APP_URL and TEST_STAFF_PASSWORD to run HTTP integration checks." : false },
  async () => {
    const baseUrl = appUrl!;
    const transferBody = JSON.stringify({ requestId: 1, sourceLocationId: 1, quantity: 1 });
    const unauthenticated = await fetch(new URL("/api/transfers", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: transferBody,
    });
    assert.equal(unauthenticated.status, 401);
    const unauthenticatedAccounts = await fetch(new URL("/api/admin/accounts", baseUrl));
    assert.equal(unauthenticatedAccounts.status, 401);

    const login = await fetch(new URL("/api/auth/login", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.TEST_STAFF_EMAIL ?? "staff@campus.local",
        password: staffPassword,
      }),
    });
    assert.equal(login.status, 200, "The configured seeded staff account must be able to sign in.");
    const setCookie = login.headers.get("set-cookie");
    assert.ok(setCookie, "Login must return the session cookie.");

    const forbidden = await fetch(new URL("/api/transfers", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: setCookie.split(";")[0],
      },
      body: transferBody,
    });
    assert.equal(forbidden.status, 403);

    const forbiddenRecommendations = await fetch(new URL("/api/recommendations?requestId=1", baseUrl), {
      headers: { cookie: setCookie.split(";")[0] },
    });
    assert.equal(forbiddenRecommendations.status, 403);

    const pastDueRequest = await fetch(new URL("/api/requests", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: setCookie.split(";")[0],
      },
      body: JSON.stringify({
        resourceId: 1,
        quantity: 1,
        priority: "LOW",
        neededBy: "2000-01-01",
        purpose: "Integration request with a past due date",
      }),
    });
    assert.equal(pastDueRequest.status, 400);

    const forbiddenAccountList = await fetch(new URL("/api/admin/accounts", baseUrl), {
      headers: { cookie: setCookie.split(";")[0] },
    });
    assert.equal(forbiddenAccountList.status, 403);

    const forbiddenAccountCreate = await fetch(new URL("/api/admin/accounts", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: setCookie.split(";")[0],
      },
      body: JSON.stringify({
        fullName: "Not Allowed",
        email: "not-allowed@campus.local",
        password: "A-secure-test-password",
        role: "STUDENT",
        departmentId: 1,
      }),
    });
    assert.equal(forbiddenAccountCreate.status, 403);
  },
);

const testDatabase = process.env.MYSQL_TEST_DATABASE;
const mysqlConfigurationAvailable =
  Boolean(testDatabase && process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_PASSWORD);

test(
  "MySQL transfer rollback and low-stock triggers preserve database invariants",
  {
    skip: !mysqlConfigurationAvailable
      ? "Set MYSQL_TEST_DATABASE, MYSQL_HOST, MYSQL_USER, and MYSQL_PASSWORD to run MySQL integration checks."
      : false,
  },
  async () => {
    assert.match(
      testDatabase!,
      /^campus_resources_test(?:_[a-z0-9_]+)?$/i,
      "MYSQL_TEST_DATABASE must be a dedicated disposable database named campus_resources_test or campus_resources_test_<suffix>.",
    );

    const pool: Pool = mysql.createPool({
      host: process.env.MYSQL_HOST!,
      port: Number(process.env.MYSQL_PORT ?? "3306"),
      user: process.env.MYSQL_USER!,
      password: process.env.MYSQL_PASSWORD!,
      database: testDatabase,
      connectionLimit: 2,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });

    let departmentId: number | undefined;
    let userId: number | undefined;
    let categoryId: number | undefined;
    let resourceId: number | undefined;
    let sourceLocationId: number | undefined;
    let destinationLocationId: number | undefined;
    let requestId: number | undefined;
    let sourceInventoryId: number | undefined;
    let destinationInventoryId: number | undefined;

    async function insert(sql: string, values: Array<string | number>): Promise<number> {
      const [result] = await pool.execute<ResultSetHeader>(sql, values);
      return result.insertId;
    }

    try {
      const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
      departmentId = await insert("INSERT INTO departments (name, code) VALUES (?, ?)", [
        `Integration ${suffix}`,
        `T${suffix}`.slice(0, 16),
      ]);
      userId = await insert(
        "INSERT INTO users (department_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, 'ADMIN')",
        [departmentId, "Integration Admin", `integration_${suffix}@campus.local`, "not-used"],
      );
      categoryId = await insert("INSERT INTO categories (name, description) VALUES (?, ?)", [
        `Integration ${suffix}`,
        "Temporary integration test category",
      ]);
      sourceLocationId = await insert(
        "INSERT INTO locations (department_id, name, location_type) VALUES (?, ?, 'STORE')",
        [departmentId, `Integration Source ${suffix}`],
      );
      destinationLocationId = await insert(
        "INSERT INTO locations (department_id, name, location_type) VALUES (?, ?, 'LAB')",
        [departmentId, `Integration Destination ${suffix}`],
      );
      resourceId = await insert(
        "INSERT INTO resources (category_id, sku, name, unit, description) VALUES (?, ?, ?, 'unit', ?)",
        [categoryId, `TEST-${suffix}`, `Integration Resource ${suffix}`, "Temporary integration test resource"],
      );
      requestId = await insert(
        `INSERT INTO resource_requests
          (department_id, resource_id, requested_by, quantity, purpose)
         VALUES (?, ?, ?, 5, 'Integration test transfer rollback')`,
        [departmentId, resourceId, userId],
      );
      sourceInventoryId = await insert(
        `INSERT INTO inventory (resource_id, location_id, on_hand, minimum_required, reorder_level)
         VALUES (?, ?, 8, 5, 4)`,
        [resourceId, sourceLocationId],
      );
      destinationInventoryId = await insert(
        `INSERT INTO inventory (resource_id, location_id, on_hand, minimum_required, reorder_level)
         VALUES (?, ?, 2, 0, 3)`,
        [resourceId, destinationLocationId],
      );

      const [alertsBeforeRestock] = await pool.execute<RowDataPacket[]>(
        "SELECT alert_id FROM low_stock_alerts WHERE inventory_id = ? AND resolved_at IS NULL",
        [destinationInventoryId],
      );
      assert.equal(alertsBeforeRestock.length, 1, "Insert trigger should open a low-stock alert.");

      await pool.execute("UPDATE inventory SET on_hand = 5 WHERE inventory_id = ?", [destinationInventoryId]);
      await pool.execute("UPDATE inventory SET on_hand = 2 WHERE inventory_id = ?", [destinationInventoryId]);
      const [alertsAfterStockDrop] = await pool.execute<RowDataPacket[]>(
        "SELECT alert_id FROM low_stock_alerts WHERE inventory_id = ? AND resolved_at IS NULL",
        [destinationInventoryId],
      );
      assert.equal(alertsAfterStockDrop.length, 1, "Update trigger should open an alert when stock drops below reorder level.");

      await pool.execute("UPDATE inventory SET on_hand = 5 WHERE inventory_id = ?", [destinationInventoryId]);
      const [alertsAfterRestock] = await pool.execute<RowDataPacket[]>(
        "SELECT alert_id FROM low_stock_alerts WHERE inventory_id = ? AND resolved_at IS NOT NULL",
        [destinationInventoryId],
      );
      assert.equal(alertsAfterRestock.length, 1, "Update trigger should resolve the alert after restocking.");

      await assert.rejects(
        pool.query("CALL sp_approve_transfer(?, ?, ?, ?)", [requestId, sourceLocationId, 4, userId]),
        /protected minimum/i,
      );

      const [sourceRows] = await pool.execute<RowDataPacket[]>(
        "SELECT on_hand FROM inventory WHERE inventory_id = ?",
        [sourceInventoryId],
      );
      const [requestRows] = await pool.execute<RowDataPacket[]>(
        "SELECT fulfilled_quantity FROM resource_requests WHERE request_id = ?",
        [requestId],
      );
      const [transferRows] = await pool.execute<RowDataPacket[]>(
        "SELECT transfer_id FROM transfers WHERE request_id = ?",
        [requestId],
      );
      assert.equal(Number(sourceRows[0].on_hand), 8, "Rollback should preserve source stock.");
      assert.equal(Number(requestRows[0].fulfilled_quantity), 0, "Rollback should preserve request fulfillment.");
      assert.equal(transferRows.length, 0, "Rollback should not leave a transfer record.");
    } finally {
      if (requestId !== undefined) {
        await pool.execute("DELETE FROM transfers WHERE request_id = ?", [requestId]);
        await pool.execute("DELETE FROM resource_requests WHERE request_id = ?", [requestId]);
      }
      if (sourceInventoryId !== undefined) {
        await pool.execute("DELETE FROM inventory WHERE inventory_id = ?", [sourceInventoryId]);
      }
      if (destinationInventoryId !== undefined) {
        await pool.execute("DELETE FROM inventory WHERE inventory_id = ?", [destinationInventoryId]);
      }
      if (resourceId !== undefined) await pool.execute("DELETE FROM resources WHERE resource_id = ?", [resourceId]);
      if (sourceLocationId !== undefined) {
        await pool.execute("DELETE FROM locations WHERE location_id = ?", [sourceLocationId]);
      }
      if (destinationLocationId !== undefined) {
        await pool.execute("DELETE FROM locations WHERE location_id = ?", [destinationLocationId]);
      }
      if (userId !== undefined) await pool.execute("DELETE FROM users WHERE user_id = ?", [userId]);
      if (categoryId !== undefined) await pool.execute("DELETE FROM categories WHERE category_id = ?", [categoryId]);
      if (departmentId !== undefined) {
        await pool.execute("DELETE FROM departments WHERE department_id = ?", [departmentId]);
      }
      await pool.end();
    }
  },
);
