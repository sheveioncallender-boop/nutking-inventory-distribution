import json
import uuid
from pathlib import Path

from odoo import fields, http
from odoo.fields import Command
from odoo.http import request


class NutkingOfflineController(http.Controller):

    @staticmethod
    def _require_nutking_user():
        if not request.env.user.has_group('nutking_inventory_distribution.group_nutking_user'):
            return request.make_json_response({'error': 'Nut King operations access is required.'}, status=403)
        return None

    @staticmethod
    def _operation_url(operation):
        action_id = request.env.ref('nutking_inventory_distribution.action_nutking_stock_operation').id
        return f'/web#action={action_id}&id={operation.id}&model=nutking.stock.operation&view_type=form'

    @staticmethod
    def _safe_int(value):
        return int(value) if value not in (None, False, '') else False

    @staticmethod
    def _device_datetime(value):
        if not value:
            return fields.Datetime.now()
        normalized = str(value).replace('T', ' ').replace('Z', '')[:19]
        return normalized

    @classmethod
    def _operation_values(cls, item, offline_id=False):
        lines = item.get('lines') or []
        if not isinstance(lines, list) or not lines or len(lines) > 500:
            raise ValueError('Add between 1 and 500 product lines.')
        return {
            'operation_type': item['operation_type'],
            'partner_id': cls._safe_int(item.get('partner_id')),
            'truck_id': cls._safe_int(item.get('truck_id')),
            'trip_id': cls._safe_int(item.get('trip_id')),
            'reason_id': cls._safe_int(item.get('reason_id')),
            'notes': item.get('notes'),
            'operation_date': cls._device_datetime(item.get('created_on_device')),
            'company_id': request.env.company.id,
            'offline_transaction_id': offline_id or False,
            'line_ids': [Command.create({
                'product_id': int(line['product_id']),
                'quantity': float(line['quantity']),
                'lot_reference': line.get('lot_reference'),
                'expiration_date': line.get('expiration_date') or False,
                'notes': line.get('notes'),
            }) for line in lines],
        }

    @http.route(['/nutking/offline', '/nutking/rapid-scan'], type='http', auth='user', methods=['GET'])
    def offline_app(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        module_path = Path(__file__).resolve().parents[1]
        content = (module_path / 'static' / 'offline' / 'index.html').read_text(encoding='utf-8')
        return request.make_response(content, headers=[
            ('Content-Type', 'text/html; charset=utf-8'),
            ('Cache-Control', 'no-cache'),
        ])

    @http.route('/nutking/sw.js', type='http', auth='public', methods=['GET'], csrf=False)
    def service_worker(self, **kwargs):
        module_path = Path(__file__).resolve().parents[1]
        content = (module_path / 'static' / 'offline' / 'sw.js').read_text(encoding='utf-8')
        return request.make_response(content, headers=[
            ('Content-Type', 'application/javascript; charset=utf-8'),
            ('Service-Worker-Allowed', '/nutking/'),
            ('Cache-Control', 'no-cache'),
        ])

    @http.route('/nutking/manifest.webmanifest', type='http', auth='public', methods=['GET'], csrf=False)
    def manifest(self, **kwargs):
        module_path = Path(__file__).resolve().parents[1]
        content = (module_path / 'static' / 'offline' / 'manifest.webmanifest').read_text(encoding='utf-8')
        return request.make_response(content, headers=[('Content-Type', 'application/manifest+json')])

    @http.route('/nutking/api/bootstrap', type='http', auth='user', methods=['GET'], csrf=False)
    def bootstrap(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        products = request.env['product.product'].search([
            ('active', '=', True),
            ('product_tmpl_id.nutking_active', '=', True),
            ('nutking_inventory_type', 'in', ('raw_material', 'finished_good')),
        ], order='name')
        trucks = request.env['nutking.truck'].search([('active', '=', True)], order='name')
        customers = request.env['res.partner'].search(
            [('nutking_is_customer', '=', True), ('active', '=', True)], order='name'
        )
        suppliers = request.env['res.partner'].search(
            [('nutking_is_supplier', '=', True), ('active', '=', True)], order='name'
        )
        reasons = request.env['nutking.movement.reason'].search([('active', '=', True)], order='name')
        capabilities = request.env['nutking.stock.operation'].allowed_operation_types_for_user()
        trips = request.env['nutking.distribution.trip'].search([
            ('state', 'in', ('planned', 'loading', 'in_progress', 'reconciliation')),
        ], order='planned_departure desc')
        recent_operations = request.env['nutking.stock.operation'].search([], order='operation_date desc', limit=100)

        quant_model = request.env['stock.quant'].sudo()
        raw_location = request.env.ref('nutking_inventory_distribution.location_rm_stock')
        finished_location = request.env.ref('nutking_inventory_distribution.location_fg_stock')
        balances = {'raw': {}, 'finished': {}, 'trucks': {}}
        for product in products:
            if product.nutking_inventory_type == 'raw_material':
                balances['raw'][str(product.id)] = quant_model._get_available_quantity(
                    product, raw_location, strict=False
                )
            elif product.nutking_inventory_type == 'finished_good':
                balances['finished'][str(product.id)] = quant_model._get_available_quantity(
                    product, finished_location, strict=False
                )
        finished_products = products.filtered(lambda item: item.nutking_inventory_type == 'finished_good')
        for truck in trucks.filtered('stock_location_id'):
            balances['trucks'][str(truck.id)] = {
                str(product.id): quant_model._get_available_quantity(
                    product, truck.stock_location_id, strict=False
                )
                for product in finished_products
            }

        return request.make_json_response({
            'user': {'id': request.env.user.id, 'name': request.env.user.name},
            'capabilities': capabilities,
            'balances': balances,
            'products': [{
                'id': product.id,
                'name': product.display_name,
                'barcode': product.barcode or '',
                'default_code': product.default_code or '',
                'type': product.nutking_inventory_type,
                'uom': product.uom_id.name,
                'minimum_qty': product.nutking_minimum_qty,
                'pack_size': product.product_tmpl_id.nutking_pack_size or '',
            } for product in products],
            'trucks': [{
                'id': truck.id,
                'name': truck.name,
                'barcode': truck.barcode or '',
                'registration': truck.registration_number or '',
                'status': truck.status,
            } for truck in trucks],
            'customers': [{
                'id': partner.id,
                'name': partner.display_name,
                'code': partner.nutking_customer_code or '',
                'phone': partner.phone or partner.nutking_mobile or '',
                'route': partner.nutking_route or '',
                'address': partner.contact_address or '',
            } for partner in customers],
            'suppliers': [{
                'id': partner.id,
                'name': partner.display_name,
                'code': partner.nutking_supplier_code or '',
                'phone': partner.phone or partner.nutking_mobile or '',
            } for partner in suppliers],
            'trips': [{
                'id': trip.id,
                'name': trip.name,
                'truck_id': trip.truck_id.id,
                'truck_name': trip.truck_id.name,
                'route_name': trip.route_name,
                'state': trip.state,
                'planned_departure': trip.planned_departure.isoformat() if trip.planned_departure else '',
            } for trip in trips],
            'reasons': [{
                'id': reason.id,
                'name': reason.name,
                'code': reason.code,
                'applies_to': reason.applies_to,
                'requires_note': reason.requires_note,
                'requires_supervisor': reason.requires_supervisor,
            } for reason in reasons],
            'recent_operations': [{
                'id': operation.id,
                'name': operation.name,
                'operation_type': operation.operation_type,
                'operation_label': dict(operation._fields['operation_type'].selection).get(operation.operation_type),
                'date': operation.operation_date.isoformat() if operation.operation_date else '',
                'state': operation.state,
                'quantity': operation.total_quantity,
                'partner': operation.partner_id.display_name or '',
                'truck': operation.truck_id.name or '',
                'url': self._operation_url(operation),
            } for operation in recent_operations],
            'server_time': fields.Datetime.now().isoformat(),
        })

    @http.route('/nutking/api/create-draft', type='http', auth='user', methods=['POST'], csrf=False)
    def create_draft(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        item = request.httprequest.get_json(silent=True) or {}
        allowed = request.env['nutking.stock.operation'].allowed_operation_types_for_user()
        if item.get('operation_type') not in allowed:
            return request.make_json_response({'error': 'Your Nut King role does not permit this operation.'}, status=403)
        try:
            operation = request.env['nutking.stock.operation'].with_user(request.env.user).create(
                self._operation_values(item)
            )
            return request.make_json_response({
                'id': operation.id,
                'name': operation.name,
                'state': operation.state,
                'web_url': self._operation_url(operation),
            })
        except Exception as exc:
            return request.make_json_response({'error': str(exc)}, status=400)

    @http.route('/nutking/api/sync', type='http', auth='user', methods=['POST'], csrf=False)
    def sync(self, **kwargs):
        denied = self._require_nutking_user()
        if denied:
            return denied
        payload = request.httprequest.get_json(silent=True) or {}
        transactions = payload.get('transactions', [])
        if not isinstance(transactions, list) or len(transactions) > 250:
            return request.make_json_response({'error': 'Invalid transaction batch.'}, status=400)

        results = []
        Offline = request.env['nutking.offline.transaction'].sudo()
        Operation = request.env['nutking.stock.operation'].with_user(request.env.user)
        allowed = set(Operation.allowed_operation_types_for_user())
        for item in transactions:
            external_uid = str(item.get('external_uid') or uuid.uuid4())[:128]
            existing = Offline.search([('external_uid', '=', external_uid)], limit=1)
            if existing and existing.state == 'processed':
                results.append({
                    'external_uid': external_uid,
                    'status': 'processed',
                    'operation': existing.operation_id.name or False,
                    'web_url': self._operation_url(existing.operation_id) if existing.operation_id else False,
                })
                continue
            if existing and existing.operation_id:
                results.append({
                    'external_uid': external_uid,
                    'status': existing.state,
                    'operation': existing.operation_id.name or False,
                    'web_url': self._operation_url(existing.operation_id),
                })
                continue

            offline = existing or Offline.create({
                'external_uid': external_uid,
                'device_name': str(item.get('device_name') or '')[:128],
                'created_on_device': self._device_datetime(item.get('created_on_device')),
                'user_id': request.env.user.id,
                'company_id': request.env.company.id,
                'payload': json.dumps(item),
            })
            if existing:
                offline.write({
                    'payload': json.dumps(item),
                    'device_name': str(item.get('device_name') or '')[:128],
                    'received_at': fields.Datetime.now(),
                    'error_message': False,
                    'state': 'pending',
                })
            try:
                if item.get('operation_type') not in allowed:
                    raise ValueError('Your Nut King role does not permit this operation.')
                with request.env.cr.savepoint():
                    operation = Operation.create(self._operation_values(item, offline.id))
                offline.write({'state': 'processed', 'operation_id': operation.id, 'error_message': False})
                results.append({
                    'external_uid': external_uid,
                    'status': 'processed',
                    'operation': operation.name,
                    'web_url': self._operation_url(operation),
                })
            except Exception as exc:  # queued for review; the draft creation is rolled back by savepoint
                offline.write({'state': 'error', 'error_message': str(exc)[:2000]})
                results.append({'external_uid': external_uid, 'status': 'error', 'error': str(exc)})
        return request.make_json_response({'results': results})
