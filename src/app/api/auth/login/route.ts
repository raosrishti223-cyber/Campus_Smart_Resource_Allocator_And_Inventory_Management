import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, isUserRole, SESSION_COOKIE } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getPool } from "@/lib/mysql";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  try {
    const credentials = loginSchema.parse(await request.json());
    const [rows] = await getPool().execute(
      `SELECT u.user_id, u.full_name, u.email, u.password_hash, u.role,
              u.department_id, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
       WHERE u.email = ? AND u.is_active = TRUE
       LIMIT 1`,
      [credentials.email.toLowerCase()],
    );
    const user = (rows as Array<Record<string, unknown>>)[0];
    if (!user || typeof user.password_hash !== "string" || !(await bcrypt.compare(credentials.password, user.password_hash))) {
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    if (!isUserRole(user.role)) {
      throw new Error("User account has an unsupported role.");
    }

    const sessionUser = {
      userId: String(user.user_id),
      fullName: String(user.full_name),
      email: String(user.email),
      role: user.role,
      departmentId: user.department_id == null ? null : String(user.department_id),
      departmentName: user.department_name == null ? null : String(user.department_name),
    };
    const token = await createSession(sessionUser);
    const response = NextResponse.json({ user: sessionUser });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
