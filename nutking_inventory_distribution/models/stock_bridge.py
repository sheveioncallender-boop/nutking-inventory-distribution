from odoo import fields, models


class StockLocation(models.Model):
    _inherit = 'stock.location'

    nutking_is_location = fields.Boolean(
        string='Nut King Operations Location',
        default=False,
        index=True,
        help='Identifies locations controlled by the Nut King Inventory & Distribution application.',
    )


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    nutking_operation_id = fields.Many2one(
        'nutking.stock.operation',
        string='Nut King Operation',
        readonly=True,
        copy=False,
        index=True,
        ondelete='set null',
    )
