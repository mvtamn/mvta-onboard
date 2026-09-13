#!/bin/sh
# Assembles each artboard from the shared token/motion stylesheet, a per-file
# stylesheet (optional) and the body fragment. Edit the fragments, re-run this.
set -e
for name in "$@"; do
  extra=""
  [ -f "$name.css" ] && extra=$(cat "$name.css")
  {
    printf '<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n  <style>\n'
    cat _base.css
    printf '%s\n' "$extra"
    printf '  </style>\n</helmet>\n'
    cat "$name.body.html"
    printf '</x-dc>\n'
    cat _logic.html
    printf '</body>\n</html>\n'
  } > "$name.dc.html"
  echo "built $name.dc.html"
done
