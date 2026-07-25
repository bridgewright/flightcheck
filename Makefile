SCORER=services/scorer
test:
	cd $(SCORER) && uv run pytest -q
lint:
	cd $(SCORER) && uv run ruff check .
bakeoff-latency:
	cd $(SCORER) && uv run python -m scorer.realtime_probe.scenario --provider $(PROVIDER) --mode latency
bakeoff-stability:
	cd $(SCORER) && uv run python -m scorer.realtime_probe.scenario --provider $(PROVIDER) --mode stability --minutes 22
bakeoff-mic:
	cd $(SCORER) && uv run python -m scorer.realtime_probe.mic --provider $(PROVIDER)
bakeoff-discrimination:
	cd $(SCORER) && uv run python -m scorer.bakeoff.discrimination
bakeoff-report:
	cd $(SCORER) && uv run python -m scorer.bakeoff.report
