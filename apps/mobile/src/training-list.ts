export function filterTrainingConversations<T extends { id: string; title: string }>(items: readonly T[], query: string): T[] {
  const term = query.trim().toLocaleLowerCase();
  return items.filter((item) => !item.id.includes("policy-update") && item.title.toLocaleLowerCase().includes(term));
}
