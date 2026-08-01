from odoo import api, models


class StockPickingType(models.Model):
    """Compatibility defaults for optional Enterprise/custom stock extensions.

    Some hosted databases extend ``stock.picking.type`` with required fields that
    are not part of Odoo Community/core.  XML records created by this module must
    still receive a valid value when such an extension is installed.
    """

    _inherit = "stock.picking.type"

    @api.model
    def _nutking_required_extension_default(self, field_name):
        field = self._fields.get(field_name)
        if not field:
            return None

        default = field.default
        if callable(default):
            try:
                default = default(self)
            except TypeError:
                default = default()

        # A Boolean False is a real PostgreSQL value.  For a required Selection,
        # False becomes NULL, so choose a valid option instead.
        if field.type == "boolean":
            return bool(default)

        if field.type == "selection":
            if default not in (None, False, ""):
                return default
            try:
                selection = field._description_selection(self.env)
            except Exception:
                selection = field.selection(self) if callable(field.selection) else field.selection
            keys = [item[0] for item in (selection or [])]
            preferred = (
                "none",
                "not_set",
                "no_restriction",
                "no_package",
                "without_package",
                "no",
            )
            return next((value for value in preferred if value in keys), keys[0] if keys else False)

        if default not in (None, False):
            return default
        if field.type in ("integer", "float", "monetary"):
            return 0
        if field.type in ("char", "text", "html"):
            return ""
        return False

    @api.model_create_multi
    def create(self, vals_list):
        # ``restrict_put_in_pack`` is added by an installed stock extension on
        # some Enterprise/hosted databases and may be required at SQL level.
        # Keep the module Community-compatible by only supplying it when present.
        field_name = "restrict_put_in_pack"
        if field_name in self._fields:
            fallback = self._nutking_required_extension_default(field_name)
            for vals in vals_list:
                if vals.get(field_name) in (None, ""):
                    vals[field_name] = fallback
        return super().create(vals_list)
