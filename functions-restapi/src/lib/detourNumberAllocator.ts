import { sql } from "./db";
import { formatDetourNumber } from "./detourNumbering";

interface AllocatedSequence {
  assigned: number;
}

export async function allocateDetourNumber(tx: sql.Transaction, year: number): Promise<string> {
  const req = new sql.Request(tx);
  req.input("year", sql.Int, year);
  const result = await req.query<AllocatedSequence>(`
    MERGE DetourNumberSequences WITH (HOLDLOCK) AS target
    USING (SELECT @year AS year) AS source
      ON target.year = source.year
    WHEN MATCHED THEN
      UPDATE SET next_value = target.next_value + 1
    WHEN NOT MATCHED THEN
      INSERT (year, next_value) VALUES (source.year, 2)
    OUTPUT COALESCE(DELETED.next_value, 1) AS assigned;
  `);
  const assigned = result.recordset[0]?.assigned;
  if (assigned === undefined) throw new Error(`Failed to allocate an internal detour number for ${year}`);
  return formatDetourNumber(year, assigned);
}
