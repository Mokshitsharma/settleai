import { z } from "zod";

export const CONTRACTS_VERSION = 1;

export const MinorAmount = z.number().int().nonnegative();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const Currency = z.literal("USD");
export const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);
export const Category = z.enum(["delivery", "digital_deliverable", "onsite_service"]);
export type Category = z.infer<typeof Category>;
export const Role = z.enum(["payer", "worker", "admin"]);
export type Role = z.infer<typeof Role>;
