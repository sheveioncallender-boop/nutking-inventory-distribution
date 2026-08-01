# Nut King v0.5.4 — Complete Native Transfer Header

This backend-focused release corrects the Odoo transfer form used by Nut King Administration.

## Fixed

- Adds a dedicated Nut King transfer-details block directly below the native Odoo title.
- Always displays **Operation Type**, **Source Location**, and **Destination Location** for Nut King transfers.
- Displays the existing Odoo Contact as **Customer / Company / Supplier**.
- Displays Scheduled Date, Availability, Effective Date, Source Document, Truck, Trip Number, and the applicable movement reason.
- Retains Odoo's native Draft, Waiting, Ready, Done states and native buttons.
- Gives the Nut King inherited view a high priority so common Enterprise/Studio extensions do not hide the routing fields.
- Backend links now include the Nut King Transfers action so records reopen in the correct administration context.

## Scope

No offline workspace JavaScript or cache asset changed in this release. The existing v0.5.3 workspace files remain valid.
