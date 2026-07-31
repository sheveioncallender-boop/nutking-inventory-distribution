from odoo import api, fields, models, _


class NutkingDashboard(models.Model):
    _name = 'nutking.dashboard'
    _description = 'Nut King Operations Dashboard'

    name = fields.Char(default='Nut King Operations')
    raw_product_count = fields.Integer(compute='_compute_kpis')
    finished_product_count = fields.Integer(compute='_compute_kpis')
    truck_count = fields.Integer(compute='_compute_kpis')
    open_trip_count = fields.Integer(compute='_compute_kpis')
    pending_operation_count = fields.Integer(compute='_compute_kpis')
    offline_pending_count = fields.Integer(compute='_compute_kpis')
    low_stock_count = fields.Integer(compute='_compute_kpis')
    stock_on_trucks_qty = fields.Float(compute='_compute_kpis')

    def _compute_kpis(self):
        Product = self.env['product.product'].sudo()
        Truck = self.env['nutking.truck'].sudo()
        Trip = self.env['nutking.distribution.trip'].sudo()
        Operation = self.env['nutking.stock.operation'].sudo()
        Offline = self.env['nutking.offline.transaction'].sudo()
        Quant = self.env['stock.quant'].sudo()
        for dashboard in self:
            raw_products = Product.search([('nutking_inventory_type', '=', 'raw_material'), ('active', '=', True)])
            finished_products = Product.search([('nutking_inventory_type', '=', 'finished_good'), ('active', '=', True)])
            company_domain = [('company_id', '=', self.env.company.id)]
            trucks = Truck.search(company_domain + [('active', '=', True)])
            dashboard.raw_product_count = len(raw_products)
            dashboard.finished_product_count = len(finished_products)
            dashboard.truck_count = len(trucks)
            dashboard.open_trip_count = Trip.search_count(company_domain + [('state', 'not in', ('done', 'cancelled'))])
            dashboard.pending_operation_count = Operation.search_count(company_domain + [('state', 'in', ('draft', 'confirmed'))])
            dashboard.offline_pending_count = Offline.search_count(company_domain + [('state', 'in', ('pending', 'error'))])
            low_count = 0
            rm_loc = self.env.ref('nutking_inventory_distribution.location_rm_stock', raise_if_not_found=False)
            fg_loc = self.env.ref('nutking_inventory_distribution.location_fg_stock', raise_if_not_found=False)
            for product in raw_products | finished_products:
                location = rm_loc if product.nutking_inventory_type == 'raw_material' else fg_loc
                qty = Quant._get_available_quantity(product, location, strict=False) if location else 0.0
                if product.nutking_minimum_qty and qty <= product.nutking_minimum_qty:
                    low_count += 1
            dashboard.low_stock_count = low_count
            truck_locations = trucks.mapped('stock_location_id')
            dashboard.stock_on_trucks_qty = sum(Quant.search([('location_id', 'child_of', truck_locations.ids)]).mapped('quantity')) if truck_locations else 0.0

    def _action(self, xmlid):
        return self.env['ir.actions.actions']._for_xml_id(xmlid)

    def _rapid_scan_action(self, operation_type):
        return {
            'type': 'ir.actions.act_url',
            'url': f'/nutking/rapid-scan?operation_type={operation_type}',
            'target': 'self',
        }

    def action_receive_raw(self):
        return self._rapid_scan_action('raw_receipt')

    def action_issue_raw(self):
        return self._rapid_scan_action('raw_issue')

    def action_add_finished(self):
        return self._rapid_scan_action('finished_add')

    def action_issue_finished(self):
        return self._rapid_scan_action('finished_issue')

    def action_raw_physical_inventory(self):
        return self.env['stock.quant'].action_nutking_raw_physical_inventory()

    def action_finished_physical_inventory(self):
        return self.env['stock.quant'].action_nutking_finished_physical_inventory()

    def action_trips(self):
        return self._action('nutking_inventory_distribution.action_nutking_distribution_trip')

    def action_operations(self):
        return self._action('nutking_inventory_distribution.action_nutking_stock_operation')

    def action_offline(self):
        return {
            'type': 'ir.actions.act_url',
            'url': '/nutking/offline',
            'target': 'self',
        }
