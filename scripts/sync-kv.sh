#!/usr/bin/env bash
trap "echo; echo 👋; exit;" SIGINT SIGTERM
for jsonFile in bulk-data/*.json; do
  echo "$jsonFile"
  npx wrangler kv:bulk put --namespace-id 8115761ab4e8442d9a0dbe15ff603838 "$jsonFile"
  echo
done
