import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "campus_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 8;

export type UserRole = "ADMIN" | "STAFF" | "STUDENT";

export function isUserRole(value: unknown): value is UserRole {
  return value === "ADMIN" || value === "STAFF" || value === "STUDENT";
}

export type SessionUser = {
  userId: string;
  fullName: string;
  email: string;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
};

export class AuthenticationError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must be configured with at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secret());
}

export async function readSession(token: string): Promise<SessionUser | null> {
  const signingKey = secret();
  try {
    const { payload } = await jwtVerify(token, signingKey);
    if (
      typeof payload.userId !== "string" ||
      typeof payload.fullName !== "string" ||
      typeof payload.email !== "string" ||
      !isUserRole(payload.role)
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      fullName: payload.fullName,
      email: payload.email,
      role: payload.role,
      departmentId: typeof payload.departmentId === "string" ? payload.departmentId : null,
      departmentName: typeof payload.departmentName === "string" ? payload.departmentName : null,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? readSession(token) : null;
}

export async function requireSession(roles?: UserRole[]): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new AuthenticationError();
  if (roles && !roles.includes(user.role)) throw new AuthorizationError();
  return user;
}
