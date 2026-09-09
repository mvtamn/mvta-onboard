import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_ACTIONS, auditSql, periodAuditSelectSql } from "./audit";

test("an audit row has one shape whichever handler writes it", () => {
  const sql = auditSql("period", "@id", "finalized", "actor", { after: "CONCAT('{\"final_total\":',@total,'}')" });
  assert.equal(sql, `INSERT ComplianceAssessmentAudit(entity_type,entity_id,action,actor,before_json,after_json,note) VALUES('period',@id,'finalized',@actor,NULL,CONCAT('{"final_total":',@total,'}'),NULL);`);
});

test("the action vocabulary matches the workflow seam's audit names", () => {
  for (const action of ["computed", "reviewed", "validation_shared", "finalized", "issuance_proof_prepared", "issuance_proof_voided", "issued", "reopened"]) assert.ok(AUDIT_ACTIONS.includes(action as never), action);
});

test("a period's trail covers the period, its items, its reports, and disputes on them", () => {
  const sql = periodAuditSelectSql("period");
  assert.match(sql, /entity_type='period' AND a\.entity_id=@period/);
  assert.match(sql, /entity_type='assessment' AND a\.entity_id IN \(SELECT id FROM PeriodKpiAssessments WHERE period_id=@period\)/);
  assert.match(sql, /entity_type='report' AND a\.entity_id IN \(SELECT id FROM ComplianceReports WHERE period_id=@period\)/);
  assert.match(sql, /entity_type='dispute'/);
  assert.match(sql, /entity_type='cap' AND a\.entity_id IN \(SELECT id FROM CorrectiveActionPlans WHERE period_id=@period\)/);
  assert.match(sql, /ORDER BY a\.created_at DESC/);
});
