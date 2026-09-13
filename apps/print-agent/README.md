# SwiftTill Windows Print Agent

This app is the one-time local bridge for cloud/local POS printing.

Browser-only POS can show a print dialog. A counter POS usually needs a local agent so the paid receipt can be sent to the Windows printer with fewer clicks.

## Run

From the project root:

```bat
START_SWIFTTILL_PRINT_AGENT.bat
```

Default mode is `spool-only`; it saves receipts in:

```text
storage/print-spool/
```

For direct Windows default-printer testing, edit `START_SWIFTTILL_PRINT_AGENT.bat`:

```bat
set SWIFTTILL_PRINTER_MODE=windows-print
```

Then set the thermal printer as the Windows default printer.

## Endpoint

```text
POST http://127.0.0.1:9721/print
GET  http://127.0.0.1:9721/health
```

The POS tries this local agent first. If it is not running, it falls back to browser print preview.
