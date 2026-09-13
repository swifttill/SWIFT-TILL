# Phase 24 — 360 Operational Audit Fixes

Scope excludes visual redesign. This phase audits and hardens core operation only.

## Fixed

- Report renderer bug from missing function alias fixed.
- Report print helper restored.
- Report totals footer numeric bug fixed.
- Void report total now calculated instead of blank.
- User passwords are stored as scrypt hashes in the cloud state.
- Existing plaintext bootstrap passwords are migrated to hashes on load.
- Session tokens changed from in-memory random tokens to signed expiring tokens.
- Manager PIN and user PINs are no longer exposed to the browser state.
- Admin user list now shows password/PIN set flags, not secret values.
- Settings save will not clear manager PIN when field is blank.
- New users require a non-default password.
- Last active admin deletion is blocked.
- Deleting assigned roles is blocked.
- Payment methods used in historical paid orders are archived instead of destroying history.
- Category delete is blocked while active items still belong to it.
- New order starts as a draft; table is not occupied until item/deal exists and order is saved/held/paid.
- Bill number is assigned only when the order becomes real, not on empty draft creation.
- Empty draft cleanup added.
- Automatic daily/monthly backups now persist in Neon state.
- Expired backup index entries trigger R2 object cleanup to reduce free-plan storage use.
- Cloud print queue endpoints added for Render-to-client-agent printing.
- Client print agent can poll Render cloud queue and print to Windows default printer.
- `/api/audit/status` added for non-UI production readiness checks.

## Production notes

For cloud queue printing, set this Render env var and put the same value into the client print agent on the restaurant PC:

```text
SWIFTTILL_PRINT_AGENT_KEY=<private-print-agent-key>
```

This is not a database/R2 secret. It only authorizes the counter PC print agent to fetch pending print jobs.
