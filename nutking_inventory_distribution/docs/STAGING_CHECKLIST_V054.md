# Nut King v0.5.4 focused staging checks

1. Upgrade the installed module.
2. Open **Nut King Administration → Stock Transfers**.
3. Open a Raw Materials issue created from Rapid Scan.
4. Confirm the header shows:
   - Customer / Company / Supplier
   - Operation Type
   - Source Location
   - Destination Location
   - Scheduled Date
   - Source Document
5. Confirm Raw Materials issue routing is **Available Raw Materials → Issued / Operational Use**.
6. Open a Finished Goods-to-Truck transfer and confirm:
   - Source is Available Finished Goods.
   - Destination is the selected truck location.
   - Truck and Trip Number are displayed.
7. Mark a transfer as Todo and confirm Odoo naturally shows Waiting or Ready based on reservation availability.
8. Confirm Check Availability, Validate, Cancel, Return, Moves, Barcode, and Print remain native Odoo actions.
