-- Event is the durable operating anchor. Service Plans are the inclusive
-- operating periods owned by an Event; existing plans are preserved as
-- generated Events during the migration.
IF OBJECT_ID('dbo.Events', 'U') IS NULL
BEGIN
  CREATE TABLE Events (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    name NVARCHAR(150) NOT NULL,
    description NVARCHAR(1000) NULL,
    owning_team NVARCHAR(150) NULL,
    created_by NVARCHAR(200) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(200) NULL,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF COL_LENGTH('dbo.EventServicePlans', 'event_id') IS NULL
  ALTER TABLE EventServicePlans ADD event_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_EventServicePlans_Event')
  ALTER TABLE EventServicePlans ADD CONSTRAINT FK_EventServicePlans_Event FOREIGN KEY (event_id) REFERENCES Events(id);
GO

-- Migration compatibility: no service plan is dropped or renamed. Each
-- legacy plan receives its own generated Event and keeps its original values.
DECLARE @plan_id UNIQUEIDENTIFIER, @name NVARCHAR(150), @by NVARCHAR(200);
DECLARE plans CURSOR LOCAL FAST_FORWARD FOR
  SELECT id, name, created_by FROM EventServicePlans WHERE event_id IS NULL;
OPEN plans;
FETCH NEXT FROM plans INTO @plan_id, @name, @by;
WHILE @@FETCH_STATUS = 0
BEGIN
  DECLARE @event_id UNIQUEIDENTIFIER = NEWID();
  INSERT INTO Events(id, name, description, owning_team, created_by, updated_by)
  VALUES (@event_id, CONCAT('Generated Event — ', @name), 'Created during Event operating-model migration.', NULL, COALESCE(@by, 'migration-040'), 'migration-040');
  UPDATE EventServicePlans SET event_id = @event_id WHERE id = @plan_id;
  FETCH NEXT FROM plans INTO @plan_id, @name, @by;
END;
CLOSE plans;
DEALLOCATE plans;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_EventServicePlans_ActiveEvent')
  CREATE UNIQUE INDEX UX_EventServicePlans_ActiveEvent
    ON EventServicePlans(event_id) WHERE status = 'active';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EventServicePlans_EventDates')
  CREATE INDEX IX_EventServicePlans_EventDates ON EventServicePlans(event_id, start_date, end_date, status);
GO

PRINT 'Migration 040 applied: Event operating contexts and active-plan ownership ready.';
