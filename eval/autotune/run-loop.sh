#!/bin/bash
# Autotune loop: launches a fresh Claude session per iteration.
# Each iteration gets a clean context window.
# Kill with Ctrl+C.
#
# Usage: GEMINI_API_KEY=xxx OPENAI_API_KEY=xxx ./run-loop.sh

set -e
cd "$(dirname "$0")/../.."  # repo root

ITERATION=0

while true; do
  ITERATION=$((ITERATION + 1))
  echo ""
  echo "════════════════════════════════════════════"
  echo "  AUTOTUNE ITERATION $ITERATION — $(date)"
  echo "════════════════════════════════════════════"
  echo ""

  # Launch a fresh Claude session for ONE iteration
  # It reads program.md, makes one change, evaluates, keeps/discards, then exits
  claude --dangerously-skip-permissions -p "$(cat eval/autotune/program-single.md)" 2>&1 | tee "eval/autotune/iteration-${ITERATION}.log"

  echo ""
  echo "Iteration $ITERATION complete. Results:"
  tail -3 eval/autotune/results.tsv
  echo ""

  # Brief pause between iterations
  sleep 5
done
