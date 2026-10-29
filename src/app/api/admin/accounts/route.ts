import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getConnection, getPool } from "@/lib/mysql";

const accountSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128),
  role: z.enum(["STAFF", "STUDENT"]),
  departmentId: z.coerce.number().int().positive(),
});

function isDuplicateEmailError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ER_DUP_ENTRY";
}

export async function GET() {
  try {
    await requireSession(["ADMIN"]);
    const [departmentRows] = await getPool().execute<RowDataPacket[]>(
      "SELECT department_id, name FROM departments ORDER BY name",
    );
    const [accountRows] = await getPool().execute<RowDataPacket[]>(
      `SELECT u.user_id, u.full_name, u.email, u.role, u.is_active,
              d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
       WHERE u.role IN ('STAFF', 'STUDENT')
       ORDER BY u.full_name, u.email`,
    );
    return NextResponse.json({
      departments: departmentRows.map((department) => ({
        departmentId: String(department.department_id),
        name: String(department.name),
      })),
      accounts: accountRows.map((account) => ({
        userId: String(account.user_id),
        fullName: String(account.full_name),
        email: String(account.email),
        role: String(account.role),
        departmentName: account.department_name == null ? "No department" : String(account.department_name),
        isActive: Boolean(account.is_active),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireSession(["ADMIN"]);
    const body = accountSchema.parse(await request.json());
    const passwordHash = await bcrypt.hash(body.password, 12);
    const connection = await getConnection();
    try {
      await connection.beginTransaction();
      const [departments] = await connection.execute<RowDataPacket[]>(
        "SELECT department_id FROM departments WHERE department_id = ? FOR UPDATE",
        [body.departmentId],
      );
      if (departments.length === 0) {
        await connection.rollback();
        return NextResponse.json({ error: "The selected department does not exist." }, { status: 400 });
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (department_id, full_name, email, password_hash, role)
         VALUES (?, ?, ?, ?, ?)`,
        [body.departmentId, body.fullName, body.email, passwordHash, body.role],
      );
      await connection.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id) VALUES (?, 'USER_CREATED', 'user', ?)",
        [admin.userId, result.insertId],
      );
      await connection.commit();
      return NextResponse.json({ userId: String(result.insertId) }, { status: 201 });
    } catch (error) {
      await connection.rollback();
      if (isDuplicateEmailError(error)) {
        return NextResponse.json({ error: "An account with this email address already exists." }, { status: 409 });
      }
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    return apiError(error);
  }
}
