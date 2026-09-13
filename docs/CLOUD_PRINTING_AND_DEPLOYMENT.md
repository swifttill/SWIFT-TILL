# SwiftTill Cloud, App Window and Printing Plan

Final production direction:

- Code: GitHub
- Frontend/Admin: Vercel or Render
- API: Render
- Database: Neon PostgreSQL
- Media: Cloudflare R2
- Counter access: Chrome/Edge app-window launcher or installed PWA shell
- Silent thermal print: Windows Print Agent installed once on the client PC

## Why not browser-only printing

A normal browser cannot be trusted for silent USB thermal printing. It usually opens print dialogs and depends on user-side settings.

## Production setup

1. Deploy SwiftTill cloud app.
2. Edit `START_SWIFTTILL_CLOUD_WINDOW.bat` with the final URL.
3. Install thermal printer driver and set it as Windows default printer.
4. Run SwiftTill Print Agent on the client PC.
5. POS sends receipt jobs to the local agent.

## Offline policy

Offline usage is disabled in this build. Old service worker caches are cleared automatically when the app opens.
