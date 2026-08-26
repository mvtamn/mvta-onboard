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
