import type { DucessDataGateway } from "../../gateway/contract";

export function createLocalAdapter(): DucessDataGateway {
  throw new Error("Local adapter runtime is provided by src/data/runtime/ducess-gateway.js during Phase 3B.1");
}
