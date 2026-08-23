# Isolate Monitoring Area tests from Event scope

**Status:** accepted

Monitoring Area tests use reusable locations and Monitoring Areas but do not
join an Event or Service Plan. They are temporary, explicitly enabled watches
that send `[TEST]` messages through the configured Teams channel, so proving
live AVL and Teams delivery for a depot, corridor, or another place cannot
accidentally change Event operations or their audit history.
