# SwiftTill POS Scope Lock

SwiftTill POS is a clean food billing system for one small restaurant/food setup.

Fixed layout rule:
- Left sidebar is for logo, New Order, search, categories and deals only.
- Open Orders, Reports and Admin buttons sit in the compact navigation row above the bill/current-order section.
- No POS button is shown there because the user is already on POS.
- Admin panel is a separate screen opened from the POS navigation button.

Main operational rules:
- Dine In requires a table before order creation.
- One dine-in table can have only one active order.
- Busy tables show a live occupied timer.
- Moving a table keeps the original occupied time.
- Paid orders leave Open Orders and move to Admin > Paid Orders.
- Opening cash is not sales revenue.

Storage rule:
- Database records stay in DB.
- Images stay in media storage.
- Only image URL/key is saved in DB.
- Production media target is Cloudflare R2.

Production rule:
- Online-only cloud app.
- Local print agent for thermal printer access.
- No offline cache/service-worker operation.
