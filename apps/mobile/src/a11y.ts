export function radioAccessibility(checked: boolean, disabled = false) {
  return {
    accessibilityRole: "radio" as const,
    accessibilityState: {
      checked,
      ...(disabled ? { disabled: true } : {}),
    },
    "aria-checked": checked,
  };
}
