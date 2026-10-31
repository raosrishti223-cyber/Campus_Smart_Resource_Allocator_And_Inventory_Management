import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { availableCheckoutAllocation } from "@/lib/usage-allocation";
import { apiError } from "@/lib/http";
import { getPool } from "@/lib/mysql";

export async function GET(request: Request) {
  try {
    const user = await requireSession();
    const search = new URL(request.url).searchParams.get("search")?.trim().slice(0, 100) ?? "";
    const [rows] = await getPool().execute(
      `SELECT a.resource_id, a.sku, a.resource_name, a.category_name, a.unit,
              a.resource_type, a.total_on_hand, a.total_checked_out,
              a.campus_minimum, a.reallocatable, a.is_low_stock,
              COALESCE(JSON_ARRAYAGG(
                IF(i.inventory_id IS NULL, NULL, JSON_OBJECT(
                  'locationId', l.location_id,
                  'locationName', l.name,
                  'departmentId', l.department_id,
                  'departmentName', d.name,
                  'onHand', i.on_hand,
                  'checkedOut', i.checked_out,
                  'myCheckedOut', COALESCE(mine_usage.checked_out, 0),
                  'myAllocated', COALESCE(mine_allocation.allocated, 0),
                  'myCheckoutTotal', COALESCE(mine_usage.checked_out_total, 0),
                  'myConsumed', COALESCE(mine_usage.consumed, 0),
                  'minimumRequired', i.minimum_required,
                  'reorderLevel', i.reorder_level
                ))
              ), JSON_ARRAY()) AS locations
       FROM v_resource_availability a
       LEFT JOIN inventory i ON i.resource_id = a.resource_id
       LEFT JOIN locations l ON l.location_id = i.location_id
       LEFT JOIN departments d ON d.department_id = l.department_id
       LEFT JOIN (
         SELECT t.resource_id, t.destination_location_id AS location_id,
                SUM(t.quantity) AS allocated
         FROM transfers t
         JOIN resource_requests r ON r.request_id = t.request_id
         JOIN stock_transactions transfer_transaction
           ON transfer_transaction.resource_id = t.resource_id
          AND transfer_transaction.location_id = t.destination_location_id
          AND transfer_transaction.transaction_type = 'TRANSFER_IN'
          AND transfer_transaction.reference_type = 'TRANSFER'
          AND transfer_transaction.reference_id = t.transfer_id
         WHERE r.requested_by = ?
         GROUP BY t.resource_id, t.destination_location_id
       ) mine_allocation
         ON mine_allocation.resource_id = i.resource_id
        AND mine_allocation.location_id = i.location_id
       LEFT JOIN (
         SELECT ru.resource_id, ru.location_id,
                GREATEST(SUM(CASE ru.action WHEN 'CHECKOUT' THEN ru.quantity WHEN 'RETURN' THEN -ru.quantity ELSE 0 END), 0) AS checked_out,
                SUM(CASE ru.action WHEN 'CHECKOUT' THEN ru.quantity ELSE 0 END) AS checked_out_total,
                SUM(CASE ru.action WHEN 'CONSUME' THEN ru.quantity ELSE 0 END) AS consumed
         FROM resource_usage ru
         WHERE ru.actor_id = ?
         GROUP BY ru.resource_id, ru.location_id
       ) mine_usage ON mine_usage.resource_id = i.resource_id AND mine_usage.location_id = i.location_id
       WHERE a.resource_name LIKE ? OR a.sku LIKE ? OR a.category_name LIKE ?
       GROUP BY a.resource_id, a.sku, a.resource_name, a.category_name, a.unit,
                a.resource_type, a.total_on_hand, a.total_checked_out, a.campus_minimum,
                a.reallocatable, a.is_low_stock
       ORDER BY a.resource_name`,
      [user.userId, user.userId, `%${search}%`, `%${search}%`, `%${search}%`],
    );
    const resources = (rows as Array<Record<string, unknown>>).map((row) => {
      const locationData: unknown = typeof row.locations === "string" ? JSON.parse(row.locations) : row.locations;
      const locations = Array.isArray(locationData) ? locationData : [];
      return {
        ...row,
        resource_id: String(row.resource_id),
        resource_type: String(row.resource_type),
        total_on_hand: Number(row.total_on_hand),
        total_checked_out: Number(row.total_checked_out),
        campus_minimum: Number(row.campus_minimum),
        reallocatable: Number(row.reallocatable),
        is_low_stock: Boolean(row.is_low_stock),
        locations: locations
          .filter((location): location is Record<string, unknown> => typeof location === "object" && location !== null)
          .map((location) => ({
          locationId: String(location.locationId),
          locationName: String(location.locationName),
          departmentId: location.departmentId == null ? null : String(location.departmentId),
          departmentName: location.departmentName == null ? null : String(location.departmentName),
          onHand: Number(location.onHand),
          checkedOut: Number(location.checkedOut),
          myCheckedOut: Number(location.myCheckedOut),
          myAvailableAllocation: availableCheckoutAllocation(
            Number(location.myAllocated),
            Number(location.myConsumed),
            Number(location.myCheckoutTotal),
          ),
          minimumRequired: Number(location.minimumRequired),
          reorderLevel: Number(location.reorderLevel),
          })),
      };
    });
    return NextResponse.json({ resources });
  } catch (error) {
    return apiError(error);
  }
}
