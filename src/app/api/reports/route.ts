import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getConnection } from "@/lib/mysql";
import { getMaintenanceReportsCollection } from "@/lib/mongodb";
import type { RowDataPacket } from "mysql2";
import { ObjectId } from "mongodb";

const reportSchema = z.object({
  resourceId: z.string().regex(/^\d+$/),
  title: z.string().trim().min(4).max(120),
  condition: z.enum(["GOOD", "FAIR", "POOR", "DAMAGED"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  notes: z.string().trim().min(10).max(2000),
  tags: z.array(z.string().trim().min(1).max(32)).max(10).default([]),
});

const reportStatusSchema = z.object({
  status: z.enum(["IN_PROGRESS", "RESOLVED"]),
});

export async function GET() {
  try {
    const user = await requireSession();
    const collection = await getMaintenanceReportsCollection();
    const reportFilter = user.role === "ADMIN"
      ? { status: { $in: ["OPEN", "IN_PROGRESS"] as const } }
      : { "reportedBy.userId": user.userId };
    const [reports, summary] = await Promise.all([
      collection.find(reportFilter).sort({ createdAt: -1 }).limit(100).toArray(),
      collection.aggregate<{
        _id: { severity: string; status: string };
        count: number;
      }>([
        { $match: reportFilter },
        { $group: { _id: { severity: "$severity", status: "$status" }, count: { $sum: 1 } } },
        { $sort: { "_id.severity": 1, "_id.status": 1 } },
      ]).toArray(),
    ]);
    return NextResponse.json({
      reports: reports.map((report) => ({
        reportId: report._id.toString(),
        resourceName: report.resourceName,
        title: report.title,
        condition: report.condition,
        severity: report.severity,
        notes: report.notes,
        status: report.status,
        reportedBy: report.reportedBy,
        statusUpdatedBy: report.statusUpdatedBy,
        createdAt: report.createdAt,
      })),
      summary: summary.map((item) => ({
        severity: item._id.severity,
        status: item._id.status,
        count: item.count,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSession(["ADMIN"]);
    const body = reportStatusSchema.parse(await request.json());
    const reportId = new URL(request.url).searchParams.get("reportId");
    if (!reportId || !/^[a-f\d]{24}$/i.test(reportId)) {
      return NextResponse.json({ error: "A valid report ID is required." }, { status: 400 });
    }

    const collection = await getMaintenanceReportsCollection();
    const nextAllowedStatus = body.status === "IN_PROGRESS" ? "OPEN" : "IN_PROGRESS";
    const result = await collection.updateOne(
      { _id: new ObjectId(reportId), status: nextAllowedStatus },
      {
        $set: {
          status: body.status,
          updatedAt: new Date(),
          statusUpdatedBy: { userId: user.userId, name: user.fullName },
        },
      },
    );
    if (result.matchedCount === 0) {
      const report = await collection.findOne({ _id: new ObjectId(reportId) }, { projection: { status: 1 } });
      if (!report) return NextResponse.json({ error: "Condition report was not found." }, { status: 404 });
      return NextResponse.json({ error: "The report status changed. Refresh and try again." }, { status: 409 });
    }

    return NextResponse.json({ ok: true, status: body.status, updatedBy: user.fullName });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSession();
    if (user.role === "ADMIN") {
      return NextResponse.json({ error: "Administrators can review and update reports, but cannot submit them." }, { status: 403 });
    }
    const body = reportSchema.parse(await request.json());
    const connection = await getConnection();
    let insertedId: ObjectId | null = null;
    try {
      await connection.beginTransaction();
      const [resourceRows] = await connection.execute<RowDataPacket[]>(
        "SELECT resource_id, name FROM resources WHERE resource_id = ? FOR UPDATE",
        [body.resourceId],
      );
      if (resourceRows.length === 0) {
        await connection.rollback();
        return NextResponse.json({ error: "The selected resource does not exist." }, { status: 404 });
      }

      const now = new Date();
      const collection = await getMaintenanceReportsCollection();
      const result = await collection.insertOne({
        resourceId: body.resourceId,
        resourceName: String(resourceRows[0].name),
        departmentId: user.departmentId,
        reportedBy: { userId: user.userId, name: user.fullName },
        title: body.title,
        condition: body.condition,
        severity: body.severity,
        notes: body.notes,
        tags: body.tags,
        status: "OPEN",
        createdAt: now,
        updatedAt: now,
      });
      insertedId = result.insertedId;
      await connection.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type) VALUES (?, 'MAINTENANCE_REPORT_CREATED', 'maintenance_report')",
        [user.userId],
      );
      await connection.commit();
      return NextResponse.json({ reportId: result.insertedId.toString() }, { status: 201 });
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if (insertedId) {
        const collection = await getMaintenanceReportsCollection();
        await collection.deleteOne({ _id: insertedId }).catch(() => undefined);
      }
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return apiError(error);
  }
}
