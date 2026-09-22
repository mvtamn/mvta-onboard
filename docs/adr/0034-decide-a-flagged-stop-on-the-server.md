# Decide a Flagged Stop on the Server

**Status:** accepted

Which stops the OTP Review Queue puts in front of a reviewer is decided by one
module, `functions-restapi/src/lib/otpFlaggedStops`. It takes the feed's stop
rows and a threshold, and returns the month's Flagged Stops. `GET /otp-monthly`
returns that list; the console renders it. No caller re-derives it.

The browser used to decide it. `deriveCandidatesFromLive` filtered every stop
row the API shipped — a whole month of `OtpMonthlyRouteStopDay` — against a
default of `0.15` that existed independently in the console, in the
`/otp-settings` handler, and as a column default in migration 018. The server
stored, validated and served `early_late_bias_threshold` without ever reading
it. This is the split ADR 0033 closed for the official figure, one step earlier
in the pipeline: the rule that decides what a reviewer sees lived in the one
place nothing else could call.

**This is not part of the OTP month measurement, deliberately.** `lib/otpMonth`
answers what the month scored — a contractual question, changed by amendment
and frozen into an Assessment Period's rule set. Flagging answers who gets
looked at — an operational heuristic behind a slider in Administration > OTP
Compliance. Folding them together would put an administrator's knob inside the
answer the assessment scores. The flagged list is therefore a sibling of
`measurement` in the response, never a field inside it, and
`OtpMonthMeasurement` still means exactly what ADR 0033 says it means. The new
module imports `rules.ts` for the route-category test and nothing else.

**The threshold is a parameter, not something the module reads.** That is what
keeps the rule a pure function over rows, testable with no database — the point
of moving it. `readEarlyLateBiasThreshold` reads the setting for the handler;
its fallback for a missing table or row is split out as a pure branch and
tested, because that is the part that has ever been wrong.

**Only fixed-route service is flagged.** Excluding a stop on a special-event,
on-demand or non-revenue route would move no figure, because the route is
already outside Official Departure OTP. A route with no classification row
counts as fixed route, so a new route is reviewable by default. Approved Stop
Exclusions are deliberately *not* filtered out: an excluded stop stays visible
so a past decision can be seen and reversed.

**The Threshold Tuner previews through `?threshold=` rather than locally.** It
could obviously compute a trial count in the browser — it has the rows and the
comparison is one line. Doing so would put the rule back in two places, where
they can disagree, which is the failure this decision exists to prevent. One
round-trip per slider release is the price.

**Consequences:** stops on special-event, on-demand and non-revenue routes
disappear from the Review Queue, where they were previously shown and could be
actioned to no effect. The tuner gains a month picker, having previously
previewed against the current month only. `stops` leaves the `/otp-monthly`
response once the console no longer derives anything from it, and
`direction` and `avg_var` go with it — the monthly feed never carried either,
and the console rendered `"—"` and `null` for them throughout. A reader wanting
to change what gets reviewed changes one function, and a test proves it.
