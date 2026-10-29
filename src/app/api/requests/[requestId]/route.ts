import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getConnection } from "@/lib/mysql";

const requestIdSchema = z.string().regex(/^\d{1,20}$/);

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const user = await requireSession();
    const { requestId } = await context.params;
    requestIdSchema.parse(requestId);
    const connection = await getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT requested_by, status, fulfilled_quantity
         FROM resource_requests
         WHERE request_id = ?
         FOR UPDATE`,
        [requestId],
      );
      const target = (rows as Array<Record<string, unknown>>)[0];
      if (!target) {
        await connection.rollback();
        return NextResponse.json({ error: "Request was not found." }, { status: 404 });
      }
      if (user.role !== "ADMIN" && String(target.requested_by) !== user.userId) {
        await connection.rollback();
        return NextResponse.json({ error: "You can only withdraw your own requests." }, { status: 403 });
      }
      if (target.status !== "PENDING" || Number(target.fulfilled_quantity) !== 0) {
        await connection.rollback();
        return NextResponse.json(
          { error: "Only pending requests with no fulfilled quantity can be withdrawn." },
          { status: 409 },
        );
      }

      await connection.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id) VALUES (?, 'REQUEST_WITHDRAWN', 'resource_request', ?)",
        [user.userId, requestId],
      );
      await connection.execute(
        "UPDATE resource_requests SET status = 'CANCELLED' WHERE request_id = ?",
        [requestId],
      );
      await connection.commit();
      return NextResponse.json({ ok: true });
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
