import type { WorkflowNode, ExecutionContext } from "../types";
import { replaceVariables, parseCondition, evaluateCondition } from "./utils";

export function handleVariableNode(
  node: WorkflowNode,
  context: ExecutionContext
): void {
  const name = node.properties["name"];
  const value: string | number = replaceVariables(
    node.properties["value"] || "",
    context
  );

  const numValue = parseFloat(value);
  if (!isNaN(numValue) && value === String(numValue)) {
    context.variables.set(name, numValue);
  } else {
    context.variables.set(name, value);
  }
}

function evaluateExpression(
  expr: string,
  context: ExecutionContext
): number | string {
  const replaced = replaceVariables(expr, context);

  const arithmeticMatch = replaced.match(
    /^(-?\d+(?:\.\d+)?)\s*([+\-*/%])\s*(-?\d+(?:\.\d+)?)$/
  );
  if (arithmeticMatch) {
    const left = parseFloat(arithmeticMatch[1]);
    const operator = arithmeticMatch[2];
    const right = parseFloat(arithmeticMatch[3]);

    switch (operator) {
      case "+": return left + right;
      case "-": return left - right;
      case "*": return left * right;
      case "/":
        if (right === 0) throw new Error("Division by zero");
        return left / right;
      case "%": return left % right;
    }
  }

  const num = parseFloat(replaced);
  if (!isNaN(num) && replaced === String(num)) return num;

  return replaced;
}

export async function handleSetNode(
  node: WorkflowNode,
  context: ExecutionContext
): Promise<void> {
  const name = node.properties["name"];
  const expr = node.properties["value"] || "";

  if (!name) {
    throw new Error("Set node missing 'name' property");
  }

  const result = evaluateExpression(expr, context);
  context.variables.set(name, result);
}

export function handleIfNode(
  node: WorkflowNode,
  context: ExecutionContext
): boolean {
  const conditionStr = node.properties["condition"] || "";
  const condition = parseCondition(conditionStr);
  if (!condition) {
    throw new Error(`Invalid condition format: ${conditionStr}`);
  }
  return evaluateCondition(condition, context);
}

export function handleWhileNode(
  node: WorkflowNode,
  context: ExecutionContext
): boolean {
  const conditionStr = node.properties["condition"] || "";
  const condition = parseCondition(conditionStr);
  if (!condition) {
    throw new Error(`Invalid condition format: ${conditionStr}`);
  }
  return evaluateCondition(condition, context);
}

export async function handleSleepNode(
  node: WorkflowNode,
  context: ExecutionContext
): Promise<void> {
  const durationStr = replaceVariables(node.properties["duration"] || "0", context);
  const duration = parseInt(durationStr, 10);
  if (duration > 0) {
    await new Promise(resolve => setTimeout(resolve, duration));
  }
}
