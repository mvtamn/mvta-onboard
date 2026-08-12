export function canonicalLocationKey(name: string, category: string): string {
  return `${name.trim().replace(/\s+/g, " ").toLocaleLowerCase()}::${category.trim().toLocaleLowerCase()}`;
}
