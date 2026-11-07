# Catalogue relevance evaluation implementation plan

**Goal:** Decide whether bounded component discovery selects useful cards for realistic requests before connecting it to a live model.

**Architecture:** A removable offline evaluator scores the unchanged retriever against independently authored, explicit relevance labels over the 21 public built-in families. No production file, guide, schema, adapter, renderer, credential or network route changes. Existing ordinary-primitive fallback and all retrieval bounds remain intact.

**Basis and choice:** Public PR27 head 9454d374. App integration was considered but would expose unmeasured lexical selection to live requests; another synthetic speed benchmark would not resolve relevance. Evaluate selection first. Assembly implementation and expansion remain outside this change.

## Work

- [x] Add test-first evaluator with exact rank-sensitive hit, recall, precision, false-positive fallback and failure reporting. Missing labels, duplicate/unknown IDs, malformed cases and duplicate results must fail rather than silently inflate metrics. Empty denominators are null, not a claimed perfect score.
- [x] Add an independently authored challenge fixture with realistic direct, paraphrased, multi-part, absent and negated requests plus multilingual coverage. Retain rationales and full per-case misses/distractors. These are AI-authored smoke labels, not user traffic, human-judged ground truth or statistically representative held-out data. Do not tune the existing retriever to this corpus.
- [x] Add an offline CLI reporting corpus/card SHA-256, metric definitions, aggregate and category/language slices, response bytes, separate construction and warm lookup time. No generated timings or live-model result. Bound checks are separate from relevance.
- [x] Run focused tests, full suite, typecheck/build, benchmark and fresh independent review. Document observed weaknesses and the next production gate. Supply a non-forced PR27 successor to the established hearthworksai publisher only after verification; no merge.

## Review focus

Relevant queries with no returned cards must count as misses; absent queries with unrelated cards must count as false positives. Multiple relevant targets must not be collapsed into an easy hit. Duplicate returns cannot improve precision or recall. Missing/malformed labels must never become negative labels. Runtime errors must be visible and count against successful retrieval rather than disappear. Timing excludes model inference and rendering. Separate offline warm samples from initialization.

## Verification outcome

The evaluator and CLI were observed failing before implementation; a sparse-label/malformed-envelope regression failed before its correction. The unchanged PR27 baseline passed 1,339 tests with 13 skips. The successor passed 1,349 with the same 13 skips, 29 combined catalogue/relevance/first-paint checks, typecheck and build. Independent review recomputed the metrics and probed label/order/error cases with no blocking finding. Its one documentation caveat is now explicit: result validation covers the envelope and known IDs, not the full card payload. Production integration remains deliberately deferred because the 36-case smoke corpus exposes false positives and paraphrase misses.
