// The Subscribers summary is COUNT(*) plus four SUM(CASE ...) columns. SQL
// Server returns NULL for a SUM over zero rows, so on an empty table the API
// shipped { total: 0, sms_confirmed: null, ... } against a contract that
// promises numbers, and the console's card renderer threw on the first
// null.toLocaleString(). Every figure is coalesced to 0 here (and in the
// query) so the contract holds no matter what the table contains.
export interface SubscribersSummary {
  total: number;
  sms_confirmed: number;
  email_confirmed: number;
  pending: number;
  opted_out: number;
}

type CountRow = Partial<Record<keyof SubscribersSummary, number | string | null>>;

function count(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summaryFromCounts(row: CountRow | undefined): SubscribersSummary {
  return {
    total: count(row?.total),
    sms_confirmed: count(row?.sms_confirmed),
    email_confirmed: count(row?.email_confirmed),
    pending: count(row?.pending),
    opted_out: count(row?.opted_out),
  };
}
