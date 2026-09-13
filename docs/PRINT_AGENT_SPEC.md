# SwiftTill Local Print Agent Spec

Cloud web apps cannot reliably silent-print directly to a Windows thermal printer. SwiftTill keeps the POS online, but uses a small local print agent on the restaurant PC.

## Flow

```text
Cloud POS
  ↓ receipt payload
Local print agent http://127.0.0.1:9721/print
  ↓ ESC/POS or Windows print command
Thermal printer
```

## Client PC setup

- Install thermal printer driver.
- Set printer as Windows default or configure printer name.
- Run SwiftTill print agent at startup.
- POS remains cloud-hosted.

## Payment rule

Payment success must never depend on printing success.

If printing fails:

```text
Payment stays PAID
Show Retry Print
Allow Continue Without Print
```
