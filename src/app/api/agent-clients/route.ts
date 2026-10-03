import { eq } from "drizzle-orm";
import { getContainer } from "@/core/container";
import { apiClients } from "@/core/db/schema";
import { handle, requireUser } from "../_lib";

/** The payer's AI agent clients (never returns key hashes). */
export const GET = handle(async () => {
  const user = await requireUser(["payer", "admin"]);
  const c = await getContainer();
  const rows = await c.dbHandle.db
    .select({ id: apiClients.id, name: apiClients.name, status: apiClients.status, scopes: apiClients.scopes })
    .from(apiClients)
    .where(eq(apiClients.ownerUserId, user.id));
  return Response.json({ clients: rows });
});
