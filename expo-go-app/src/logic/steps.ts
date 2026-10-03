/** On-phone fallback for "Make it tiny" when no brain is connected. */
export function tinySteps(task: string): string[] {
  const t = task.replace(/[.!]+$/, "");
  const lower = t.toLowerCase();
  if (/\b(email|message|text|reply|write|call)\b/.test(lower)) {
    return ["Open the app you need", "Write just the first line", "Add the one key detail", "Read it once, then send"];
  }
  if (/\b(clean|tidy|restock|organi[sz]e|put away|sort)\b/.test(lower)) {
    return ["Set a 5-minute timer", "Grab what you need", "Do the closest spot first", "Stop when the timer rings"];
  }
  return [`Get what you need for: ${t}`, "Set a 5-minute timer", "Do the smallest first part", "Decide: done, or one more round?"];
}
