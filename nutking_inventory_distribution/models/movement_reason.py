from odoo import fields, models


class NutkingMovementReason(models.Model):
    _name = 'nutking.movement.reason'
    _description = 'Nut King Stock Movement Reason'
    _order = 'sequence, name'

    name = fields.Char(required=True)
    code = fields.Char(required=True, copy=False, index=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    applies_to = fields.Selection(
        [('raw', 'Raw Materials'), ('finished', 'Finished Goods'), ('distribution', 'Distribution'), ('all', 'All')],
        default='all',
        required=True,
    )
    requires_note = fields.Boolean(default=False)
    requires_supervisor = fields.Boolean(default=False)

    _code_unique = models.Constraint('unique(code)', 'Movement reason code must be unique.')
