import type { ConnectionPool } from "mssql";
import { sql } from "./db";
import { retryDelaySeconds } from "./eventNotificationPolicy";

export const EVENT_NOTIFICATION_DELIVERY_LEASE_MINUTES = 5;

type DeliveryKind = "automatic" | "manual";
type DeliveryStatus = "pending" | "failed" | "sent";

interface ClaimedEventNotification {
  id: string;
  message_body: string;
  attempt_count: number;
  delivery_claim_token: string;
}

export function eventNotificationClaimSql(kind: DeliveryKind): string {
  const actionable = kind === "automatic" ? "'pending'" : "'pending','acknowledged'";
  return `
    UPDATE EventGeofenceNotifications
    SET status='sending', delivery_claim_token=NEWID(), delivery_claimed_at=SYSUTCDATETIME()
    OUTPUT INSERTED.id,INSERTED.message_body,INSERTED.attempt_count,INSERTED.delivery_claim_token
    WHERE id=@id AND created_at > DATEADD(HOUR,-24,SYSUTCDATETIME())
      AND (status IN (${actionable}) OR (status='sending' AND delivery_claimed_at < DATEADD(MINUTE,-${EVENT_NOTIFICATION_DELIVERY_LEASE_MINUTES},SYSUTCDATETIME())));
  `;
}

export async function claimEventNotification(pool: ConnectionPool, id: string, kind: DeliveryKind): Promise<ClaimedEventNotification | undefined> {
  return (await pool.request().input("id", sql.UniqueIdentifier, id).query<ClaimedEventNotification>(eventNotificationClaimSql(kind))).recordset[0];
}

export async function finishEventNotificationDelivery(pool: ConnectionPool, claim: ClaimedEventNotification, status: DeliveryStatus, error: string | null, sentBy: string | null): Promise<void> {
  await pool.request()
    .input("id", sql.UniqueIdentifier, claim.id)
    .input("claim", sql.UniqueIdentifier, claim.delivery_claim_token)
    .input("status", sql.NVarChar, status)
    .input("error", sql.NVarChar, error)
    .input("delay", sql.Int, retryDelaySeconds(claim.attempt_count + 1))
    .input("by", sql.NVarChar, sentBy)
    .query(`
      UPDATE EventGeofenceNotifications
      SET status=@status,
          sent_by=CASE WHEN @status='sent' THEN @by ELSE NULL END,
          sent_at=CASE WHEN @status='sent' THEN SYSUTCDATETIME() ELSE NULL END,
          attempt_count=attempt_count+1,
          last_error=@error,
          next_attempt_at=CASE WHEN @status='pending' THEN DATEADD(SECOND,@delay,SYSUTCDATETIME()) ELSE NULL END,
          delivery_claim_token=NULL,
          delivery_claimed_at=NULL
      WHERE id=@id AND status='sending' AND delivery_claim_token=@claim;
    `);
}
