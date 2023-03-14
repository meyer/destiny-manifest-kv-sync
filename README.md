# destiny-manifest-kv-sync

The meat of this repository is a GitHub Actions workflow that syncs the latest Destiny 2 manifest to a specific Cloudflare Workers KV store.
The workflow runs on a schedule, once per minute from 8am to 8pm PST and once every five minutes all other hours.
