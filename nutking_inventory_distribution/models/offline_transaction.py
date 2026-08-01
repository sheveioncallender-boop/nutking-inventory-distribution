import json

from odoo import fields, models


class NutkingOfflineTransaction(models.Model):
    _name = 'nutking.offline.transaction'
    _description = 'Nut King Offline Transaction'
    _order = 'created_on_device desc, id desc'

    external_uid = fields.Char(required=True, copy=False, index=True)
    transaction_kind = fields.Selection(
        [
            ('stock_operation', 'Stock Operation'),
            ('physical_inventory', 'Physical Inventory'),
            ('trip_create', 'Create Distribution Trip'),
            ('trip_event', 'Distribution Trip Action'),
            ('operation_event', 'Stock Operation Action'),
        ],
        default='stock_operation',
        required=True,
        index=True,
    )
    device_name = fields.Char()
    created_on_device = fields.Datetime(required=True)
    received_at = fields.Datetime(default=fields.Datetime.now, required=True)
    user_id = fields.Many2one('res.users', required=True, default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', default=lambda self: self.env.company, required=True, index=True)
    payload = fields.Text(required=True)
    state = fields.Selection(
        [('pending', 'Pending'), ('processed', 'Processed'), ('error', 'Error'), ('duplicate', 'Duplicate')],
        default='pending',
        required=True,
        index=True,
    )
    operation_id = fields.Many2one('nutking.stock.operation', readonly=True)
    trip_id = fields.Many2one('nutking.distribution.trip', readonly=True)
    result_reference = fields.Char(readonly=True)
    error_message = fields.Text(readonly=True)

    _external_uid_unique = models.Constraint(
        'unique(external_uid)',
        'Offline transaction identifier must be unique.',
    )

    def payload_dict(self):
        self.ensure_one()
        return json.loads(self.payload or '{}')
