import { z } from "zod";
import { DEMO_USERS, setSessionCookie } from "@/core/auth/session";
import { Role } from "@/core/contracts";
import { handle, readJson } from "../../_lib";

/** One-click "Login as" for judges (spec F01). Demo accounts only; no passwords exist. */
export const POST = handle(async (req: Request) => {
  const { role } = await readJson(req, z.object({ role: Role }));
  await setSessionCookie(DEMO_USERS[role], role);
  return Response.json({ ok: true, userId: DEMO_USERS[role], role });
});
