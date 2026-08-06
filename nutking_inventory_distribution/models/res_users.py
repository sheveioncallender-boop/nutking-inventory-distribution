from odoo import api, models
from odoo.fields import Command


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.model
    def nutking_recover_system_administrators(self):
        """Normalize every Odoo system administrator for safe backend access.

        Earlier staging releases assigned the worker workspace as a Home Action
        and temporarily attached administrators to Nut King worker roles. A plain
        ``/web`` request can therefore reopen the PWA unless both the role state
        and Home Action are repaired.

        This migration deliberately finds administrators through ``all_group_ids``
        so it also covers users who receive ``base.group_system`` through an
        implied group. Their Home Action is set to the dedicated Odoo backend
        Quick Operations action, never to an ``ir.actions.act_url`` worker route.
        """
        system_group = self.env.ref('base.group_system')
        worker_group_xmlids = (
            'nutking_inventory_distribution.group_nutking_manager',
            'nutking_inventory_distribution.group_nutking_supervisor',
            'nutking_inventory_distribution.group_nutking_distribution',
            'nutking_inventory_distribution.group_nutking_finished_clerk',
            'nutking_inventory_distribution.group_nutking_raw_clerk',
            'nutking_inventory_distribution.group_nutking_user',
        )
        worker_groups = self.env['res.groups'].sudo().browse()
        for xmlid in worker_group_xmlids:
            group = self.env.ref(xmlid, raise_if_not_found=False)
            if group:
                worker_groups |= group

        administrators = self.sudo().with_context(active_test=False).search([
            ('all_group_ids', 'in', [system_group.id]),
        ])
        backend_action = self.env.ref(
            'nutking_inventory_distribution.action_nutking_admin_quick_operations',
            raise_if_not_found=False,
        ) or self.env.ref(
            'nutking_inventory_distribution.action_nutking_dashboard',
            raise_if_not_found=False,
        )

        if administrators:
            values = {
                'group_ids': [Command.unlink(group.id) for group in worker_groups],
                'action_id': backend_action.id if backend_action else False,
            }
            administrators.sudo().write(values)

        self.env.registry.clear_cache()
        return True

    def nutking_prepare_backend_access(self):
        """Repair the current administrator immediately before opening Odoo."""
        self.ensure_one()
        if not self.has_group('base.group_system'):
            return False
        self.env['res.users'].sudo().nutking_recover_system_administrators()
        return True
