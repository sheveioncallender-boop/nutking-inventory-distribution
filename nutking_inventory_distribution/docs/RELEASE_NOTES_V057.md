# Nut King v0.5.7 — Community Administrator Access & Workspace Menu Fix

## Corrected

- Clears stale administrator Home Actions so `/web` opens Odoo's normal backend.
- Adds explicit Settings-administrator access to Nut King custom backend models.
- Changes `/nutking/backend` to open native Stock Transfers rather than an inaccessible dashboard action.
- Keeps Settings administrators outside worker security groups while granting full workspace test capabilities through the bootstrap snapshot.
- Restores Raw Materials, Finished Goods, Distribution, Physical Inventory, Contacts & Trucks, Reports, Stock Operations, and Synchronization menus when a Settings administrator manually opens `/nutking/`.
- Allows Settings administrators to test physical inventory conflict handling and distribution variance approval.
- Versions all offline workspace assets as v0.5.7 to eliminate stale v0.5.5 cache reuse.

## Architecture

The module remains Odoo 19 Community-first and depends only on `stock`, `contacts`, and `mail`. The developer administrator remains a backend user, not a worker-role user. The final worker `/web` lock-down is still disabled during staging.
