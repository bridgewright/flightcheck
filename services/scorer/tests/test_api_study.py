def test_study_router_is_implemented():
    from scorer.api.routers.study import build_router

    assert callable(build_router)
