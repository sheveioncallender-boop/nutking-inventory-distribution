# Nut King v0.5.5 — Developer Backend Recovery

- Removes the staging implication that placed Settings administrators in Nut King worker/management roles.
- Removes the worker Operations app from the developer administrator app switcher.
- Preserves the separate Nut King Administration app for `base.group_system`.
- Adds `/nutking/backend`, which opens a concrete backend dashboard action.
- Keeps administrators able to open `/nutking/` manually for testing.
- Versions the offline shell to v0.5.5 so the corrected Backend link is not served from the old cache.
