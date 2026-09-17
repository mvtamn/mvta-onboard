# Decision Matrix background document health

**Status:** accepted

Daily Decision Matrix document-health checks use a dedicated, least-privilege
Microsoft Graph application identity. Its access is limited to the approved
SharePoint site/library and the metadata required to compare a Supporting
Document Reference's item identity, version, file name, MIME type, and
availability.

This identity is an integrity monitor. It must not download document content,
issue browser-facing download URLs, or provide an alternate user-access path.
Interactive source-document opening and approved image preview continue to use
delegated/on-behalf-of access, so users retain their own SharePoint
entitlement.

If the background identity is absent, the scheduler safely skips the run
rather than writing synthetic document health. If SharePoint denies an
authorized background check, the resulting Document Reference Health and
audit event record that observed failure; neither case changes Procedure
content or lifecycle state.

## Amendment — 2026-09-17

Every Document Reference Health check uses this identity, whether it runs on
the daily schedule, when an Admin presses Check documents, or when a Procedure
Revision is submitted for review or approved. A check no longer runs as the
Admin who caused it: that Admin is still the actor on the Procedure Audit
Event, and the event also records that the application made the observation.
Document Reference Health therefore means the expected document is present and
unchanged, not that any particular person can open it. Approval refreshes
health and gates on the fresh result, with no fallback to an earlier
observation.

The identity is the dedicated registration only, with no fallback to the
sign-in application: two identities writing one health record is what made
approval depend on who clicked. When it is not configured, a check records
nothing and a submission or approval that needs one is refused; when SharePoint
refuses an authorised check, that refusal is recorded as the observation.

Two things are unchanged. Opening a source document and previewing a Document
Rendition stay delegated so users keep their own SharePoint entitlement, and the
delegated access that needs is read-only file access, not full control. Whether
this identity may also list the approved library while a Draft is authored is
not decided here; library browsing keeps using the sign-in application until
that is settled on its own.
