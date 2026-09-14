# Phase 50 - Print Page Center and Paper Waste Fix

This phase fixes browser print/PDF blank pages and alignment issues reported from a Z report PDF that printed three pages although only the first page contained content.

## Fixes

- Print DOM isolation: hide the whole POS application with `display:none` during print instead of only using invisible layout space.
- `#printArea` is the only printable node.
- A4/PDF content is horizontally centered.
- Thermal report/receipt content is horizontally centered.
- Page waste reduced by compact print margins, no forced min-height, and no page-break after the print block.
- Thermal report rendering now avoids printing payment/detail sections when there is no relevant data.
- Browser print cleanup restores the app after print.

## Expected status flags

- `printPageCenterV50 = true`
- `noBlankReportPagesV50 = true`
- `dynamicReceiptHeightV50 = true`
- `a4ThermalCenterAlignedV50 = true`
- `browserPrintDomIsolationV50 = true`
