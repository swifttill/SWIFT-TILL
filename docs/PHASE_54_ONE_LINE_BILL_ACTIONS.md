# Phase 54 — One-Line Bill Actions

## Purpose
Client-facing bill actions must look professional and must not wrap unexpectedly.

## Fixes
- Print, Move, Split, and Void are forced into one horizontal row.
- Older mobile rules that changed the action bar to two columns are overridden.
- Void button is compact, accessible, and still opens the Void / Cancel approval flow.
- Online-only mode is preserved.

## Verification
- API syntax check.
- Web JavaScript parse check.
- ZIP integrity check.
