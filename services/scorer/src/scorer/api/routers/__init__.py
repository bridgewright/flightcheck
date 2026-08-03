"""Per-resource route modules.

Each exposes `build_router(deps: Deps) -> APIRouter` returning routes with
paths RELATIVE to /api -- app.py owns the prefix and the bearer dependency,
so no router repeats them. The single exception is ops.build_public_router,
which carries /healthz: the one route that is neither prefixed nor
authenticated.
"""
