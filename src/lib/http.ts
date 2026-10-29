import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationError, AuthorizationError } from "@/lib/auth";

export function apiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Please check the submitted information.", details: error.issues.map((issue) => issue.message) },
      { status: 400 },
    );
  }
  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  console.error("API request failed:", error);
  return NextResponse.json(
    { error: "The request could not be completed. Check the server configuration and logs." },
    { status: 500 },
  );
}
