export function readRequiredString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

export function readOptionalString(...values: Array<unknown>): string | undefined {
  const value = readRequiredString(...values);
  return value || undefined;
}

export function readBoolean(...values: Array<unknown>): boolean {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }

  return false;
}

export function readConfigObject<T extends object>(
  ...values: Array<unknown>
): T | undefined {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as T;
    }
  }

  return undefined;
}
