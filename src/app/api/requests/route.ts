import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getConnection, getPool } from "@/lib/mysql";
import { getLocalDateString } from "@/lib/date";

const requestSchema = z.object({
  resourceId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive().max(100000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  neededBy: z.string().date().optional().or(z.literal(""))
    .refine((value) => !value || value >= getLocalDateString(), "Needed-by date cannot be before today."),
  purpose: z.string().trim().min(8).max(500),
});

export async function GET() {
  try {
    const user = await requireSession();
    const requestScope = user.role === "ADMIN"
      ? ""
      : "WHERE r.requested_by = ?";
    const params = user.role === "ADMIN" ? [] : [user.userId];
    const [rows] = await getPool().execute(
      `SELECT r.request_id, r.department_id, r.resource_id, r.requested_by, r.quantity,
              r.fulfilled_quantity, r.priority, r.status, r.needed_by, r.purpose,
              r.created_at, res.name AS resource_name, res.unit,
              d.name AS department_name, u.full_name AS requester_name,
              (
                SELECT actor.full_name
                FROM audit_events ae
                LEFT JOIN users actor ON actor.user_id = ae.actor_id
                WHERE ae.entity_type = 'resource_request'
                  AND ae.entity_id = r.request_id
                  AND ae.action = 'REQUEST_WITHDRAWN'
                ORDER BY ae.created_at DESC, ae.audit_id DESC
                LIMIT 1
              ) AS withdrawn_by_name
       FROM resource_requests r
       JOIN resources res ON res.resource_id = r.resource_id
       JOIN departments d ON d.department_id = r.department_id
       JOIN users u ON u.user_id = r.requested_by
       ${requestScope}
       ORDER BY FIELD(r.priority, 'URGENT', 'HIGH', 'MEDIUM', 'LOW'), r.created_at DESC
       LIMIT 100`,
      params,
    );
    return NextResponse.json({ requests: rows });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSession();
    if (user.role === "ADMIN") {
      return NextResponse.json({ error: "Administrators cannot create resource requests." }, { status: 403 });
    }
    if (!user.departmentId) {
      return NextResponse.json({ error: "Your account must be assigned to a department before creating a request." }, { status: 400 });
    }
    const body = requestSchema.parse(await request.json());
    const connection = await getConnection();
    try {
      await connection.beginTransaction();
      const [resourceRows] = await connection.execute(
        "SELECT resource_id FROM resources WHERE resource_id = ? FOR UPDATE",
        [body.resourceId],
      );
      if ((resourceRows as unknown[]).length === 0) {
        await connection.rollback();
        return NextResponse.json({ error: "The selected resource does not exist." }, { status: 404 });
      }
      const [result] = await connection.execute(
        `INSERT INTO resource_requests
           (department_id, resource_id, requested_by, quantity, priority, needed_by, purpose)
         VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?)`,
        [user.departmentId, body.resourceId, user.userId, body.quantity, body.priority, body.neededBy ?? "", body.purpose],
      );
      const insertId = (result as { insertId: number | bigint }).insertId;
      await connection.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id) VALUES (?, 'REQUEST_CREATED', 'resource_request', ?)",
        [user.userId, insertId],
      );
      await connection.commit();
      return NextResponse.json({ requestId: String(insertId) }, { status: 201 });
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
