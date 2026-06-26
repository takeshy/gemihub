// Public API for the Obsidian Bases engine.
// Profile: OBX-2026-06

import type {
  CompiledBase, BasesHostAdapter, QuerySnapshot, QueryResult,
} from "./types";
import { queryView } from "./query";

export { compileBase } from "./formula";
export { queryView } from "./query";
export { evaluate } from "./evaluator";
export { parseExpression } from "./parser";
export { parseBaseConfig, normalizePropertyId } from "./config";
export { createTestHost, createGemiHubHost } from "./host";
export type {
  CompiledBase, BasesHostAdapter, QuerySnapshot, QueryResult,
  Value, EvalContext, Diagnostic, BaseEntry, BaseEntryGroup,
  NormalizedBaseConfig, ViewConfig, FilterNode, HostFile, HostLink,
} from "./types";
export { valueToCanonical } from "./values";

export function query(
  base: CompiledBase,
  viewName: string,
  host: BasesHostAdapter,
  snapshot: QuerySnapshot,
): QueryResult {
  return queryView(base, viewName, host, snapshot);
}
