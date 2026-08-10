IF OBJECT_ID('dbo.CK_EventServicePlans_Status', 'C') IS NOT NULL
  ALTER TABLE EventServicePlans DROP CONSTRAINT CK_EventServicePlans_Status;
GO
ALTER TABLE EventServicePlans ADD CONSTRAINT CK_EventServicePlans_Status CHECK (status IN ('draft','review','approved','active','completed','suspended'));
GO
PRINT 'Migration 035 applied: event service plan lifecycle expanded.';
