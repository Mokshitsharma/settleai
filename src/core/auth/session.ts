// Session: an HS256-signed JWT in an httpOnly cookie. Demo mode lets judges "Login as" a role.
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { config } from "@/core/config";
import { getContainer } from "@/core/container";
import type { Role } from "@/core/contracts";
import { users } from "@/core/db/schema";

export const SESSION_COOKIE = "settleai_session";
const MAX_AGE_SECONDS = 8 * 3600;

export const DEMO_USERS: Record<Role, string> = { payer: "usr_ravi", worker: "usr_asha", admin: "usr_meera" };

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  email: string;
  paypalEmail: string | null;
  trustScore: number;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(config().SESSION_SECRET);
}

export async function issueSession(userId: string, role: Role): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function setSessionCookie(userId: string, role: Role): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await issueSession(userId, role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Current user from the session cookie, re-read from the database (role checks never trust the token alone). */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const c = await getContainer();
    const [u] = await c.dbHandle.db.select().from(users).where(eq(users.id, payload.sub));
    if (!u) return null;
    return { id: u.id, name: u.name, role: u.role, email: u.email, paypalEmail: u.paypalEmail, trustScore: u.trustScore };
  } catch {
    return null;
  }
}
