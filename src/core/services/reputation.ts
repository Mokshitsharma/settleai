// Trust score (spec F15): clamp(50 + sum of deltas) to 0..100. Deltas come from the active policy.
import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/core/db/client";
import { reputationEvents, users } from "@/core/db/schema";
import { newId } from "@/core/ids";

export class ReputationService {
  async apply(tx: DbOrTx, args: { userId: string; delta: number; reason: string; refType: string; refId: string }): Promise<number> {
    await tx.insert(reputationEvents).values({ id: newId("rep"), ...args });
    const [row] = await tx
      .update(users)
      .set({ trustScore: sql`least(100, greatest(0, ${users.trustScore} + ${args.delta}))` })
      .where(eq(users.id, args.userId))
      .returning({ trustScore: users.trustScore });
    return row.trustScore;
  }
}
