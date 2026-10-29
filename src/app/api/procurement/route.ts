import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getConnection, getPool } from "@/lib/mysql";

const procurementSchema = z.object({
  requestId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive().max(100000),
  justification: z.string().trim().min(8).max(500),
});

const procurementUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ORDER") }),
  z.object({
    action: z.literal("RECEIVE"),
    locationId: z.coerce.number().int().positive(),
    supplier: z.string().trim().max(160).optional().default(""),
  }),
]);

const procurementIdSchema = z.string().regex(/^\d{1,20}$/);

export async function GET() {
  try {
    await requireSession(["ADMIN"]);
    const [rows] = await getPool().execute<RowDataPacket[]>(
      `SELECT p.procurement_id, p.request_id, p.resource_id, p.quantity, p.status,
              p.justification, p.supplier, p.created_at, p.ordered_at, p.received_at,
              p.received_location_id, r.name AS resource_name, r.unit,
              requester.full_name AS recommended_by,
              rr.department_id AS request_department_id, rr.status AS request_status,
              preferred.location_id AS preferred_location_id,
              received.name AS received_location_name
       FROM procurement_requests p
       JOIN resources r ON r.resource_id = p.resource_id
       JOIN users requester ON requester.user_id = p.requested_by
       LEFT JOIN resource_requests rr ON rr.request_id = p.request_id
       LEFT JOIN locations preferred ON preferred.location_id = (
         SELECT candidate.location_id
         FROM locations candidate
         WHERE candidate.is_active = TRUE
           AND (candidate.location_type = 'STORE' OR candidate.department_id = rr.department_id)
         ORDER BY candidate.location_type = 'STORE' DESC, candidate.location_type = 'LAB' DESC, candidate.location_id
         LIMIT 1
       )
       LEFT JOIN locations received ON received.location_id = p.received_location_id
       ORDER BY FIELD(p.status, 'RECOMMENDED', 'ORDERED', 'RECEIVED', 'CANCELLED'), p.created_at DESC`,
    );
    const [locations] = await getPool().execute<RowDataPacket[]>(
      `SELECT location_id, name, location_type, department_id
       FROM locations WHERE is_active = TRUE
       ORDER BY location_type = 'STORE' DESC, name`,
    );
    return NextResponse.json({
      procurements: rows.map((row) => ({
        procurementId: String(row.procurement_id),
        requestId: row.request_id == null ? null : String(row.request_id),
        requestStatus: row.request_status == null ? null : String(row.request_status),
        resourceId: String(row.resource_id),
        resourceName: String(row.resource_name),
        unit: String(row.unit),
        quantity: Number(row.quantity),
        status: String(row.status),
        justification: String(row.justification),
        supplier: row.supplier == null ? "" : String(row.supplier),
        recommendedBy: String(row.recommended_by),
        createdAt: String(row.created_at),
        orderedAt: row.ordered_at == null ? null : String(row.ordered_at),
        receivedAt: row.received_at == null ? null : String(row.received_at),
        receivedLocationId: row.received_location_id == null ? null : String(row.received_location_id),
        receivedLocationName: row.received_location_name == null ? null : String(row.received_location_name),
        preferredLocationId: row.preferred_location_id == null ? null : String(row.preferred_location_id),
      })),
      locations: locations.map((row) => ({
        locationId: String(row.location_id),
        name: String(row.name),
        locationType: String(row.location_type),
        departmentId: row.department_id == null ? null : String(row.department_id),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSession(["ADMIN"]);
    const body = procurementSchema.parse(await request.json());
    const connection = await getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
      `SELECT r.resource_id, r.department_id,
                GREATEST(
                  CAST(r.quantity AS SIGNED) - CAST(r.fulfilled_quantity AS SIGNED) -
                  COALESCE((
                    SELECT SUM(CAST(p.quantity AS SIGNED)) FROM procurement_requests p
                    WHERE p.request_id = r.request_id AND p.status IN ('RECOMMENDED', 'ORDERED')
                  ), 0),
                  0
                ) AS remaining
       FROM resource_requests r
       WHERE r.request_id = ? AND r.status IN ('PENDING', 'PARTIALLY_FULFILLED')
       FOR UPDATE`,
        [body.requestId],
      );
      const target = (rows as Array<Record<string, unknown>>)[0];
      if (!target) {
        await connection.rollback();
        return NextResponse.json({ error: "Open request was not found." }, { status: 404 });
      }
      if (body.quantity > Number(target.remaining)) {
        await connection.rollback();
        return NextResponse.json({ error: "Procurement quantity exceeds the remaining unfulfilled request." }, { status: 400 });
      }
      const [result] = await connection.execute(
        `INSERT INTO procurement_requests
           (request_id, resource_id, requested_by, quantity, justification)
         VALUES (?, ?, ?, ?, ?)`,
        [body.requestId, Number(target.resource_id), user.userId, body.quantity, body.justification],
      );
      const insertId = (result as { insertId: number | bigint }).insertId;
      await connection.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id) VALUES (?, 'PROCUREMENT_RECOMMENDED', 'procurement_request', ?)",
        [user.userId, insertId],
      );
      await connection.commit();
      return NextResponse.json({ procurementId: String(insertId) }, { status: 201 });
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

export async function PATCH(request: Request) {
  try {
    const admin = await requireSession(["ADMIN"]);
    const procurementId = new URL(request.url).searchParams.get("procurementId");
    const parsedId = procurementIdSchema.safeParse(procurementId);
    if (!parsedId.success) {
      return NextResponse.json({ error: "A valid procurement ID is required." }, { status: 400 });
    }
    const body = procurementUpdateSchema.parse(await request.json());
    const connection = await getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT procurement_id, request_id, resource_id, quantity, status
         FROM procurement_requests
         WHERE procurement_id = ?
         FOR UPDATE`,
        [parsedId.data],
      );
      const procurement = rows[0];
      if (!procurement) {
        await connection.rollback();
        return NextResponse.json({ error: "Procurement record was not found." }, { status: 404 });
      }

      if (body.action === "ORDER") {
        if (procurement.status !== "RECOMMENDED") {
          await connection.rollback();
          return NextResponse.json({ error: "Only recommended procurements can be marked ordered." }, { status: 409 });
        }
        await connection.execute(
          "UPDATE procurement_requests SET status = 'ORDERED', ordered_at = CURRENT_TIMESTAMP WHERE procurement_id = ?",
          [parsedId.data],
        );
        await connection.execute(
          "INSERT INTO audit_events (actor_id, action, entity_type, entity_id) VALUES (?, 'PROCUREMENT_ORDERED', 'procurement_request', ?)",
          [admin.userId, parsedId.data],
        );
      } else {
        if (procurement.status !== "ORDERED") {
          await connection.rollback();
          return NextResponse.json({ error: "Only ordered procurements can be marked received." }, { status: 409 });
        }
        const [locationRows] = await connection.execute<RowDataPacket[]>(
          "SELECT location_id FROM locations WHERE location_id = ? AND is_active = TRUE FOR UPDATE",
          [body.locationId],
        );
        if (locationRows.length === 0) {
          await connection.rollback();
          return NextResponse.json({ error: "Choose an active destination location." }, { status: 400 });
        }
        await connection.execute(
          `INSERT INTO inventory (resource_id, location_id, on_hand, checked_out, minimum_required, reorder_level)
           VALUES (?, ?, ?, 0, 0, 0)
           ON DUPLICATE KEY UPDATE on_hand = on_hand + VALUES(on_hand)`,
          [procurement.resource_id, body.locationId, procurement.quantity],
        );
        await connection.execute(
          `INSERT INTO stock_transactions
             (resource_id, location_id, actor_id, transaction_type, quantity_delta, reference_type, reference_id, notes)
           VALUES (?, ?, ?, 'RECEIPT', ?, 'PROCUREMENT', ?, ?)`,
          [
            procurement.resource_id,
            body.locationId,
            admin.userId,
            procurement.quantity,
            parsedId.data,
            body.supplier ? `Procurement received from ${body.supplier}` : `Procurement #${parsedId.data} received`,
          ],
        );
        await connection.execute(
          `UPDATE procurement_requests
           SET status = 'RECEIVED', supplier = NULLIF(?, ''), received_location_id = ?,
               received_at = CURRENT_TIMESTAMP
           WHERE procurement_id = ? AND status = 'ORDERED'`,
          [body.supplier, body.locationId, parsedId.data],
        );
        await connection.execute(
          "INSERT INTO audit_events (actor_id, action, entity_type, entity_id) VALUES (?, 'PROCUREMENT_RECEIVED', 'procurement_request', ?)",
          [admin.userId, parsedId.data],
        );
      }

      await connection.commit();
      return NextResponse.json({ ok: true, status: body.action === "ORDER" ? "ORDERED" : "RECEIVED" });
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
