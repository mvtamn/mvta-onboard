# Separate Detour Intake from Authoritative Detours

**Status:** accepted

Detour intake reports are separate preliminary records; only reviewed records
become authoritative Detours. Authoritative Detours use one workflow model with
three fulfillment modes—Avail-backed, fixed-route manual, and mobility manual—
while date-derived temporal status remains separate from workflow state. This
keeps unreviewed operational noise out of reporting, preserves closures that
Avail cannot represent, and avoids making Avail build confirmation a false
requirement for manual service communication.

Conflict checks warn reviewers and require a reasoned override rather than
silently allowing overlap or hard-blocking legitimate exceptions. Avail feed
absence preserves the record for review instead of deleting or automatically
expiring it. Detour images and PDFs use private storage and are retained for
one year after temporal expiry before their files and metadata are purged; the
Detour audit remains.
