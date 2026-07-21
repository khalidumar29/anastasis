#!/bin/sh
# Codex CLI needs its own headless auth per container (API-key based, not
# the interactive ChatGPT OAuth flow) — re-authenticate on every start using
# this deployment's own OPENAI_API_KEY, never a copied personal credential.
set -e
if [ -n "$OPENAI_API_KEY" ]; then
  printf '%s' "$OPENAI_API_KEY" | codex login --with-api-key
fi
# Pin the Codex model explicitly — with no config.toml, the CLI silently
# uses whatever its bundled default is, which is not a choice we want made
# implicitly. Seeded only if missing so a live edit on the persistent
# CODEX_HOME volume isn't clobbered on restart.
if [ ! -f "$CODEX_HOME/config.toml" ]; then
  printf 'model = "%s"\nmodel_reasoning_effort = "high"\n' \
    "${ANASTASIS_CODEX_MODEL:-gpt-5.6-sol}" > "$CODEX_HOME/config.toml"
fi
exec "$@"
