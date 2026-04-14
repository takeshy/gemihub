import { parseWorkflowContentByName } from "./parser";

const SYSTEM_VARS: ReadonlySet<string> = new Set([
  "__workflowName__", "__lastModel__", "__date__", "__time__", "__datetime__",
  "_clipboard",
]);

const SAVE_PROPERTIES = [
  "saveTo", "saveFileTo", "savePathTo", "saveStatus",
  "saveImageTo", "saveUiTo",
];

/**
 * Infer a workflow's externally-required input variables from its YAML.
 *
 * A variable counts as "input" when it is read via `{{var}}` in a node
 * property but never initialized by a `variable`/`set` node or by a `save*`
 * target. System-provided variables (prefixed with `_`) are excluded. Used
 * when creating / updating a skill so SKILL.md frontmatter's
 * `inputVariables` stays in sync with the workflow the author actually wrote.
 */
export function extractInputVariables(
  workflowContent: string,
  workflowName?: string,
): string[] {
  let workflow;
  try {
    workflow = parseWorkflowContentByName(workflowContent, workflowName);
  } catch {
    return [];
  }

  const varPattern = /\{\{(\w[\w.[\]]*?)(?::json)?\}\}/g;
  const used = new Set<string>();
  const initialized = new Set<string>();

  for (const [, node] of workflow.nodes) {
    if ((node.type === "variable" || node.type === "set") && node.properties.name) {
      initialized.add(node.properties.name);
    }
    for (const prop of SAVE_PROPERTIES) {
      const target = node.properties[prop];
      if (target) initialized.add(target);
    }
    for (const value of Object.values(node.properties)) {
      varPattern.lastIndex = 0;
      let match;
      while ((match = varPattern.exec(String(value))) !== null) {
        const rootVar = match[1].split(/[.[\]]/)[0];
        if (rootVar) used.add(rootVar);
      }
    }
  }

  const inputs: string[] = [];
  for (const v of used) {
    if (!initialized.has(v) && !SYSTEM_VARS.has(v)) inputs.push(v);
  }
  return inputs.sort();
}
