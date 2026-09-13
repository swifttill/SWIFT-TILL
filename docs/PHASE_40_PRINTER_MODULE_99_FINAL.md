# Phase 40 — Printer Module 99% Final Hardening

This phase hardens printing without requiring printer hardware during development.

## Added
- Robust Windows print agent
- Cloud queue polling from Render
- Local spool folder for every receipt/report
- Failed print copy retention
- Auto retry of failed cloud jobs
- Windows default printer diagnostics
- `/health`, `/printers`, `/test`, `/retry-spool` endpoints in print agent
- `/api/print-jobs/status` admin endpoint
- Final client print-agent ZIP for restaurant counter PC

## Production rule
Browser POS sends print jobs to Render cloud queue. The client counter PC runs the print agent. The agent polls Render, prints to Windows default thermal printer, and marks jobs printed.

## Without hardware
The module can be syntax-validated, cloud-queue tested, and spool-tested. Actual physical paper output still requires the real thermal printer.
