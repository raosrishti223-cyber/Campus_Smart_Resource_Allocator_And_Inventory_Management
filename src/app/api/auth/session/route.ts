import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    const user = await getSession();
    return NextResponse.json({ user });
  } catch (error) {
    return apiError(error);
  }
}
