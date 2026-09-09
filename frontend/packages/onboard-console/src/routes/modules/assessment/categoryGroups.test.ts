import { describe, expect, it } from "vitest";
import { groupByCategory } from "./categoryGroups.js";

const categories = [
  { value: "service_delivery", label: "Service Delivery", description: "Whether the scheduled service ran, and ran on time." },
  { value: "safety", label: "Safety", description: "Collisions, inspections, and the safety programme." },
  { value: "customer", label: "Customer Experience" },
];
const items = [
  { id: "a", category: "safety" },
  { id: "b", category: "service_delivery" },
  { id: "c", category: null },
  { id: "d", category: "service_delivery" },
  { id: "e", category: "retired_category" },
];

describe("groupByCategory", () => {
  it("reads in the order Lists gives the categories, keeping each group's items in their own order", () => {
    const groups = groupByCategory(items, (item) => item.category, categories);
    expect(groups.map((group) => [group.key, group.label, group.items.map((item) => item.id)])).toEqual([
      ["service_delivery", "Service Delivery", ["b", "d"]],
      ["safety", "Safety", ["a"]],
      ["", "Other standards", ["c", "e"]],
    ]);
    expect(groups[0].description).toBe("Whether the scheduled service ran, and ran on time.");
  });
  it("skips categories with nothing in them and omits the trailing group when everything is categorised", () => {
    const groups = groupByCategory(items.slice(0, 2), (item) => item.category, categories);
    expect(groups.map((group) => group.key)).toEqual(["service_delivery", "safety"]);
  });
  it("puts a category Lists no longer offers with the uncategorised, under its stored value", () => {
    const [other] = groupByCategory([{ id: "e", category: "retired_category" }], (item) => item.category, categories);
    expect(other.key).toBe("");
    expect(other.items.map((item) => item.id)).toEqual(["e"]);
  });
  it("is one unlabelled group when Lists offers no categories at all", () => {
    const groups = groupByCategory(items, (item) => item.category, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("");
    expect(groups[0].items).toHaveLength(5);
  });
});
