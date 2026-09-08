#!/usr/bin/env bash
# Fail when this branch adds a migration number that main has since taken.
#
# git never flags this: the two files have different names, so the merge is
# clean and the collision only becomes visible to whoever next reads sql/ and
# has to work out which of the two 105s ran first. The in-tree case - two files
# at one number in a single checkout - is covered by migrationNumbers.test.ts.
#
# Runnable outside CI:  functions-restapi/scripts/check-migration-numbers.sh
# Only BRE that BSD sed understands, so it behaves the same on macOS.
set -euo pipefail

base_ref="${1:-origin/main}"
sql_dir="functions-restapi/sql"

if ! git rev-parse --verify --quiet "$base_ref" >/dev/null; then
  echo "check-migration-numbers: cannot resolve $base_ref - fetch it first." >&2
  exit 2
fi

merge_base="$(git merge-base "$base_ref" HEAD)"

key_of() { sed 's|.*/migration-\([0-9][0-9]*[a-z]\{0,1\}\)-.*\.sql$|\1|'; }

added="$(git diff --name-only --diff-filter=A "$merge_base" HEAD -- "$sql_dir" \
  | grep '/migration-[0-9][0-9]*[a-z]\{0,1\}-' || true)"

if [ -z "$added" ]; then
  echo "check-migration-numbers: this branch adds no migrations."
  exit 0
fi

status=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  key="$(printf '%s\n' "$file" | key_of)"
  # Files on the base branch at the same number, excluding this same path -
  # a migration this branch only edits is not a collision.
  taken="$(git ls-tree -r --name-only "$base_ref" -- "$sql_dir" \
    | grep "/migration-${key}-" || true)"
  taken="$(printf '%s\n' "$taken" | grep -v "^${file}$" || true)"
  if [ -n "$taken" ]; then
    echo "Migration number ${key} is already taken on ${base_ref}:" >&2
    printf '%s\n' "$taken" | sed 's|^|  - |' >&2
    echo "  this branch adds: ${file}" >&2
    echo "  Give one a letter suffix (see ${sql_dir}/README.md). Do not renumber" >&2
    echo "  a migration that has already been applied to an environment." >&2
    status=1
  else
    echo "check-migration-numbers: ${key} is free on ${base_ref} (${file})"
  fi
done <<EOF
$added
EOF

exit $status
