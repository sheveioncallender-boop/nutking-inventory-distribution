from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError
from odoo.fields import Command
from odoo.tools.float_utils import float_is_zero


class NutkingDistributionTrip(models.Model):
    _name = 'nutking.distribution.trip'
    _description = 'Nut King Distribution Trip'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'planned_departure desc, id desc'

    name = fields.Char(default='New', readonly=True, copy=False, index=True)
    truck_id = fields.Many2one('nutking.truck', required=True, tracking=True)
    company_id = fields.Many2one('res.company', default=lambda self: self.env.company, required=True, index=True)
    driver_id = fields.Many2one('nutking.staff', domain=[('role', '=', 'driver')], required=True, tracking=True)
    team_ids = fields.Many2many('nutking.staff', 'nutking_trip_staff_rel', string='Distribution Team', tracking=True)
    route_name = fields.Char(required=True, tracking=True)
    customer_ids = fields.Many2many('res.partner', 'nutking_trip_customer_rel', domain=[('nutking_is_customer', '=', True)], string='Planned Customers')
    planned_departure = fields.Datetime(default=fields.Datetime.now, required=True)
    actual_departure = fields.Datetime(readonly=True, tracking=True)
    actual_return = fields.Datetime(readonly=True, tracking=True)
    state = fields.Selection(
        [('planned', 'Planned'), ('loading', 'Loading'), ('in_progress', 'In Progress'), ('reconciliation', 'Reconciliation'), ('done', 'Closed'), ('cancelled', 'Cancelled')],
        default='planned', required=True, tracking=True, index=True,
    )
    operation_ids = fields.One2many('nutking.stock.operation', 'trip_id', string='Stock Operations')
    line_ids = fields.One2many('nutking.distribution.trip.line', 'trip_id', string='Trip Reconciliation', readonly=True)
    total_loaded = fields.Float(compute='_compute_totals', store=True)
    total_delivered = fields.Float(compute='_compute_totals', store=True)
    total_returned = fields.Float(compute='_compute_totals', store=True)
    total_damaged = fields.Float(compute='_compute_totals', store=True)
    total_variance = fields.Float(compute='_compute_totals', store=True)
    variance_explanation = fields.Text(tracking=True)
    supervisor_approved = fields.Boolean(tracking=True)
    notes = fields.Text()

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('nutking.distribution.trip') or 'New'
        trips = super().create(vals_list)
        trips._check_truck_availability()
        return trips

    @api.constrains('truck_id', 'state')
    def _check_truck_availability(self):
        active_states = ('planned', 'loading', 'in_progress', 'reconciliation')
        for trip in self.filtered(lambda rec: rec.truck_id and rec.state in active_states):
            conflict = self.search_count([
                ('id', '!=', trip.id),
                ('truck_id', '=', trip.truck_id.id),
                ('state', 'in', active_states),
            ])
            if conflict:
                raise ValidationError(_('This truck is already assigned to another open distribution trip.'))

    def _check_distribution_role(self):
        if not (
            self.env.user.has_group('base.group_system')
            or self.env.user.has_group('nutking_inventory_distribution.group_nutking_distribution')
        ):
            raise UserError(_('Your Nut King role does not permit distribution-trip operations.'))
        return True

    def _operation_quantity_by_product(self, operation_types):
        self.ensure_one()
        quantities = {}
        for operation in self.operation_ids.filtered(lambda op: op.state == 'done' and op.operation_type in operation_types):
            for line in operation.line_ids:
                quantities[line.product_id] = quantities.get(line.product_id, 0.0) + line.quantity
        return quantities

    def _refresh_reconciliation_lines(self):
        Line = self.env['nutking.distribution.trip.line'].sudo()
        for trip in self:
            loaded = trip._operation_quantity_by_product({'truck_load'})
            delivered = trip._operation_quantity_by_product({'customer_delivery'})
            returned = trip._operation_quantity_by_product({'truck_return'})
            damaged = trip._operation_quantity_by_product({'finished_damage'})
            products = loaded.keys() | delivered.keys() | returned.keys() | damaged.keys()
            trip.line_ids.sudo().unlink()
            Line.create([{
                'trip_id': trip.id,
                'product_id': product.id,
                'qty_loaded': loaded.get(product, 0.0),
                'qty_delivered': delivered.get(product, 0.0),
                'qty_returned': returned.get(product, 0.0),
                'qty_damaged': damaged.get(product, 0.0),
            } for product in products])
        return True

    @api.depends('operation_ids.state', 'operation_ids.operation_type', 'operation_ids.line_ids.quantity')
    def _compute_totals(self):
        for trip in self:
            trip.total_loaded = sum(trip.operation_ids.filtered(lambda op: op.state == 'done' and op.operation_type == 'truck_load').mapped('total_quantity'))
            trip.total_delivered = sum(trip.operation_ids.filtered(lambda op: op.state == 'done' and op.operation_type == 'customer_delivery').mapped('total_quantity'))
            trip.total_returned = sum(trip.operation_ids.filtered(lambda op: op.state == 'done' and op.operation_type == 'truck_return').mapped('total_quantity'))
            trip.total_damaged = sum(trip.operation_ids.filtered(lambda op: op.state == 'done' and op.operation_type == 'finished_damage').mapped('total_quantity'))
            trip.total_variance = trip.total_loaded - trip.total_delivered - trip.total_returned - trip.total_damaged

    def _new_operation_action(self, operation_type, name):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': name,
            'res_model': 'nutking.stock.operation',
            'view_mode': 'form',
            'target': 'current',
            'context': {
                'default_operation_type': operation_type,
                'default_trip_id': self.id,
                'default_truck_id': self.truck_id.id,
            },
        }

    def action_create_load(self):
        self._check_distribution_role()
        self.ensure_one()
        if self.state not in ('planned', 'loading'):
            raise UserError(_('Truck loading is only available while the trip is planned or loading.'))
        if self.state == 'planned':
            self.write({'state': 'loading'})
            self.truck_id.status = 'loading'
        return self._new_operation_action('truck_load', _('Load Truck'))

    def action_create_delivery(self):
        self._check_distribution_role()
        self.ensure_one()
        if self.state not in ('in_progress', 'reconciliation'):
            raise UserError(_('The truck must depart before deliveries are recorded.'))
        return self._new_operation_action('customer_delivery', _('Record Customer Delivery'))

    def action_create_return(self):
        self._check_distribution_role()
        self.ensure_one()
        if self.state not in ('in_progress', 'reconciliation'):
            raise UserError(_('The truck must depart before returned stock is recorded.'))
        return self._new_operation_action('truck_return', _('Receive Truck Return'))

    def action_depart(self):
        self._check_distribution_role()
        for trip in self:
            if trip.state != 'loading':
                raise UserError(_('Only a trip in Loading status can depart.'))
            if not trip.operation_ids.filtered(lambda op: op.operation_type == 'truck_load' and op.state == 'done'):
                raise UserError(_('At least one completed truck load is required before departure.'))
            trip.write({'state': 'in_progress', 'actual_departure': fields.Datetime.now()})
            trip.truck_id.status = 'on_route'
        return True

    def action_start_reconciliation(self):
        self._check_distribution_role()
        if any(trip.state != 'in_progress' for trip in self):
            raise UserError(_('Only trips currently in progress can start reconciliation.'))
        self._refresh_reconciliation_lines()
        self.write({'state': 'reconciliation', 'actual_return': fields.Datetime.now()})
        return True

    def action_approve_variance(self):
        if not self.env.user.has_group('nutking_inventory_distribution.group_nutking_supervisor'):
            raise UserError(_('Only a Nut King supervisor or manager can approve a variance.'))
        for trip in self:
            if not trip.variance_explanation:
                raise ValidationError(_('Enter a variance explanation before approval.'))
            trip.supervisor_approved = True
        return True

    def action_close(self):
        if not (self.env.user.has_group('base.group_system') or self.env.user.has_group('nutking_inventory_distribution.group_nutking_supervisor')):
            raise UserError(_('Only a Nut King supervisor or manager can close a distribution trip.'))
        for trip in self:
            if trip.state != 'reconciliation':
                raise UserError(_('The trip must be in reconciliation before it can be closed.'))
            if not float_is_zero(trip.total_variance, precision_digits=2) and not trip.supervisor_approved:
                raise UserError(_('This trip has a variance. A supervisor must explain and approve it before closing.'))
            trip.state = 'done'
            trip.truck_id.status = 'available'
        return True

    def action_cancel(self):
        for trip in self:
            if trip.operation_ids.filtered(lambda op: op.state == 'done'):
                raise UserError(_('A trip with completed stock operations cannot be cancelled.'))
            trip.state = 'cancelled'
            trip.truck_id.status = 'available'
        return True


class NutkingDistributionTripLine(models.Model):
    _name = 'nutking.distribution.trip.line'
    _description = 'Nut King Trip Reconciliation Line'

    trip_id = fields.Many2one('nutking.distribution.trip', required=True, ondelete='cascade', index=True)
    product_id = fields.Many2one('product.product', readonly=True)
    qty_loaded = fields.Float(readonly=True)
    qty_delivered = fields.Float(readonly=True)
    qty_returned = fields.Float(readonly=True)
    qty_damaged = fields.Float(readonly=True)
    variance = fields.Float(compute='_compute_variance')

    @api.depends('qty_loaded', 'qty_delivered', 'qty_returned', 'qty_damaged')
    def _compute_variance(self):
        for line in self:
            line.variance = line.qty_loaded - line.qty_delivered - line.qty_returned - line.qty_damaged
