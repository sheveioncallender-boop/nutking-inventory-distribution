{
    'name': 'Nut King Inventory & Distribution',
    'version': '19.0.5.0.3',
    'summary': 'Branded raw materials, finished goods, trucks, distribution and offline operations',
    'description': """
Nut King Inventory & Distribution
=================================
A single branded operations application for Sesame Foods Limited / The Nut Kings.
Raw materials and finished goods are managed independently. The application includes
Odoo-native stock transfers with Draft, Waiting, Ready and Done states, manual reservation, detailed operations, forecast and move-history snapshots, official and provisional printing, rapid barcode scanning, native physical inventory, trucks as mobile stock locations,
distribution trips, customers, staff, movement reasons, reports, dashboards, and an offline-first operations workspace.
    """,
    'category': 'Inventory/Inventory',
    'author': 'Spxcorp Limited',
    'website': 'https://spxcorp.site',
    'license': 'LGPL-3',
    'depends': ['stock', 'contacts', 'mail'],
    'data': [
        'security/nutking_security.xml',
        'security/ir.model.access.csv',
        'data/nutking_sequences.xml',
        'data/nutking_locations.xml',
        'data/nutking_picking_types.xml',
        'data/nutking_reasons.xml',
        'data/nutking_dashboard_data.xml',
        'views/nutking_dashboard_views.xml',
        'views/nutking_product_views.xml',
        'views/nutking_staff_views.xml',
        'views/nutking_truck_views.xml',
        'views/nutking_customer_views.xml',
        'views/nutking_supplier_views.xml',
        'views/nutking_reason_views.xml',
        'views/nutking_stock_operation_views.xml',
        'views/nutking_native_transfer_views.xml',
        'views/nutking_rapid_scan_views.xml',
        'views/nutking_physical_inventory_views.xml',
        'views/nutking_distribution_trip_views.xml',
        'views/nutking_offline_views.xml',
        'views/nutking_inventory_report_views.xml',
        'views/nutking_analysis_views.xml',
        'reports/nutking_report_templates.xml',
        'reports/nutking_report_actions.xml',
        'views/nutking_menus.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'nutking_inventory_distribution/static/src/scss/nutking_backend.scss',
        ],
    },
    'application': True,
    'installable': True,
    'auto_install': False,
}
