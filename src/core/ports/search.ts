export interface PrecedentDoc {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface SearchPort {
  readonly driver: "elastic" | "pgvector" | "none";
  index(doc: PrecedentDoc): Promise<void>;
  search(query: string, limit: number): Promise<PrecedentDoc[]>;
}
