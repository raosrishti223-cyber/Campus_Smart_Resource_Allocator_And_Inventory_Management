import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
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
                  'myCheckoutClosed', COALESCE(
                    mine_usage.last_return_sequence > mine_allocation.latest_transfer_sequence
                    AND mine_usage.checked_out = 0,
                    0
                  ),
                  'myAvailableAllocation', GREATEST(
                    CASE
                      WHEN a.resource_type = 'REUSABLE' AND mine_usage.last_return_sequence IS NOT NULL
                        THEN COALESCE(mine_allocation.allocation_since_return, 0)
                      ELSE COALESCE(mine_allocation.allocated, 0)
                    END -
                    COALESCE(mine_usage.checked_out, 0) -
                    COALESCE(mine_usage.consumed, 0),
                    0
                  ),
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
                SUM(t.quantity) AS allocated,
                SUM(CASE
                  WHEN transfer_transaction.transaction_id > COALESCE(latest_return.last_return_sequence, 0)
                    THEN t.quantity
                  ELSE 0
                END) AS allocation_since_return,
                MAX(transfer_transaction.transaction_id) AS latest_transfer_sequence
         FROM transfers t
         JOIN resource_requests r ON r.request_id = t.request_id
         LEFT JOIN stock_transactions transfer_transaction
           ON transfer_transaction.resource_id = t.resource_id
          AND transfer_transaction.location_id = t.destination_location_id
          AND transfer_transaction.transaction_type = 'TRANSFER_IN'
          AND transfer_transaction.reference_type = 'TRANSFER'
          AND transfer_transaction.reference_id = t.transfer_id
         LEFT JOIN (
           SELECT ru.resource_id, ru.location_id, ru.actor_id,
                  MAX(return_transaction.transaction_id) AS last_return_sequence
           FROM resource_usage ru
           JOIN stock_transactions return_transaction
             ON return_transaction.resource_id = ru.resource_id
            AND return_transaction.location_id = ru.location_id
            AND return_transaction.transaction_type = 'RETURN'
            AND return_transaction.reference_type = 'USAGE'
            AND return_transaction.reference_id = ru.usage_id
           WHERE ru.action = 'RETURN'
           GROUP BY ru.resource_id, ru.location_id, ru.actor_id
         ) latest_return
           ON latest_return.resource_id = t.resource_id
          AND latest_return.location_id = t.destination_location_id
          AND latest_return.actor_id = r.requested_by
         WHERE r.requested_by = ?
         GROUP BY t.resource_id, t.destination_location_id
       ) mine_allocation
         ON mine_allocation.resource_id = i.resource_id
        AND mine_allocation.location_id = i.location_id
       LEFT JOIN (
         SELECT ru.resource_id, ru.location_id,
                GREATEST(SUM(CASE ru.action WHEN 'CHECKOUT' THEN ru.quantity WHEN 'RETURN' THEN -ru.quantity ELSE 0 END), 0) AS checked_out,
                MAX(CASE WHEN ru.action = 'RETURN' THEN usage_transaction.transaction_id END) AS last_return_sequence,
                SUM(CASE ru.action WHEN 'CONSUME' THEN ru.quantity ELSE 0 END) AS consumed
         FROM resource_usage ru
         LEFT JOIN stock_transactions usage_transaction
           ON usage_transaction.resource_id = ru.resource_id
          AND usage_transaction.location_id = ru.location_id
          AND usage_transaction.transaction_type = 'RETURN'
          AND usage_transaction.reference_type = 'USAGE'
          AND usage_transaction.reference_id = ru.usage_id
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
          myCheckoutClosed: Boolean(Number(location.myCheckoutClosed)),
          myAvailableAllocation: Number(location.myAvailableAllocation),
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
