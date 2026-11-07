# Bounded component discovery experiment

A removable offline prototype using only public main bda682a. Keep it separate from assembly expansion and production adapter work. The app, full guide/schema and renderer remain unchanged.

Considered: expand the prompt with all components (grows with the library); give scene models retrieval tools (violates today's adapter contract); or retrieve a few trusted cards application-side before authoring (chosen for this offline test). Lexical retrieval is deliberately simple and has no model, embedding, network or credential requirement.

1. Test a reusable in-memory catalogue for deterministic exact/alias discovery, count and UTF-8 response limits, empty/no-match fallback, hostile/oversized queries, immutable cards and synthetic scale.
2. Seed only the 21 public built-in part families. Derive parameter bounds from the real spec. Test every example against the real validator, with ordinary ID follow-ups. No new geometry or new claims about editable internal subparts.
3. Add a reproducible offline benchmark for 21, 1,000 and 10,000 cards, measuring initialization and warm lexical lookup plus response bytes. Synthetic copies are scaling data, not new useful components. Compare payload sizes without equating bytes to tokens or model latency.
4. Run focused tests, full portable suite, typecheck, build and independent review. Document scope and limitations. Prepare a draft only if the review establishes a useful, isolated experiment.

Deferred: new assemblies, stable subpart contracts, expansion, live session state, streaming, adapter/prompt integration, models, visual acceptance and end-to-end latency. Their ownership and design need resolution before integration.
