import { eq } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { policies } from "@/core/db/schema";
import { Policy } from "@/core/contracts";
import defaultPolicy from "@/core/policy/default.json";

/** Active, versioned risk policy (one active row). Falls back to the bundled default. */
export class PolicyService {
  constructor(private readonly db: Db) {}

  async active(t: DbOrTx = this.db): Promise<Policy> {
    const [row] = await t.select().from(policies).where(eq(policies.active, true));
    return Policy.parse(row?.json ?? defaultPolicy);
  }
}
