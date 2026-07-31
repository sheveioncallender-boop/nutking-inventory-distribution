from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class NutkingTruck(models.Model):
    _name = 'nutking.truck'
    _description = 'Nut King Distribution Truck'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'name'

    name = fields.Char(string='Truck Name / Number', required=True, tracking=True)
    active = fields.Boolean(default=True)
    company_id = fields.Many2one('res.company', default=lambda self: self.env.company, required=True, index=True)
    registration_number = fields.Char(required=True, copy=False, index=True, tracking=True)
    barcode = fields.Char(copy=False, index=True, tracking=True)
    make = fields.Char()
    model = fields.Char()
    capacity_note = fields.Char(string='Carrying Capacity')
    default_driver_id = fields.Many2one('nutking.staff', domain=[('role', '=', 'driver')], tracking=True)
    default_team_ids = fields.Many2many('nutking.staff', 'nutking_truck_staff_rel', string='Default Distribution Team')
    stock_location_id = fields.Many2one('stock.location', string='Truck Inventory Location', readonly=True, copy=False)
    status = fields.Selection(
        [('available', 'Available'), ('loading', 'Loading'), ('on_route', 'On Route'), ('maintenance', 'Maintenance'), ('inactive', 'Inactive')],
        default='available',
        tracking=True,
        required=True,
    )
    notes = fields.Text()

    _registration_unique = models.Constraint(
        'unique(registration_number)',
        'Truck registration number must be unique.',
    )
    _barcode_unique = models.Constraint(
        'unique(barcode)',
        'Truck barcode must be unique.',
    )

    @api.model_create_multi
    def create(self, vals_list):
        trucks = super().create(vals_list)
        trucks._ensure_stock_locations()
        return trucks

    def write(self, vals):
        result = super().write(vals)
        self._ensure_stock_locations()
        return result

    def _ensure_stock_locations(self):
        root = self.env.ref('nutking_inventory_distribution.location_fg_trucks_root', raise_if_not_found=False)
        if not root:
            return
        for truck in self:
            if not truck.stock_location_id:
                location = self.env['stock.location'].sudo().create({
                    'name': truck.name,
                    'location_id': root.id,
                    'usage': 'internal',
                    'company_id': truck.company_id.id,
                    'barcode': truck.barcode or False,
                    'nutking_is_location': True,
                })
                truck.sudo().stock_location_id = location.id
            else:
                truck.stock_location_id.sudo().write({
                    'name': truck.name,
                    'barcode': truck.barcode or False,
                    'company_id': truck.company_id.id,
                    'nutking_is_location': True,
                })

    @api.constrains('default_driver_id')
    def _check_driver_role(self):
        for truck in self:
            if truck.default_driver_id and truck.default_driver_id.role != 'driver':
                raise ValidationError(_('The default driver must have the Driver role.'))
