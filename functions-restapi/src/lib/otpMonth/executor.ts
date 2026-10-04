// What the measurement runs against: a pool, or a transaction when a caller
// already has one open. The assessment resolver passes its transaction so the
// figures it stores are the figures it measured.
//
// Its own file so target.ts and index.ts can both use it without either
// importing the other.
import { sql } from "../db";

export type Executor = sql.ConnectionPool | sql.Transaction;

export function requestFor(executor: Executor): sql.Request {
  return executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();
}
