#!/bin/zsh
# Fetch one day of Avail360 APC ridership. The key is typed, never echoed or saved.
OUT="/private/tmp/claude-501/-Users-tyrefant-AI-Projects-MVTA-Onboard--claude-worktrees-ridership-folder-review-b25333/0b69ed98-cafd-43fc-816b-64ebab0b62ce/scratchpad/apc_sample/2026-10-28.json"
read -rs "KEY?Paste the Avail subscription key and press Enter: "
echo
curl -sS -o "$OUT" -w "HTTP %{http_code}, %{size_download} bytes\n" --max-time 180 \
  -H "Ocp-Apim-Subscription-Key: $KEY" \
  "https://avail360-api.myavail.cloud/ApcRidershipBySvcLvlBlockRouteTripTimepoint/v1/MVTA?ReportStartDate=2026-10-28&ReportEndDate=2026-10-28"
unset KEY
echo "Done. You can close this tab."
