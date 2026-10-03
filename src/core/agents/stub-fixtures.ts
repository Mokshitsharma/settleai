// Registers deterministic outputs for every agent on the offline stub LLM.
import { StubLlmAdapter } from "@/core/adapters/llm/stub";
import { stubScope } from "./scoping/stub";
import { stubVerify } from "./verification/stub";

export function createStubLlm(): StubLlmAdapter {
  return new StubLlmAdapter().register("scoping", "default", stubScope).register("verification", "default", stubVerify);
}
