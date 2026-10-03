import type { PrecedentDoc, SearchPort } from "@/core/ports/search";

/** In-memory keyword search. Placeholder until Elastic or pgvector precedent search (F22, P2). */
export class InMemorySearchAdapter implements SearchPort {
  readonly driver = "none" as const;
  private docs: PrecedentDoc[] = [];

  async index(doc: PrecedentDoc): Promise<void> {
    this.docs = this.docs.filter((d) => d.id !== doc.id).concat(doc);
  }

  async search(query: string, limit: number): Promise<PrecedentDoc[]> {
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
    return this.docs
      .map((d) => ({ d, score: terms.filter((t) => d.text.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.d);
  }
}
