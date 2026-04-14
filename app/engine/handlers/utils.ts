import type { ExecutionContext, ParsedCondition, ComparisonOperator } from "../types";

// Get value from object/JSON string using dot notation path
export function getNestedValue(data: unknown, path: string, context?: ExecutionContext): unknown {
  const parts = path.split(".");
  let current: unknown = data;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    const arrayMatch = part.match(/^(\w+)\[(\w+)\]$/);
    if (arrayMatch) {
      current = (current as Record<string, unknown>)[arrayMatch[1]];
      if (Array.isArray(current)) {
        const indexStr = arrayMatch[2];
        let indexValue: number;
        if (/^\d+$/.test(indexStr)) {
          indexValue = parseInt(indexStr, 10);
        } else if (context) {
          const resolvedIndex = context.variables.get(indexStr);
          if (resolvedIndex === undefined) return undefined;
          indexValue = typeof resolvedIndex === "number"
            ? resolvedIndex
            : parseInt(String(resolvedIndex), 10);
          if (isNaN(indexValue)) return undefined;
        } else {
          return undefined;
        }
        current = current[indexValue];
      } else {
        return undefined;
      }
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

export function jsonEscapeString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

// Replace {{variable}} or {{variable.path.to.value}} placeholders with actual values
export function replaceVariables(
  template: string,
  context: ExecutionContext
): string {
  let result = template;
  let previousResult = "";
  let iterations = 0;
  const maxIterations = 10;

  while (result !== previousResult && iterations < maxIterations) {
    previousResult = result;
    iterations++;

    result = result.replace(/\{\{([\w.[\]]+)(:json)?\}\}/g, (match, fullPath, jsonModifier) => {
      const shouldJsonEscape = jsonModifier === ":json";
      const dotIndex = fullPath.indexOf(".");
      const bracketIndex = fullPath.indexOf("[");
      const firstSpecialIndex = Math.min(
        dotIndex === -1 ? Infinity : dotIndex,
        bracketIndex === -1 ? Infinity : bracketIndex
      );

      if (firstSpecialIndex === Infinity) {
        const value = context.variables.get(fullPath);
        if (value !== undefined) {
          const strValue = typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value);
          return shouldJsonEscape ? jsonEscapeString(strValue) : strValue;
        }
        return match;
      }

      // Try full path as a literal variable name first (e.g., "auth.email" stored with dot in key)
      const fullPathValue = context.variables.get(fullPath);
      if (fullPathValue !== undefined) {
        const strValue = typeof fullPathValue === "object" && fullPathValue !== null
          ? JSON.stringify(fullPathValue)
          : String(fullPathValue);
        return shouldJsonEscape ? jsonEscapeString(strValue) : strValue;
      }

      const varName = fullPath.substring(0, firstSpecialIndex);
      const restPath = fullPath.substring(
        firstSpecialIndex + (fullPath[firstSpecialIndex] === "." ? 1 : 0)
      );

      const varValue = context.variables.get(varName);
      if (varValue === undefined) return match;

      let parsedValue: unknown;
      if (typeof varValue === "string") {
        try {
          // Try direct JSON parse first; fall back to code-block extraction
          // (LLM output often wraps JSON in ```, but valid JSON values may
          //  contain triple-backticks in string fields which would confuse
          //  the code-block regex if applied unconditionally.)
          try {
            parsedValue = JSON.parse(varValue);
          } catch {
            let jsonString = varValue;
            const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) jsonString = codeBlockMatch[1].trim();
            parsedValue = JSON.parse(jsonString);
          }
        } catch {
          return match;
        }
      } else {
        parsedValue = varValue;
      }

      const pathToNavigate =
        fullPath[firstSpecialIndex] === "["
          ? fullPath.substring(varName.length)
          : restPath;

      if (fullPath[firstSpecialIndex] === "[") {
        const arrayMatch = pathToNavigate.match(/^\[(\w+)\](.*)$/);
        if (arrayMatch && Array.isArray(parsedValue)) {
          let indexValue: number;
          const indexStr = arrayMatch[1];
          if (/^\d+$/.test(indexStr)) {
            indexValue = parseInt(indexStr, 10);
          } else {
            const resolvedIndex = context.variables.get(indexStr);
            if (resolvedIndex === undefined) return match;
            indexValue = typeof resolvedIndex === "number"
              ? resolvedIndex
              : parseInt(String(resolvedIndex), 10);
            if (isNaN(indexValue)) return match;
          }

          let result: unknown = parsedValue[indexValue];
          if (arrayMatch[2]) {
            const remainingPath = arrayMatch[2].startsWith(".")
              ? arrayMatch[2].substring(1)
              : arrayMatch[2];
            if (remainingPath) result = getNestedValue(result, remainingPath, context);
          }
          if (result !== undefined) {
            const strResult = typeof result === "object"
              ? JSON.stringify(result)
              : String(result);
            return shouldJsonEscape ? jsonEscapeString(strResult) : strResult;
          }
        }
        return match;
      }

      const nestedValue = getNestedValue(parsedValue, restPath, context);
      if (nestedValue !== undefined) {
        const strResult = typeof nestedValue === "object"
          ? JSON.stringify(nestedValue)
          : String(nestedValue);
        return shouldJsonEscape ? jsonEscapeString(strResult) : strResult;
      }

      return match;
    });
  }

  return result;
}

export function parseCondition(condition: string): ParsedCondition | null {
  const operators: ComparisonOperator[] = ["==", "!=", "<=", ">=", "<", ">", "contains"];
  for (const op of operators) {
    const parts = condition.split(op);
    if (parts.length === 2) {
      return { left: parts[0].trim(), operator: op, right: parts[1].trim() };
    }
  }
  return null;
}

export function evaluateCondition(
  condition: ParsedCondition,
  context: ExecutionContext
): boolean {
  let left = replaceVariables(condition.left, context);
  let right = replaceVariables(condition.right, context);

  left = left.replace(/^["'](.*)["']$/, "$1");
  right = right.replace(/^["'](.*)["']$/, "$1");

  const leftNum = parseFloat(left);
  const rightNum = parseFloat(right);
  const bothNumbers = !isNaN(leftNum) && !isNaN(rightNum);

  switch (condition.operator) {
    case "==": return bothNumbers ? leftNum === rightNum : left === right;
    case "!=": return bothNumbers ? leftNum !== rightNum : left !== right;
    case "<":  return bothNumbers ? leftNum < rightNum : left < right;
    case ">":  return bothNumbers ? leftNum > rightNum : left > right;
    case "<=": return bothNumbers ? leftNum <= rightNum : left <= right;
    case ">=": return bothNumbers ? leftNum >= rightNum : left >= right;
    case "contains":
      try {
        const leftParsed = JSON.parse(left);
        if (Array.isArray(leftParsed)) return leftParsed.includes(right);
      } catch { /* fall through */ }
      return left.includes(right);
    default: return false;
  }
}
