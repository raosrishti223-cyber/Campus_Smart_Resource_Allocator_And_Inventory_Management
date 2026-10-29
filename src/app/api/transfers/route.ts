import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getPool } from "@/lib/mysql";

const transferSchema = z.object({
  requestId: z.coerce.number().int().positive(),
  sourceLocationId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive().max(100000),
});

export async function POST(request: Request) {
  try {
    const user = await requireSession(["ADMIN"]);
    const body = transferSchema.parse(await request.json());
    await getPool().query("CALL sp_approve_transfer(?, ?, ?, ?)", [
      body.requestId,
      body.sourceLocationId,
      body.quantity,
      user.userId,
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
