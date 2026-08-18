export interface InputRow {
  id: string;
  quantity: number;
  excluded: boolean;
}

export function splitAssessmentInput(rows: readonly InputRow[]) {
  const excluded = rows.filter(row => row.excluded);
  const assessable = rows.filter(row => !row.excluded);
  const sum = (items: readonly InputRow[]) => items.reduce((total, row) => total + row.quantity, 0);
  return {
    rawCount: rows.length,
    rawQuantity: sum(rows),
    excludedCount: excluded.length,
    excludedQuantity: sum(excluded),
    assessableCount: assessable.length,
    assessableQuantity: sum(assessable),
    assessableIds: assessable.map(row => row.id).sort(),
    excludedIds: excluded.map(row => row.id).sort(),
  };
}
