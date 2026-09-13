# Phase 26 — Formatting, Reports and Print Templates Audit

## Purpose
Fix report formatting complaints from real PDF/print QA.

## Changes
- Replaced box/card report print output with clean A4 report tables.
- Added separate PDF/A4 print action.
- Added separate Thermal Print action for 80mm receipt printers.
- Thermal report output uses compact receipt slip sections, dashed separators and no card boxes.
- Screen report remains rich and readable for admin work.
- Report exports remain type-specific CSV/Excel-compatible files.
- Order/status endpoint flags updated to V26.

## Print Model
- PDF / A4: browser print dialog can save as PDF or print on A4.
- Thermal Print: cloud print queue or local agent receives compact thermal report HTML/text.
- If cloud print queue fails, browser print fallback opens.
