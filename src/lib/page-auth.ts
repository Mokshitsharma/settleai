import { redirect } from "next/navigation";
import { currentUser, type SessionUser } from "@/core/auth/session";
import type { Role } from "@/core/contracts";

/** Server pages: send signed-out visitors to the landing page, and wrong roles to their jobs list. */
export async function pageUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/");
  if (roles && !roles.includes(user.role)) redirect("/jobs");
  return user;
}
