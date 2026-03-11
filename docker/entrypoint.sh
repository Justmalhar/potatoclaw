#!/bin/sh
# =============================================================================
# PotatoClaw container entrypoint
# =============================================================================
set -e

# ---------------------------------------------------------------------------
# 1. Ensure required /data sub-directories exist
# ---------------------------------------------------------------------------
for dir in agents channels memory sessions runs workspaces auth logs; do
  mkdir -p "/data/${dir}"
done

# ---------------------------------------------------------------------------
# 2. Seed default agent definitions (never overwrite user customisations)
# ---------------------------------------------------------------------------
DEFINITIONS_SRC="/app/src/agents/definitions"
DEFINITIONS_DST="/data/agents"

if [ -d "${DEFINITIONS_SRC}" ]; then
  for src_file in "${DEFINITIONS_SRC}"/*.json; do
    # Guard against empty glob
    [ -f "${src_file}" ] || continue
    dest_file="${DEFINITIONS_DST}/$(basename "${src_file}")"
    if [ ! -f "${dest_file}" ]; then
      cp "${src_file}" "${dest_file}"
      echo "[entrypoint] seeded agent definition: $(basename "${src_file}")"
    fi
  done
fi

# ---------------------------------------------------------------------------
# 3. Print startup banner
# ---------------------------------------------------------------------------
echo ""
echo "  ██████╗  ██████╗ ████████╗ █████╗ ████████╗ ██████╗  ██████╗██╗      █████╗ ██╗    ██╗"
echo "  ██╔══██╗██╔═══██╗╚══██╔══╝██╔══██╗╚══██╔══╝██╔═══██╗██╔════╝██║     ██╔══██╗██║    ██║"
echo "  ██████╔╝██║   ██║   ██║   ███████║   ██║   ██║   ██║██║     ██║     ███████║██║ █╗ ██║"
echo "  ██╔═══╝ ██║   ██║   ██║   ██╔══██║   ██║   ██║   ██║██║     ██║     ██╔══██║██║███╗██║"
echo "  ██║     ╚██████╔╝   ██║   ██║  ██║   ██║   ╚██████╔╝╚██████╗███████╗██║  ██║╚███╔███╔╝"
echo "  ╚═╝      ╚═════╝    ╚═╝   ╚═╝  ╚═╝   ╚═╝    ╚═════╝  ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ "
echo ""
echo "  v2.0 — Autonomous Multi-Agent Company"
echo "  Gateway  : http://0.0.0.0:4096"
echo "  UI       : http://0.0.0.0:4200"
echo "  Data dir : ${DATA_DIR:-/data}"
echo ""

# ---------------------------------------------------------------------------
# 4. Hand off to the Node.js process
# ---------------------------------------------------------------------------
exec node bin/potatoclaw start
