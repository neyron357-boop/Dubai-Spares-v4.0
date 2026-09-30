#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
npm ci
npm run check
printf '%s\n' 'Setup complete. Start with npm run dev.'
