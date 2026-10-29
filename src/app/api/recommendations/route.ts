import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getPool } from "@/lib/mysql";
import { recommendReallocation } from "@/lib/recommendation";

const querySchema = z.object({ requestId: z.coerce.number().int().positive() });

export async function GET(request: Request) {
  try {
    await requireSession(["ADMIN"]);
    const { requestId } = querySchema.parse({
      requestId: new URL(request.url).searchParams.get("requestId"),
    });
    const pool = getPool();
    const [requestRows] = await pool.execute(
      `SELECT r.request_id, r.resource_id, r.department_id, r.requested_by, r.quantity,
              r.fulfilled_quantity, r.status, res.name AS resource_name, res.unit,
              requester.full_name AS requester_name,
              l.location_id AS destination_location_id, l.name AS destination_location_name
       FROM resource_requests r
       JOIN resources res ON res.resource_id = r.resource_id
       JOIN users requester ON requester.user_id = r.requested_by
       JOIN locations l ON l.department_id = r.department_id AND l.is_active = TRUE
       WHERE r.request_id = ?
       ORDER BY l.location_type = 'LAB' DESC, l.location_id
       LIMIT 1`,
      [requestId],
    );
    const target = (requestRows as Array<Record<string, unknown>>)[0];
    if (!target) return NextResponse.json({ error: "Request or destination location was not found." }, { status: 404 });
    if (!["PENDING", "PARTIALLY_FULFILLED"].includes(String(target.status))) {
      return NextResponse.json({ error: "This request is no longer open for fulfillment." }, { status: 409 });
    }

    const [stockRows] = await pool.execute(
      `SELECT i.location_id, l.name AS location_name, i.on_hand, i.checked_out, i.minimum_required
       FROM inventory i
       JOIN locations l ON l.location_id = i.location_id
       WHERE i.resource_id = ?
         AND i.on_hand - i.checked_out > i.minimum_required
         AND i.location_id <> ?
         AND (l.department_id IS NULL OR l.department_id <> ?)
       ORDER BY (l.location_type = 'STORE') DESC, (i.on_hand - i.checked_out - i.minimum_required) DESC`,
      [Number(target.resource_id), Number(target.destination_location_id), Number(target.department_id)],
    );
    const unfulfilled = Number(target.quantity) - Number(target.fulfilled_quantity);
    const result = recommendReallocation(
      (stockRows as Array<Record<string, unknown>>).map((row) => ({
        locationId: String(row.location_id),
        locationName: String(row.location_name),
        onHand: Number(row.on_hand),
        checkedOut: Number(row.checked_out),
        minimumRequired: Number(row.minimum_required),
      })),
      unfulfilled,
    );
    const [procurementRows] = await pool.execute(
      `SELECT COALESCE(SUM(quantity), 0) AS recommended_quantity
       FROM procurement_requests
       WHERE request_id = ? AND status IN ('RECOMMENDED', 'ORDERED')`,
      [requestId],
    );
    const recommendedProcurement = Number(
      (procurementRows as Array<{ recommended_quantity: number | string }>)[0]?.recommended_quantity ?? 0,
    );
    return NextResponse.json({
      request: {
        requestId: String(target.request_id),
        resourceName: target.resource_name,
        unit: target.unit,
        unfulfilledQuantity: unfulfilled,
        destinationLocationId: String(target.destination_location_id),
        destinationLocationName: target.destination_location_name,
        requesterName: target.requester_name,
      },
      ...result,
      procurementQuantity: Math.max(0, result.procurementQuantity - recommendedProcurement),
    });
  } catch (error) {
    return apiError(error);
  }
}
