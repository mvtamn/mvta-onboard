# Keep Decision Matrix content in OnBoard

**Status:** accepted

OnBoard owns Procedure content, Procedure Revisions, Criteria, Immediate
Actions, governance, matching, and audit. SharePoint stores the complete
supporting SOPs, References, QRGs, forms, maps, and approved visual renditions
that a revision links to. A Supporting Document Reference is validated for
identity, revision, and availability, but it never imports or overwrites
Decision Matrix content.

This separates governed, controller-facing structured guidance from document
storage. It rejects the previous SharePoint content-import model because two
authoritative stores would make a revision's Criteria and Immediate Actions
ambiguous. The current content-import endpoint and timer are therefore a
cutover concern, not the permanent integration design.

## Consequences

- Approved Procedure Revisions are immutable app records and retain their
  exact Supporting Document References.
- SharePoint checks update only Document Reference Health; a changed or
  unavailable document requires review and never silently changes procedure
  content.
- The app may display an approved PNG/JPEG Document Rendition and open the
  full SharePoint source document secondarily, but the text-based Matrix
  guidance remains the primary operational instruction.
