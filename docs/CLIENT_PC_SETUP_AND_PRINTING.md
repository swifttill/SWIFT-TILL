# Client PC Setup and Printing

## Best operating model

Use cloud/app-window POS for the UI, plus a one-time local print agent for thermal printer access.

```text
SwiftTill Cloud/App Window
        ↓
Local Print Agent on client PC
        ↓
Windows Default 80mm Thermal Printer
```

## Minimum client setup

```text
1. Install Node.js LTS for local test phase.
2. Install thermal printer driver.
3. Set thermal printer as Windows default printer.
4. Run START_SWIFTTILL_PRINT_AGENT.bat.
5. Run POS in app-window mode.
```

## Production later

After local approval, replace the local test setup with:

```text
GitHub repo
Render/Vercel app hosting
Neon PostgreSQL database
Cloudflare R2 for media/images/backups
Small Windows print agent or packaged desktop shell
```

The current V5 package is built for local testing first. Production keys and cloud URLs are intentionally not hard-coded.
