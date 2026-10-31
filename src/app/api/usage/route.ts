import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getConnection, getPool } from "@/lib/mysql";
import { availableCheckoutAllocation } from "@/lib/usage-allocation";

const usageSchema = z.object({
  resourceId: z.coerce.number().int().positive(),
  locationId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive().max(100000),
  action: z.enum(["CHECKOUT", "RETURN", "CONSUME"]),
});

export async function GET() {
  try {
    await requireSession(["ADMIN"]);
    const [holderRows] = await getPool().execute<RowDataPacket[]>(
      `SELECT ru.resource_id, r.name AS resource_name, r.unit,
              l.name AS location_name, location_department.name AS location_department,
              holder.full_name AS holder_name, holder_department.name AS holder_department,
              GREATEST(SUM(CASE ru.action WHEN 'CHECKOUT' THEN ru.quantity WHEN 'RETURN' THEN -ru.quantity ELSE 0 END), 0) AS quantity
       FROM resource_usage ru
       JOIN resources r ON r.resource_id = ru.resource_id AND r.resource_type = 'REUSABLE'
       JOIN locations l ON l.location_id = ru.location_id
       LEFT JOIN departments location_department ON location_department.department_id = l.department_id
       JOIN users holder ON holder.user_id = ru.actor_id
       LEFT JOIN departments holder_department ON holder_department.department_id = holder.department_id
       WHERE ru.action IN ('CHECKOUT', 'RETURN')
         AND holder.role IN ('STAFF', 'STUDENT')
       GROUP BY ru.resource_id, r.name, r.unit, l.location_id, l.name,
                location_department.name, holder.user_id, holder.full_name, holder_department.name
       HAVING quantity > 0
       ORDER BY r.name, l.name, holder.full_name`,
    );
    const [unassignedRows] = await getPool().execute<RowDataPacket[]>(
      `SELECT r.name AS resource_name, r.unit, l.name AS location_name,
              location_department.name AS location_department,
              GREATEST(i.checked_out - COALESCE(known.assigned_quantity, 0), 0) AS unassigned_quantity
       FROM inventory i
       JOIN resources r ON r.resource_id = i.resource_id AND r.resource_type = 'REUSABLE'
       JOIN locations l ON l.location_id = i.location_id
       LEFT JOIN departments location_department ON location_department.department_id = l.department_id
       LEFT JOIN (
         SELECT balances.resource_id, balances.location_id, SUM(balances.outstanding) AS assigned_quantity
         FROM (
           SELECT ru2.resource_id, ru2.location_id, ru2.actor_id,
                  GREATEST(SUM(CASE ru2.action WHEN 'CHECKOUT' THEN ru2.quantity WHEN 'RETURN' THEN -ru2.quantity ELSE 0 END), 0) AS outstanding
           FROM resource_usage ru2
           JOIN users usage_actor ON usage_actor.user_id = ru2.actor_id
           WHERE ru2.action IN ('CHECKOUT', 'RETURN')
             AND usage_actor.role IN ('STAFF', 'STUDENT')
           GROUP BY ru2.resource_id, ru2.location_id, ru2.actor_id
         ) balances
         GROUP BY balances.resource_id, balances.location_id
       ) known ON known.resource_id = i.resource_id AND known.location_id = i.location_id
       WHERE i.checked_out > COALESCE(known.assigned_quantity, 0)
       ORDER BY r.name, l.name`,
    );
    return NextResponse.json({
      checkouts: holderRows.map((row) => ({
        resourceId: String(row.resource_id),
        resourceName: String(row.resource_name),
        unit: String(row.unit),
        locationName: String(row.location_name),
        locationDepartment: row.location_department == null ? "Campus store" : String(row.location_department),
        holderName: String(row.holder_name),
        holderDepartment: row.holder_department == null ? "No department" : String(row.holder_department),
        quantity: Number(row.quantity),
      })),
      unassigned: unassignedRows.map((row) => ({
        resourceName: String(row.resource_name),
        unit: String(row.unit),
        locationName: String(row.location_name),
        locationDepartment: row.location_department == null ? "Campus store" : String(row.location_department),
        quantity: Number(row.unassigned_quantity),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSession();
    if (user.role === "ADMIN") {
      return NextResponse.json({ error: "Administrators approve requests; only the requesting staff member or student can record usage." }, { status: 403 });
    }
    const body = usageSchema.parse(await request.json());
    const connection = await getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT r.resource_type, i.on_hand, i.checked_out, i.minimum_required,
                l.department_id
         FROM inventory i
         JOIN resources r ON r.resource_id = i.resource_id
         JOIN locations l ON l.location_id = i.location_id
         WHERE i.resource_id = ? AND i.location_id = ?
         FOR UPDATE`,
        [body.resourceId, body.locationId],
      );
      const stock = rows[0];
      if (!stock) {
        await connection.rollback();
        return NextResponse.json({ error: "No inventory record exists for that resource and location." }, { status: 404 });
      }
      if (
        user.departmentId === null ||
        stock.department_id === null ||
        String(stock.department_id) !== user.departmentId
      ) {
        await connection.rollback();
        return NextResponse.json({ error: "You can only manage usage for your own department's locations." }, { status: 403 });
      }

      const resourceType = String(stock.resource_type);
      if (body.action === "CONSUME" && resourceType !== "CONSUMABLE") {
        await connection.rollback();
        return NextResponse.json({ error: "Only consumable resources can be recorded as used." }, { status: 400 });
      }
      if (body.action !== "CONSUME" && resourceType !== "REUSABLE") {
        await connection.rollback();
        return NextResponse.json({ error: "Consumable resources cannot be checked out or returned." }, { status: 400 });
      }

      const onHand = Number(stock.on_hand);
      const checkedOut = Number(stock.checked_out);
      const minimumRequired = Number(stock.minimum_required);
      const available = onHand - checkedOut - minimumRequired;
      let userCheckedOut = 0;
      let userAvailableAllocation = available;
      if (body.action !== "RETURN") {
        const [allocationRows] = await connection.execute<RowDataPacket[]>(
          `SELECT
             COALESCE((
               SELECT SUM(t.quantity)
               FROM transfers t
               JOIN resource_requests rr ON rr.request_id = t.request_id
               JOIN stock_transactions transfer_transaction
                 ON transfer_transaction.resource_id = t.resource_id
                AND transfer_transaction.location_id = t.destination_location_id
                AND transfer_transaction.transaction_type = 'TRANSFER_IN'
                AND transfer_transaction.reference_type = 'TRANSFER'
                AND transfer_transaction.reference_id = t.transfer_id
                WHERE rr.requested_by = ?
                  AND t.resource_id = ?
                  AND t.destination_location_id = ?
             ), 0) AS allocated,
             COALESCE((
                SELECT SUM(quantity)
               FROM resource_usage
               WHERE resource_id = ? AND location_id = ? AND actor_id = ? AND action = 'CONSUME'
             ), 0) AS consumed,
             GREATEST(COALESCE((
               SELECT SUM(CASE action WHEN 'CHECKOUT' THEN quantity WHEN 'RETURN' THEN -quantity ELSE 0 END)
               FROM resource_usage
               WHERE resource_id = ? AND location_id = ? AND actor_id = ?
             ), 0), 0) AS checked_out,
             COALESCE((
               SELECT SUM(quantity)
               FROM resource_usage
               WHERE resource_id = ? AND location_id = ? AND actor_id = ? AND action = 'CHECKOUT'
             ), 0) AS checked_out_total`,
          [
            user.userId, body.resourceId, body.locationId,
            body.resourceId, body.locationId, user.userId,
            body.resourceId, body.locationId, user.userId,
            body.resourceId, body.locationId, user.userId,
          ],
        );
        const ownAllocation = Number(allocationRows[0].allocated);
        const ownConsumed = Number(allocationRows[0].consumed);
        userCheckedOut = Math.min(checkedOut, Number(allocationRows[0].checked_out));
        userAvailableAllocation = availableCheckoutAllocation(
          ownAllocation,
          ownConsumed,
          Number(allocationRows[0].checked_out_total),
        );
      }
      if (body.action === "RETURN") {
        const [usageRows] = await connection.execute<RowDataPacket[]>(
          `SELECT GREATEST(COALESCE(SUM(
             CASE action WHEN 'CHECKOUT' THEN quantity WHEN 'RETURN' THEN -quantity ELSE 0 END
           ), 0), 0) AS checked_out
           FROM resource_usage
           WHERE resource_id = ? AND location_id = ? AND actor_id = ?`,
          [body.resourceId, body.locationId, user.userId],
        );
        userCheckedOut = Math.min(checkedOut, Number(usageRows[0].checked_out));
      }
      if (body.action === "RETURN" && body.quantity > userCheckedOut) {
        await connection.rollback();
        return NextResponse.json({ error: `You can only return up to your ${userCheckedOut} currently checked-out units.` }, { status: 409 });
      }
      if (body.action !== "RETURN" && body.quantity > available) {
        await connection.rollback();
        return NextResponse.json({ error: `Only ${Math.max(0, available)} units are available above the protected minimum.` }, { status: 409 });
      }
      if (body.action !== "RETURN" && body.quantity > userAvailableAllocation) {
        await connection.rollback();
        return NextResponse.json(
          { error: `Only ${userAvailableAllocation} units from your approved requests are available for use.` },
          { status: 403 },
        );
      }

      if (body.action === "CHECKOUT") {
        await connection.execute(
          "UPDATE inventory SET checked_out = checked_out + ? WHERE resource_id = ? AND location_id = ?",
          [body.quantity, body.resourceId, body.locationId],
        );
      } else if (body.action === "RETURN") {
        await connection.execute(
          "UPDATE inventory SET checked_out = checked_out - ? WHERE resource_id = ? AND location_id = ?",
          [body.quantity, body.resourceId, body.locationId],
        );
      } else {
        await connection.execute(
          "UPDATE inventory SET on_hand = on_hand - ? WHERE resource_id = ? AND location_id = ?",
          [body.quantity, body.resourceId, body.locationId],
        );
      }

      const [usageResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO resource_usage (resource_id, location_id, actor_id, action, quantity)
         VALUES (?, ?, ?, ?, ?)`,
        [body.resourceId, body.locationId, user.userId, body.action, body.quantity],
      );
      const quantityDelta = body.action === "RETURN" ? body.quantity : -body.quantity;
      await connection.execute(
        `INSERT INTO stock_transactions
           (resource_id, location_id, actor_id, transaction_type, quantity_delta, reference_type, reference_id)
         VALUES (?, ?, ?, ?, ?, 'USAGE', ?)`,
        [body.resourceId, body.locationId, user.userId, body.action, quantityDelta, usageResult.insertId],
      );
      await connection.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id) VALUES (?, ?, 'resource_usage', ?)",
        [user.userId, body.action, usageResult.insertId],
      );
      await connection.commit();
      return NextResponse.json({ usageId: String(usageResult.insertId) });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return apiError(error);
  }
}
