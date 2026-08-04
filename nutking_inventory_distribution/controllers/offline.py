import json
import uuid
from collections import defaultdict
from pathlib import Path

from odoo import fields, http
from odoo.fields import Command
from odoo.http import request
from odoo.tools.float_utils import float_compare


class NutkingOfflineController(http.Controller):
    APP_VERSION = '0.5.5'
    MAX_TRANSACTION_BATCH = 250
    MAX_OPERATION_LINES = 500
    MAX_INVENTORY_LINES = 2000

    @staticmethod
    def _require_nutking_user():
        user = request.env.user
        if not (
            user.has_group('nutking_inventory_distribution.group_nutking_user')
            or user.has_group('base.group_system')
        ):
            return request.make_json_response(
                {'error': 'Nut King operations access is required.'},
                status=403,
            )
        return None

    @staticmethod
    def _operation_url(operation):
        if not operation:
            return False
        action_id = request.env.ref(
            'nutking_inventory_distribution.action_nutking_stock_operation'
        ).id
        return (
            f'/web#action={action_id}&id={operation.id}'
            '&model=nutking.stock.operation&view_type=form'
        )

    @staticmethod
    def _operation_print_url(operation):
        if not operation:
            return False
        return f'/nutking/operation/{operation.id}/print'

    @staticmethod
    def _trip_url(trip):
        if not trip:
            return False
        action_id = request.env.ref(
            'nutking_inventory_distribution.action_nutking_distribution_trip'
        ).id
        return (
            f'/web#action={action_id}&id={trip.id}'
            '&model=nutking.distribution.trip&view_type=form'
        )

    @staticmethod
    def _safe_int(value):
        try:
            return int(value) if value not in (None, False, '') else False
        except (TypeError, ValueError):
            return False

    @classmethod
    def _safe_int_list(cls, values, limit=500):
        if not isinstance(values, list):
            return []
        result = []
        for value in values[:limit]:
            converted = cls._safe_int(value)
            if converted:
                result.append(converted)
        return result

    @staticmethod
    def _device_datetime(value):
        if not value:
            return fields.Datetime.now()
        normalized = str(value).replace('T', ' ').replace('Z', '')[:19]
        try:
            return fields.Datetime.to_datetime(normalized)
        except (TypeError, ValueError):
            return fields.Datetime.now()

    @staticmethod
    def _date_value(value):
        if not value:
            return fields.Date.today()
        try:
            return fields.Date.to_date(str(value)[:10])
        except (TypeError, ValueError):
            return fields.Date.today()

    @staticmethod
    def _json_body():
        return request.httprequest.get_json(silent=True) or {}

    @staticmethod
    def _serialize_datetime(value):
        return value.isoformat() if value else ''

    @staticmethod
    def _selection_label(record, field_name, value):
        return dict(record._fields[field_name].selection).get(value, value or '')

    @classmethod
    def _resolve_trip(cls, item):
        Trip = request.env['nutking.distribution.trip']
        trip_id = cls._safe_int(item.get('trip_id'))
        if trip_id:
            trip = Trip.browse(trip_id).exists()
            if trip and trip.company_id == request.env.company:
                return trip
        trip_external_uid = str(item.get('trip_external_uid') or '')[:128]
        if trip_external_uid:
            transaction = request.env['nutking.offline.transaction'].sudo().search([
                ('external_uid', '=', trip_external_uid),
                ('trip_id', '!=', False),
                ('company_id', '=', request.env.company.id),
            ], limit=1)
            if transaction.trip_id:
                return transaction.trip_id.with_user(request.env.user)
        return Trip

    @classmethod
    def _resolve_operation(cls, item):
        Operation = request.env['nutking.stock.operation']
        operation_id = cls._safe_int(item.get('operation_id'))
        if operation_id:
            operation = Operation.browse(operation_id).exists()
            if operation and operation.company_id == request.env.company:
                return operation
        external_uid = str(item.get('operation_external_uid') or '')[:128]
        if external_uid:
            transaction = request.env['nutking.offline.transaction'].sudo().search([
                ('external_uid', '=', external_uid),
                ('operation_id', '!=', False),
                ('company_id', '=', request.env.company.id),
            ], limit=1)
            if transaction.operation_id:
                return transaction.operation_id.with_user(request.env.user)
        return Operation

    @classmethod
    def _operation_values(cls, item, offline_id=False):
        lines = item.get('lines') or []
        if not isinstance(lines, list) or not lines or len(lines) > cls.MAX_OPERATION_LINES:
            raise ValueError(
                f'Add between 1 and {cls.MAX_OPERATION_LINES} product lines.'
            )
        trip = cls._resolve_trip(item)
        notes = str(item.get('notes') or '')[:4000]
        return {
            'operation_type': item['operation_type'],
            'partner_id': cls._safe_int(item.get('partner_id')),
            'truck_id': cls._safe_int(item.get('truck_id')),
            'trip_id': trip.id or False,
            'reason_id': cls._safe_int(item.get('reason_id')),
            'external_reference': str(item.get('reference') or '')[:256] or False,
            'notes': notes or False,
            'operation_date': cls._device_datetime(item.get('created_on_device')),
            'company_id': request.env.company.id,
            'offline_transaction_id': offline_id or False,
            'line_ids': [Command.create({
                'product_id': int(line['product_id']),
                'quantity': float(line['quantity']),
                'lot_reference': str(line.get('lot_reference') or '')[:128] or False,
                'expiration_date': line.get('expiration_date') or False,
                'notes': str(line.get('notes') or '')[:256] or False,
            }) for line in lines],
        }

    @classmethod
    def _serialize_operation(cls, operation):
        return {
            'id': operation.id,
            'name': operation.name,
            'operation_type': operation.operation_type,
            'operation_label': cls._selection_label(
                operation, 'operation_type', operation.operation_type
            ),
            'date': cls._serialize_datetime(operation.operation_date),
            'state': operation.state,
            'state_label': cls._selection_label(operation, 'state', operation.state),
            'quantity': operation.total_quantity,
            'partner_id': operation.partner_id.id or False,
            'partner': operation.partner_id.display_name or '',
            'truck_id': operation.truck_id.id or False,
            'truck': operation.truck_id.name or '',
            'trip_id': operation.trip_id.id or False,
            'trip': operation.trip_id.name or '',
            'reason': operation.reason_id.name or '',
            'reference': operation.external_reference or '',
            'notes': operation.notes or '',
            'user': operation.user_id.name or '',
            'source': operation.source_location_id.display_name or '',
            'destination': operation.destination_location_id.display_name or '',
            'lines': [{
                'id': line.id,
                'product_id': line.product_id.id,
                'product': line.product_id.display_name,
                'barcode': line.product_id.barcode or '',
                'quantity': line.quantity,
                'uom': line.product_uom_id.name,
                'lot_reference': line.lot_reference or '',
                'expiration_date': str(line.expiration_date or ''),
                'notes': line.notes or '',
            } for line in operation.line_ids],
            'web_url': cls._operation_url(operation),
            'print_url': cls._operation_print_url(operation),
        }

    @classmethod
    def _serialize_trip(cls, trip):
        return {
            'id': trip.id,
            'name': trip.name,
            'truck_id': trip.truck_id.id,
            'truck_name': trip.truck_id.name,
            'driver_id': trip.driver_id.id,
            'driver_name': trip.driver_id.name,
            'team_ids': trip.team_ids.ids,
            'team_names': trip.team_ids.mapped('name'),
            'customer_ids': trip.customer_ids.ids,
            'route_name': trip.route_name,
            'state': trip.state,
            'state_label': cls._selection_label(trip, 'state', trip.state),
            'planned_departure': cls._serialize_datetime(trip.planned_departure),
            'actual_departure': cls._serialize_datetime(trip.actual_departure),
            'actual_return': cls._serialize_datetime(trip.actual_return),
            'total_loaded': trip.total_loaded,
            'total_delivered': trip.total_delivered,
            'total_returned': trip.total_returned,
            'total_damaged': trip.total_damaged,
            'total_variance': trip.total_variance,
            'variance_explanation': trip.variance_explanation or '',
            'supervisor_approved': trip.supervisor_approved,
            'notes': trip.notes or '',
            'reconciliation_lines': [{
                'product_id': line.product_id.id,
                'product': line.product_id.display_name,
                'loaded': line.qty_loaded,
                'delivered': line.qty_delivered,
                'returned': line.qty_returned,
                'damaged': line.qty_damaged,
                'variance': line.variance,
            } for line in trip.line_ids],
            'web_url': cls._trip_url(trip),
        }

    @classmethod
    def _inventory_rows(cls, products, location):
        Quant = request.env['stock.quant'].sudo()
        quants = Quant.search([
            ('location_id', '=', location.id),
            ('product_id', 'in', products.ids),
            ('company_id', 'in', (False, request.env.company.id)),
        ], order='product_id, lot_id, package_id, owner_id, id')
        rows = []
        products_with_quant = set()
        for quant in quants:
            products_with_quant.add(quant.product_id.id)
            rows.append({
                'row_key': f'quant-{quant.id}',
                'quant_id': quant.id,
                'product_id': quant.product_id.id,
                'product': quant.product_id.display_name,
                'barcode': quant.product_id.barcode or '',
                'default_code': quant.product_id.default_code or '',
                'uom': quant.product_id.uom_id.name,
                'tracking': quant.product_id.tracking,
                'lot_id': quant.lot_id.id or False,
                'lot_name': quant.lot_id.name or '',
                'package_id': quant.package_id.id or False,
                'owner_id': quant.owner_id.id or False,
                'quantity': quant.quantity,
                'reserved_quantity': quant.reserved_quantity,
                'available_quantity': quant.available_quantity,
                'last_count_date': str(quant.last_count_date or ''),
                'inventory_date': str(quant.inventory_date or ''),
                'location_id': location.id,
                'location': location.display_name,
            })
        for product in products.filtered(lambda p: p.id not in products_with_quant):
            rows.append({
                'row_key': f'product-{product.id}',
                'quant_id': False,
                'product_id': product.id,
                'product': product.display_name,
                'barcode': product.barcode or '',
                'default_code': product.default_code or '',
                'uom': product.uom_id.name,
                'tracking': product.tracking,
                'lot_id': False,
                'lot_name': '',
                'package_id': False,
                'owner_id': False,
                'quantity': 0.0,
                'reserved_quantity': 0.0,
                'available_quantity': 0.0,
                'last_count_date': '',
                'inventory_date': '',
                'location_id': location.id,
                'location': location.display_name,
            })
        return rows

    @http.route('/nutking/backend', type='http', auth='user', methods=['GET'])
    def developer_backend(self, **kwargs):
        """Open a concrete backend action and never the worker URL action."""
        if not request.env.user.has_group('base.group_system'):
            return request.make_json_response(
                {'error': 'Developer administration access is required.'},
                status=403,
            )
        action = request.env.ref(
            'nutking_inventory_distribution.action_nutking_dashboard'
        )
        return request.redirect(f'/web?debug=1#action={action.id}')

    @http.route('/nutking', type='http', auth='user', methods=['GET'])
    def workspace_redirect(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        return request.redirect('/nutking/')

    @http.route(
        ['/nutking/', '/nutking/offline', '/nutking/rapid-scan'],
        type='http', auth='user', methods=['GET']
    )
    def workspace(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        module_path = Path(__file__).resolve().parents[1]
        content = (
            module_path / 'static' / 'offline' / 'index.html'
        ).read_text(encoding='utf-8')
        return request.make_response(content, headers=[
            ('Content-Type', 'text/html; charset=utf-8'),
            ('Cache-Control', 'no-cache, must-revalidate'),
            ('X-Content-Type-Options', 'nosniff'),
        ])

    @http.route('/nutking/reset', type='http', auth='user', methods=['GET'])
    def reset_workspace_cache(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        module_path = Path(__file__).resolve().parents[1]
        content = (
            module_path / 'static' / 'offline' / 'reset.html'
        ).read_text(encoding='utf-8')
        return request.make_response(content, headers=[
            ('Content-Type', 'text/html; charset=utf-8'),
            ('Cache-Control', 'no-store, max-age=0'),
            ('X-Content-Type-Options', 'nosniff'),
        ])

    @http.route('/nutking/sw.js', type='http', auth='public', methods=['GET'], csrf=False)
    def service_worker(self, **kwargs):
        module_path = Path(__file__).resolve().parents[1]
        content = (
            module_path / 'static' / 'offline' / 'sw.js'
        ).read_text(encoding='utf-8')
        return request.make_response(content, headers=[
            ('Content-Type', 'application/javascript; charset=utf-8'),
            ('Service-Worker-Allowed', '/nutking/'),
            ('Cache-Control', 'no-cache, must-revalidate'),
        ])

    @http.route(
        '/nutking/manifest.webmanifest', type='http', auth='public',
        methods=['GET'], csrf=False
    )
    def manifest(self, **kwargs):
        module_path = Path(__file__).resolve().parents[1]
        content = (
            module_path / 'static' / 'offline' / 'manifest.webmanifest'
        ).read_text(encoding='utf-8')
        return request.make_response(content, headers=[
            ('Content-Type', 'application/manifest+json'),
            ('Cache-Control', 'no-cache, must-revalidate'),
        ])

    @http.route('/nutking/api/ping', type='http', auth='user', methods=['GET'], csrf=False)
    def ping(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        return request.make_json_response({
            'ok': True,
            'version': self.APP_VERSION,
            'server_time': fields.Datetime.now().isoformat(),
            'user_id': request.env.user.id,
        })

    @http.route('/nutking/api/bootstrap', type='http', auth='user', methods=['GET'], csrf=False)
    def bootstrap(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied

        company = request.env.company
        permissions = {
            'raw': request.env.user.has_group(
                'nutking_inventory_distribution.group_nutking_raw_clerk'
            ),
            'finished': request.env.user.has_group(
                'nutking_inventory_distribution.group_nutking_finished_clerk'
            ),
            'distribution': request.env.user.has_group(
                'nutking_inventory_distribution.group_nutking_distribution'
            ),
            'supervisor': request.env.user.has_group(
                'nutking_inventory_distribution.group_nutking_supervisor'
            ),
            'manager': request.env.user.has_group(
                'nutking_inventory_distribution.group_nutking_manager'
            ),
            'system': request.env.user.has_group('base.group_system'),
        }
        capabilities = request.env[
            'nutking.stock.operation'
        ].allowed_operation_types_for_user()
        permitted_types = []
        if permissions['raw']:
            permitted_types.append('raw_material')
        if permissions['finished'] or permissions['distribution']:
            permitted_types.append('finished_good')
        Product = request.env['product.product'].sudo()
        product_domain = [
            ('active', '=', True),
            ('product_tmpl_id.nutking_active', '=', True),
        ]
        product_domain.append(
            ('nutking_inventory_type', 'in', permitted_types)
            if permitted_types else ('id', '=', 0)
        )
        products = Product.search(product_domain, order='name')
        raw_products = products.filtered(
            lambda item: item.nutking_inventory_type == 'raw_material'
        )
        finished_products = products.filtered(
            lambda item: item.nutking_inventory_type == 'finished_good'
        )
        can_view_distribution_data = permissions['distribution'] or permissions['supervisor']
        can_view_finished_logistics = permissions['finished'] or can_view_distribution_data
        trucks = request.env['nutking.truck'].sudo().search([
            ('active', '=', True), ('company_id', '=', company.id)
        ], order='name') if can_view_finished_logistics else request.env['nutking.truck']
        customers = request.env['res.partner'].sudo().search([
            ('nutking_is_customer', '=', True), ('active', '=', True)
        ], order='name') if can_view_finished_logistics else request.env['res.partner']
        suppliers = request.env['res.partner'].sudo().search([
            ('nutking_is_supplier', '=', True), ('active', '=', True)
        ], order='name') if permissions['raw'] else request.env['res.partner']
        reason_scopes = ['all']
        if permissions['raw']:
            reason_scopes.append('raw')
        if permissions['finished']:
            reason_scopes.append('finished')
        if can_view_distribution_data:
            reason_scopes.append('distribution')
        reasons = request.env['nutking.movement.reason'].sudo().search([
            ('active', '=', True), ('applies_to', 'in', reason_scopes)
        ], order='name')
        staff = request.env['nutking.staff'].sudo().search([
            ('active', '=', True)
        ], order='name') if can_view_distribution_data else request.env['nutking.staff']
        Trip = request.env['nutking.distribution.trip'].sudo()
        trips = Trip.search([
            ('company_id', '=', company.id),
            ('state', 'in', ('planned', 'loading', 'in_progress', 'reconciliation')),
        ], order='planned_departure desc, id desc') if can_view_distribution_data else Trip
        Operation = request.env['nutking.stock.operation'].sudo()
        operation_domain = [('company_id', '=', company.id)]
        operation_domain.append(
            ('operation_type', 'in', capabilities)
            if capabilities else ('id', '=', 0)
        )
        recent_operations = Operation.search(
            operation_domain, order='operation_date desc, id desc', limit=250
        )

        raw_location = request.env.ref(
            'nutking_inventory_distribution.location_rm_stock'
        )
        finished_location = request.env.ref(
            'nutking_inventory_distribution.location_fg_stock'
        )
        Quant = request.env['stock.quant'].sudo()
        balances = {'raw': {}, 'finished': {}, 'trucks': {}}
        on_hand = {'raw': {}, 'finished': {}, 'trucks': {}}
        raw_quantities = defaultdict(float)
        for quant in Quant.search([
            ('location_id', '=', raw_location.id),
            ('product_id', 'in', raw_products.ids),
            ('company_id', 'in', (False, company.id)),
        ]):
            raw_quantities[quant.product_id.id] += quant.quantity
        finished_quantities = defaultdict(float)
        for quant in Quant.search([
            ('location_id', '=', finished_location.id),
            ('product_id', 'in', finished_products.ids),
            ('company_id', 'in', (False, company.id)),
        ]):
            finished_quantities[quant.product_id.id] += quant.quantity
        for product in raw_products:
            key = str(product.id)
            balances['raw'][key] = Quant._get_available_quantity(
                product, raw_location, strict=False
            )
            on_hand['raw'][key] = raw_quantities.get(product.id, 0.0)
        for product in finished_products:
            key = str(product.id)
            balances['finished'][key] = Quant._get_available_quantity(
                product, finished_location, strict=False
            )
            on_hand['finished'][key] = finished_quantities.get(product.id, 0.0)
        for truck in trucks.filtered('stock_location_id'):
            truck_key = str(truck.id)
            balances['trucks'][truck_key] = {}
            on_hand['trucks'][truck_key] = {}
            for product in finished_products:
                product_key = str(product.id)
                available = Quant._get_available_quantity(
                    product, truck.stock_location_id, strict=False
                )
                quantity = sum(Quant.search([
                    ('location_id', '=', truck.stock_location_id.id),
                    ('product_id', '=', product.id),
                    ('company_id', 'in', (False, company.id)),
                ]).mapped('quantity'))
                balances['trucks'][truck_key][product_key] = available
                on_hand['trucks'][truck_key][product_key] = quantity

        movement_summary = defaultdict(float)
        for operation in recent_operations.filtered(lambda op: op.state == 'done'):
            movement_summary[operation.operation_type] += operation.total_quantity

        low_stock = []
        for product in products.filtered(lambda p: p.nutking_minimum_qty > 0):
            source = (
                balances['raw'] if product.nutking_inventory_type == 'raw_material'
                else balances['finished']
            )
            quantity = source.get(str(product.id), 0.0)
            if quantity <= product.nutking_minimum_qty:
                low_stock.append({
                    'product_id': product.id,
                    'product': product.display_name,
                    'inventory_type': product.nutking_inventory_type,
                    'quantity': quantity,
                    'minimum_qty': product.nutking_minimum_qty,
                })

        stock_on_trucks = sum(
            quantity
            for truck_values in on_hand['trucks'].values()
            for quantity in truck_values.values()
        )
        return request.make_json_response({
            'app_version': self.APP_VERSION,
            'user': {
                'id': request.env.user.id,
                'name': request.env.user.name,
                'login': request.env.user.login,
            },
            'company': {'id': company.id, 'name': company.name},
            'permissions': permissions,
            'capabilities': capabilities,
            'locations': {
                'raw': {'id': raw_location.id, 'name': raw_location.display_name},
                'finished': {
                    'id': finished_location.id,
                    'name': finished_location.display_name,
                },
            },
            'native_actions': {
                'raw_inventory': request.env.ref(
                    'nutking_inventory_distribution.action_nutking_raw_physical_inventory'
                ).id,
                'finished_inventory': request.env.ref(
                    'nutking_inventory_distribution.action_nutking_finished_physical_inventory'
                ).id,
            },
            'balances': balances,
            'on_hand': on_hand,
            'products': [{
                'id': product.id,
                'name': product.display_name,
                'barcode': product.barcode or '',
                'default_code': product.default_code or '',
                'type': product.nutking_inventory_type,
                'uom': product.uom_id.name,
                'uom_rounding': product.uom_id.rounding,
                'tracking': product.tracking,
                'minimum_qty': product.nutking_minimum_qty,
                'units_per_case': product.product_tmpl_id.nutking_units_per_case,
                'pack_size': product.product_tmpl_id.nutking_pack_size or '',
            } for product in products],
            'inventory_rows': {
                'raw': self._inventory_rows(raw_products, raw_location),
                'finished': self._inventory_rows(
                    finished_products, finished_location
                ),
            },
            'trucks': [{
                'id': truck.id,
                'name': truck.name,
                'barcode': truck.barcode or '',
                'registration': truck.registration_number or '',
                'make': truck.make or '',
                'model': truck.model or '',
                'capacity': truck.capacity_note or '',
                'status': truck.status,
                'driver_id': truck.default_driver_id.id or False,
                'driver': truck.default_driver_id.name or '',
                'team_ids': truck.default_team_ids.ids,
                'stock_location_id': truck.stock_location_id.id or False,
                'stock_location': truck.stock_location_id.display_name or '',
            } for truck in trucks],
            'customers': [{
                'id': partner.id,
                'name': partner.display_name,
                'code': partner.nutking_customer_code or '',
                'phone': partner.phone or partner.nutking_mobile or '',
                'email': partner.email or '',
                'route': partner.nutking_route or '',
                'address': partner.contact_address or '',
                'notes': partner.nutking_delivery_notes or '',
            } for partner in customers],
            'suppliers': [{
                'id': partner.id,
                'name': partner.display_name,
                'code': partner.nutking_supplier_code or '',
                'phone': partner.phone or partner.nutking_mobile or '',
                'email': partner.email or '',
                'address': partner.contact_address or '',
            } for partner in suppliers],
            'staff': [{
                'id': member.id,
                'name': member.name,
                'employee_code': member.employee_code or '',
                'role': member.role,
                'phone': member.phone or '',
                'email': member.email or '',
            } for member in staff],
            'trips': [self._serialize_trip(trip) for trip in trips],
            'reasons': [{
                'id': reason.id,
                'name': reason.name,
                'code': reason.code,
                'applies_to': reason.applies_to,
                'requires_note': reason.requires_note,
                'requires_supervisor': reason.requires_supervisor,
            } for reason in reasons],
            'recent_operations': [
                self._serialize_operation(operation)
                for operation in recent_operations
            ],
            'dashboard': {
                'raw_product_count': len(raw_products),
                'finished_product_count': len(finished_products),
                'truck_count': len(trucks),
                'open_trip_count': len(trips),
                'pending_operation_count': Operation.search_count(
                    operation_domain + [('state', 'in', ('draft', 'confirmed'))]
                ),
                'offline_exception_count': request.env[
                    'nutking.offline.transaction'
                ].sudo().search_count([
                    ('company_id', '=', company.id),
                    ('state', '=', 'error'),
                ] + ([] if permissions['supervisor'] else [
                    ('user_id', '=', request.env.user.id)
                ])),
                'low_stock_count': len(low_stock),
                'stock_on_trucks_qty': stock_on_trucks,
            },
            'reports': {
                'low_stock': low_stock,
                'movement_summary': dict(movement_summary),
                'truck_stock': [{
                    'truck_id': truck.id,
                    'truck': truck.name,
                    'quantity': sum(
                        on_hand['trucks'].get(str(truck.id), {}).values()
                    ),
                } for truck in trucks],
                'trip_summary': [self._serialize_trip(trip) for trip in trips],
            },
            'server_time': fields.Datetime.now().isoformat(),
        })

    @http.route(
        '/nutking/operation/<int:operation_id>/print',
        type='http', auth='user', methods=['GET']
    )
    def print_operation(self, operation_id, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        Operation = request.env['nutking.stock.operation'].with_user(request.env.user)
        operation = Operation.browse(operation_id).exists()
        if not operation or operation.company_id != request.env.company:
            return request.not_found()
        allowed = set(Operation.allowed_operation_types_for_user())
        if operation.operation_type not in allowed:
            return request.make_response('Access denied.', status=403)
        try:
            pdf_content, _format = request.env['ir.actions.report']._render_qweb_pdf(
                'nutking_inventory_distribution.action_report_nutking_operation',
                res_ids=[operation.id],
            )
        except Exception as exc:
            return request.make_response(
                f'Unable to generate the Nut King document: {exc}', status=500
            )
        filename = f'Nut-King-{operation.name}'.replace('/', '-').replace('\\', '-')
        return request.make_response(pdf_content, headers=[
            ('Content-Type', 'application/pdf'),
            ('Content-Length', str(len(pdf_content))),
            ('Content-Disposition', f'inline; filename="{filename}.pdf"'),
            ('Cache-Control', 'no-store, max-age=0'),
        ])

    @http.route('/nutking/api/create-draft', type='http', auth='user', methods=['POST'], csrf=False)
    def create_draft(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        item = self._json_body()
        allowed = request.env[
            'nutking.stock.operation'
        ].allowed_operation_types_for_user()
        if item.get('operation_type') not in allowed:
            return request.make_json_response(
                {'error': 'Your Nut King role does not permit this operation.'},
                status=403,
            )
        try:
            operation = request.env[
                'nutking.stock.operation'
            ].with_user(request.env.user).create(self._operation_values(item))
            return request.make_json_response(self._serialize_operation(operation))
        except Exception as exc:
            return request.make_json_response({'error': str(exc)}, status=400)

    @http.route('/nutking/api/operation-action', type='http', auth='user', methods=['POST'], csrf=False)
    def operation_action(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        item = self._json_body()
        operation = self._resolve_operation(item)
        if not operation:
            return request.make_json_response(
                {'error': 'The stock operation could not be found.'}, status=404
            )
        try:
            action = item.get('action')
            if action == 'confirm':
                operation.action_confirm()
            elif action == 'process':
                operation.action_process()
            elif action == 'cancel':
                operation.action_cancel()
            elif action == 'reset_draft':
                operation.action_reset_draft()
            else:
                raise ValueError('Unsupported stock-operation action.')
            return request.make_json_response(
                {'ok': True, 'operation': self._serialize_operation(operation)}
            )
        except Exception as exc:
            return request.make_json_response({'error': str(exc)}, status=400)

    @classmethod
    def _create_trip(cls, item, offline):
        if not request.env.user.has_group(
            'nutking_inventory_distribution.group_nutking_distribution'
        ) and not request.env.user.has_group('base.group_system'):
            raise ValueError('Your Nut King role does not permit trip creation.')
        values = {
            'truck_id': cls._safe_int(item.get('truck_id')),
            'driver_id': cls._safe_int(item.get('driver_id')),
            'team_ids': [Command.set(cls._safe_int_list(item.get('team_ids')))],
            'customer_ids': [Command.set(cls._safe_int_list(item.get('customer_ids')))],
            'route_name': str(item.get('route_name') or '')[:256],
            'planned_departure': cls._device_datetime(
                item.get('planned_departure') or item.get('created_on_device')
            ),
            'notes': str(item.get('notes') or '')[:4000] or False,
            'company_id': request.env.company.id,
        }
        trip = request.env['nutking.distribution.trip'].with_user(
            request.env.user
        ).create(values)
        offline.write({
            'trip_id': trip.id,
            'result_reference': trip.name,
        })
        return {
            'trip_id': trip.id,
            'reference': trip.name,
            'web_url': cls._trip_url(trip),
        }

    @classmethod
    def _trip_event(cls, item, offline):
        trip = cls._resolve_trip(item)
        if not trip:
            raise ValueError('The distribution trip could not be found or synchronized.')
        action = item.get('action')
        explanation = str(item.get('variance_explanation') or '')[:4000]
        if explanation:
            trip.variance_explanation = explanation
        if action == 'depart':
            trip.action_depart()
        elif action == 'start_reconciliation':
            trip.action_start_reconciliation()
        elif action == 'approve_variance':
            trip.action_approve_variance()
        elif action == 'close':
            trip.action_close()
        elif action == 'cancel':
            trip.action_cancel()
        else:
            raise ValueError('Unsupported distribution-trip action.')
        offline.write({
            'trip_id': trip.id,
            'result_reference': f'{trip.name}: {action}',
        })
        return {
            'trip_id': trip.id,
            'reference': trip.name,
            'trip': cls._serialize_trip(trip),
            'web_url': cls._trip_url(trip),
        }

    @classmethod
    def _operation_event(cls, item, offline):
        operation = cls._resolve_operation(item)
        if not operation:
            raise ValueError('The stock operation could not be found or synchronized.')
        action = item.get('action')
        if action == 'confirm':
            operation.action_confirm()
        elif action == 'process':
            operation.action_process()
        elif action == 'cancel':
            operation.action_cancel()
        elif action == 'reset_draft':
            operation.action_reset_draft()
        else:
            raise ValueError('Unsupported stock-operation action.')
        offline.write({
            'operation_id': operation.id,
            'result_reference': f'{operation.name}: {action}',
        })
        return {
            'operation_id': operation.id,
            'reference': operation.name,
            'operation': cls._serialize_operation(operation),
            'web_url': cls._operation_url(operation),
        }

    @classmethod
    def _physical_inventory(cls, item, offline):
        warehouse_type = item.get('warehouse_type')
        config = {
            'raw': (
                'raw_material',
                'nutking_inventory_distribution.group_nutking_raw_clerk',
                'nutking_inventory_distribution.location_rm_stock',
                'Raw Materials',
            ),
            'finished': (
                'finished_good',
                'nutking_inventory_distribution.group_nutking_finished_clerk',
                'nutking_inventory_distribution.location_fg_stock',
                'Finished Goods',
            ),
        }.get(warehouse_type)
        if not config:
            raise ValueError('Choose Raw Materials or Finished Goods inventory.')
        inventory_type, group_xmlid, location_xmlid, label = config
        if not request.env.user.has_group(group_xmlid) and not request.env.user.has_group(
            'base.group_system'
        ):
            raise ValueError(f'You do not have access to the {label} physical inventory.')
        lines = item.get('lines') or []
        if not isinstance(lines, list) or not lines or len(lines) > cls.MAX_INVENTORY_LINES:
            raise ValueError(
                f'Add between 1 and {cls.MAX_INVENTORY_LINES} counted lines.'
            )

        location = request.env.ref(location_xmlid)
        count_date = cls._date_value(item.get('count_date'))
        force_conflicts = bool(item.get('force_conflicts')) and request.env.user.has_group(
            'nutking_inventory_distribution.group_nutking_supervisor'
        )
        Quant = request.env['stock.quant'].with_context(
            inventory_mode=True,
            nutking_physical_inventory=True,
            nutking_inventory_type=inventory_type,
            nutking_physical_location_id=location.id,
            default_location_id=location.id,
        )
        Product = request.env['product.product']
        quants_to_apply = request.env['stock.quant']
        applied_lines = 0
        differences = []
        for line in lines:
            product_id = cls._safe_int(line.get('product_id'))
            product = Product.browse(product_id).exists()
            if not product or product.nutking_inventory_type != inventory_type:
                raise ValueError('A counted product does not belong to this warehouse.')
            counted = float(line.get('counted_quantity'))
            expected = float(line.get('expected_quantity') or 0.0)
            quant_id = cls._safe_int(line.get('quant_id'))
            quant = Quant.browse(quant_id).exists() if quant_id else Quant
            if quant and (
                quant.location_id != location
                or quant.product_id != product
                or (quant.company_id and quant.company_id != request.env.company)
            ):
                raise ValueError('A physical-inventory line no longer matches its stock record.')
            if not quant:
                domain = [
                    ('product_id', '=', product.id),
                    ('location_id', '=', location.id),
                    ('company_id', 'in', (False, request.env.company.id)),
                    ('lot_id', '=', cls._safe_int(line.get('lot_id')) or False),
                    ('package_id', '=', cls._safe_int(line.get('package_id')) or False),
                    ('owner_id', '=', cls._safe_int(line.get('owner_id')) or False),
                ]
                quant = Quant.search(domain, limit=1)
            current = quant.quantity if quant else 0.0
            if not force_conflicts and float_compare(
                current, expected, precision_rounding=product.uom_id.rounding
            ) != 0:
                raise ValueError(
                    f'{product.display_name} changed from {expected} to {current} '
                    'after the device snapshot. Synchronize and recount, or ask a '
                    'supervisor to approve the conflict.'
                )
            if not quant and float_compare(
                counted, 0.0, precision_rounding=product.uom_id.rounding
            ) == 0:
                continue
            if not quant:
                lot_id = cls._safe_int(line.get('lot_id'))
                lot_reference = str(line.get('lot_reference') or '').strip()[:128]
                if product.tracking != 'none' and not lot_id:
                    if not lot_reference:
                        raise ValueError(
                            f'{product.display_name} requires a lot or serial number.'
                        )
                    lot = request.env['stock.lot'].sudo().search([
                        ('name', '=', lot_reference),
                        ('product_id', '=', product.id),
                        ('company_id', 'in', (False, request.env.company.id)),
                    ], limit=1)
                    if not lot:
                        lot = request.env['stock.lot'].sudo().create({
                            'name': lot_reference,
                            'product_id': product.id,
                            'company_id': request.env.company.id,
                        })
                    lot_id = lot.id
                quant = Quant.create({
                    'product_id': product.id,
                    'location_id': location.id,
                    'lot_id': lot_id or False,
                    'package_id': cls._safe_int(line.get('package_id')) or False,
                    'owner_id': cls._safe_int(line.get('owner_id')) or False,
                    'inventory_quantity': counted,
                })
            else:
                quant.with_context(inventory_mode=True).write({
                    'inventory_quantity': counted,
                    'inventory_date': count_date,
                    'user_id': request.env.user.id,
                })
            quants_to_apply |= quant
            applied_lines += 1
            differences.append({
                'product': product.display_name,
                'expected': current,
                'counted': counted,
                'difference': counted - current,
            })

        if quants_to_apply:
            result = quants_to_apply.with_context(inventory_mode=True).action_apply_inventory(
                date=count_date
            )
            if isinstance(result, dict):
                raise ValueError(
                    'Odoo detected a physical-inventory conflict. Synchronize the latest '
                    'stock and review the count before applying it.'
                )
        reference = str(item.get('reference') or '').strip()[:256]
        if not reference:
            reference = f'{label} count {count_date}'
        offline.write({'result_reference': reference})
        return {
            'reference': reference,
            'applied_lines': applied_lines,
            'differences': differences,
        }

    @classmethod
    def _stock_operation(cls, item, offline):
        Operation = request.env['nutking.stock.operation'].with_user(request.env.user)
        allowed = set(Operation.allowed_operation_types_for_user())
        if item.get('operation_type') not in allowed:
            raise ValueError('Your Nut King role does not permit this operation.')
        operation = Operation.create(cls._operation_values(item, offline.id))
        desired_state = item.get('desired_state')
        if not desired_state:
            # Backward compatibility with v0.3 device queues.
            desired_state = 'done' if item.get('process_on_sync') else 'draft'
        if desired_state == 'confirmed':
            operation.action_confirm()
        elif desired_state == 'done':
            operation.action_process()
        elif desired_state == 'cancelled':
            operation.action_cancel()
        elif desired_state != 'draft':
            raise ValueError('Unsupported requested stock-operation state.')
        offline.write({
            'operation_id': operation.id,
            'result_reference': operation.name,
        })
        return {
            'operation_id': operation.id,
            'reference': operation.name,
            'operation': cls._serialize_operation(operation),
            'web_url': cls._operation_url(operation),
        }

    @classmethod
    def _process_transaction(cls, item, offline):
        kind = item.get('kind') or item.get('transaction_kind') or 'stock_operation'
        if kind == 'stock_operation':
            return cls._stock_operation(item, offline)
        if kind == 'physical_inventory':
            return cls._physical_inventory(item, offline)
        if kind == 'trip_create':
            return cls._create_trip(item, offline)
        if kind == 'trip_event':
            return cls._trip_event(item, offline)
        if kind == 'operation_event':
            return cls._operation_event(item, offline)
        raise ValueError('Unsupported offline transaction type.')

    @http.route('/nutking/api/sync', type='http', auth='user', methods=['POST'], csrf=False)
    def sync(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        payload = self._json_body()
        transactions = payload.get('transactions', [])
        if not isinstance(transactions, list) or len(transactions) > self.MAX_TRANSACTION_BATCH:
            return request.make_json_response(
                {'error': 'Invalid transaction batch.'}, status=400
            )

        priority = {
            'trip_create': 0,
            'stock_operation': 10,
            'physical_inventory': 20,
            'trip_event': 30,
            'operation_event': 40,
        }
        transactions = sorted(
            transactions,
            key=lambda item: (
                priority.get(
                    item.get('kind') or item.get('transaction_kind') or 'stock_operation',
                    99,
                ),
                str(item.get('created_on_device') or ''),
            ),
        )
        results = []
        Offline = request.env['nutking.offline.transaction'].sudo()
        for item in transactions:
            external_uid = str(item.get('external_uid') or uuid.uuid4())[:128]
            kind = item.get('kind') or item.get('transaction_kind') or 'stock_operation'
            existing = Offline.search([
                ('external_uid', '=', external_uid),
                ('company_id', '=', request.env.company.id),
            ], limit=1)
            if existing and existing.state == 'processed':
                results.append({
                    'external_uid': external_uid,
                    'kind': existing.transaction_kind,
                    'status': 'processed',
                    'operation_id': existing.operation_id.id or False,
                    'trip_id': existing.trip_id.id or False,
                    'reference': existing.result_reference or '',
                    'web_url': (
                        self._operation_url(existing.operation_id)
                        if existing.operation_id
                        else self._trip_url(existing.trip_id)
                        if existing.trip_id
                        else False
                    ),
                })
                continue

            values = {
                'transaction_kind': kind,
                'device_name': str(item.get('device_name') or '')[:128],
                'created_on_device': self._device_datetime(
                    item.get('created_on_device')
                ),
                'user_id': request.env.user.id,
                'company_id': request.env.company.id,
                'payload': json.dumps(item),
                'received_at': fields.Datetime.now(),
                'error_message': False,
                'state': 'pending',
            }
            offline = existing or Offline.create({
                'external_uid': external_uid,
                **values,
            })
            if existing:
                offline.write(values)
            try:
                with request.env.cr.savepoint():
                    result = self._process_transaction(item, offline)
                offline.write({'state': 'processed', 'error_message': False})
                results.append({
                    'external_uid': external_uid,
                    'kind': kind,
                    'status': 'processed',
                    **result,
                })
            except Exception as exc:
                offline.write({
                    'state': 'error',
                    'error_message': str(exc)[:2000],
                })
                results.append({
                    'external_uid': external_uid,
                    'kind': kind,
                    'status': 'error',
                    'error': str(exc),
                })
        return request.make_json_response({
            'results': results,
            'server_time': fields.Datetime.now().isoformat(),
        })
