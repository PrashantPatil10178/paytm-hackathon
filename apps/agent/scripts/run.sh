#!/bin/sh
# Creates .venv on first run (and reinstalls when requirements.txt changes), then runs the given tool from it.
set -e
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
if [ ! -x .venv/bin/python ]; then
  echo "[agent] creating .venv with $($PY --version)"
  "$PY" -m venv .venv
fi
if [ ! -f .venv/.installed ] || [ requirements.txt -nt .venv/.installed ]; then
  echo "[agent] installing requirements"
  .venv/bin/python -m pip install -q --upgrade pip
  .venv/bin/python -m pip install -q -r requirements.txt
  touch .venv/.installed
fi
tool="$1"; shift
exec ".venv/bin/$tool" "$@"
