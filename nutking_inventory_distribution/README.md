# Nut King Inventory & Distribution

**Odoo release:** 19.0  
**Module version:** `19.0.4.0.0`  
**Status:** staging release

A single branded Nut King application for independently managing Raw Materials, Finished Goods, trucks, distribution trips, customers, physical inventory, reporting, printing, and offline operations.

## Core business rules

- Raw Materials and Finished Goods are separate inventories.
- No Bills of Materials, manufacturing orders, or raw-to-finished conversion.
- Every completed quantity change is posted through Odoo stock records.
- Trucks operate as controlled internal stock locations.
- Rapid Scan supports the full Draft → Confirmed → Completed lifecycle inside Nut King Operations.
- Physical Inventory uses Odoo `stock.quant` inventory quantities and applies native inventory adjustments.

## Worker operation lifecycle

Workers open `/nutking/` and can manage stock operations without entering the Odoo administration interface:

1. Scan or search products.
2. Review quantities and operational details.
3. Save as Draft, Confirm, or Complete.
4. Reopen Draft, Confirmed, Completed, or Cancelled records from Stock Operations.
5. Cancel eligible operations or return a cancelled operation to Draft.
6. Print an official synchronized PDF or a clearly marked device/provisional copy.

A Completed operation changes official inventory only after the server accepts and processes it. When the device is offline, completion is stored locally and synchronized later.

## Offline-first worker workspace

The workspace is a standalone Progressive Web App and does not load the standard Odoo web-client shell. After the first successful synchronization it caches the application interface and the user’s authorized operational snapshot in IndexedDB.

Available while disconnected:

- dashboard and last synchronized stock snapshot;
- Raw Materials and Finished Goods stock lists;
- rapid receive and rapid issue;
- Draft, Confirmed, Completed, and Cancelled operation controls;
- provisional/device printing;
- truck loading, customer delivery, truck return, and distribution-trip actions;
- physical counts for both warehouses;
- recent stock operations, contacts, trucks, and cached reports;
- review of local actions, errors, and the synchronization queue.

New actions receive unique device identifiers and remain stored locally until the server accepts them. Projected device quantities include completed unsynchronized actions entered on that device. Odoo remains the authoritative server balance.

## Administrator access

During staging, Settings administrators also see **Nut King Administration**, which retains backend access for troubleshooting, configuration, native Physical Inventory, stock records, and synchronization logs. Strict worker redirection and backend lock-down remain intentionally deferred until operational testing is complete.

## Installation / upgrade

1. Place the complete `nutking_inventory_distribution` folder in the Cloudpepper-connected Git repository.
2. Commit, push, redeploy, and restart Odoo.
3. Update the Apps List.
4. Upgrade **Nut King Inventory & Distribution**.
5. Open `/nutking/reset` once while online to refresh the workspace assets.
6. Sign in, open **Nut King Operations**, and press **Synchronize**.
7. Test the full lifecycle and printing before production use.

## Dependencies

```python
['stock', 'contacts', 'mail']
```
