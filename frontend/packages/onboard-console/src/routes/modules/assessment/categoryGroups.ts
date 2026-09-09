// Grouping by the contract's categories (migration 110), in the order Lists
// gives them - what the service did, then who ran it, then whether it was
// safe, and so on. A category is how a catalog or a scorecard is READ, never
// an input to scoring, so this is presentation only: nothing here changes
// which item belongs to which group beyond what the standard says.

export interface CategoryOption { value: string; label: string; description?: string | null }

export interface CategoryGroup<T> {
  /** The category value; "" for items with no offered category. */
  key: string;
  label: string;
  description?: string | null;
  items: T[];
}

/**
 * Items in category order, each group's items in their given order. Items
 * whose category is unset, or names a value Lists no longer offers, land in a
 * trailing "Other standards" group under the empty key. With no categories
 * offered at all there is one unlabelled group, so a caller can render the
 * same way whether or not migration 110 has run.
 */
export function groupByCategory<T>(
  items: readonly T[],
  categoryOf: (item: T) => string | null | undefined,
  categories: readonly CategoryOption[],
): CategoryGroup<T>[] {
  if (!categories.length) return [{ key: "", label: "", items: [...items] }];
  const offered = new Set(categories.map((option) => option.value));
  const groups = categories.map<CategoryGroup<T>>((option) => ({ key: option.value, label: option.label, description: option.description, items: [] }));
  const other: CategoryGroup<T> = { key: "", label: "Other standards", items: [] };
  for (const item of items) {
    const category = categoryOf(item);
    const group = category && offered.has(category) ? groups.find((g) => g.key === category) : undefined;
    (group ?? other).items.push(item);
  }
  const populated = groups.filter((group) => group.items.length);
  return other.items.length ? [...populated, other] : populated;
}
