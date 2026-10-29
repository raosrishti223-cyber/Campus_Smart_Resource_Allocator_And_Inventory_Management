import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getPool } from "@/lib/mysql";
import type { RowDataPacket } from "mysql2";

export async function GET() {
  try {
    const user = await requireSession();
    const requestScope = user.role === "ADMIN" ? "" : "AND r.requested_by = ?";
    const requestParams = user.role === "ADMIN" ? [] : [user.userId];
    const [[resourceMetrics], [requestMetrics], [opportunityMetrics], [recentRequests]] = await Promise.all([
      getPool().execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS resource_types,
                COALESCE(SUM(total_on_hand), 0) AS units_on_campus,
                COALESCE(SUM(is_low_stock), 0) AS low_stock_resources
         FROM v_resource_availability`,
      ),
      getPool().execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS pending_requests
         FROM resource_requests r
         WHERE r.status IN ('PENDING', 'PARTIALLY_FULFILLED') ${requestScope}`,
        requestParams,
      ),
      getPool().execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT r.request_id) AS reallocation_opportunities
         FROM resource_requests r
         JOIN inventory i ON i.resource_id = r.resource_id
         JOIN locations l ON l.location_id = i.location_id
         JOIN departments d ON d.department_id = r.department_id
         WHERE r.status IN ('PENDING', 'PARTIALLY_FULFILLED')
           AND i.on_hand - i.checked_out > i.minimum_required
           AND (l.department_id IS NULL OR l.department_id <> r.department_id)
           ${requestScope}`,
        requestParams,
      ),
      getPool().execute<RowDataPacket[]>(
        `SELECT r.request_id, r.quantity, r.fulfilled_quantity, r.priority, r.status,
                r.needed_by, r.created_at, r.purpose, res.name AS resource_name,
                res.unit, d.name AS department_name, u.full_name AS requester_name
         FROM resource_requests r
         JOIN resources res ON res.resource_id = r.resource_id
         JOIN departments d ON d.department_id = r.department_id
         JOIN users u ON u.user_id = r.requested_by
         WHERE r.status IN ('PENDING', 'PARTIALLY_FULFILLED') ${requestScope}
         ORDER BY FIELD(r.priority, 'URGENT', 'HIGH', 'MEDIUM', 'LOW'), r.created_at
         LIMIT 8`,
        requestParams,
      ),
    ]);
    return NextResponse.json({
      metrics: {
        resourceTypes: Number(resourceMetrics[0].resource_types),
        unitsOnCampus: Number(resourceMetrics[0].units_on_campus),
        lowStockResources: Number(resourceMetrics[0].low_stock_resources),
        pendingRequests: Number(requestMetrics[0].pending_requests),
        reallocationOpportunities: Number(opportunityMetrics[0].reallocation_opportunities),
      },
      recentRequests,
    });
  } catch (error) {
    return apiError(error);
  }
}
