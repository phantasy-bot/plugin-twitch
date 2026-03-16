# @phantasy/plugin-twitch

- Repo URL: https://github.com/phantasy-bot/plugin-twitch
- Extraction phase: `source-extracted`
- Source of truth: `standalone-repo`
- Sync mode: `source-extract`

## Meaning

This repo now receives a true source extraction payload from the main Phantasy monorepo. It should continue severing deep internal dependencies until the standalone repo becomes fully independent.

## Next Step

Continue replacing remaining monorepo-coupled imports with stable public package contracts, then publish from this repo directly.
