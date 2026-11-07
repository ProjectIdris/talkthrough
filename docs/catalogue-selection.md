# Bounded lexical selection, still offline

This successor to PR27 improves **candidate discovery**, not the model, geometry or production request path. It still describes the same 21 public built-in families. The app, adapters, guide/schema, validator, renderer and dependencies are unchanged. Nothing calls a model or adds tools, credentials, recordings, network access or an assembly feature.

The important result is mixed: an independently authored fresh set found more useful families and many fewer unrelated suggestions, but half of absent-family requests still receive a wrong card and English paraphrase recall regressed. **Do not enable live routing on this evidence.**

## What changed

The original index admitted a card for any matching word in its description. Grammar, orientation and usage instructions therefore filled responses with unrelated cards. The successor separates different kinds of maintained evidence:

- IDs and complete aliases are strong positive phrases. Words use Unicode word segmentation, lowercase/diacritic normalization and a narrow plural fold. This recognizes a small curated multilingual vocabulary, not arbitrary translation.
- A separate keyword field contains component features and functions. Two distinct matching keywords admit a weaker candidate; document-frequency weighting ranks that evidence below ID/alias matches. Keywords do not come from user questions or model output. Repetition cannot inflate the score.
- Topic words support category discovery. Nearby browsing terms or a category-only query admit topic candidates. A broader browsing signal can rescue an otherwise empty query, but does not pad a specific match. Explicit universal browsing is supported. These are lexical rules, not inferred intent; category phrases can still produce extra cards.
- Small English/French/German/Spanish exclusion markers and local sense conflicts reduce obvious mistakes. Recognized exclusions also constrain category results. A separate positive occurrence can restore a family. Conflicts do not cross explicit coordinated-object separators. These rules do not understand all negation, roles, references or polysemy.
- Presentation summaries no longer decide admission. They still explain a selected part's orientation and limits. All returned examples are ordinary validated scene actions.

Scores use the strongest phrase per card: ID weight 8 or alias weight 4, plus phrase length capped at 8. Two-or-more keyword matches receive a score from 2 to 4, using the sum of log2(1 + entry count / keyword document frequency), divided by 8 and capped at 2. Topics score 1. Ties use stable catalogue IDs. These hand-set heuristic values are not probabilities or calibrated confidence.

No slots are filled without evidence. The fallback explicitly warns that lexical candidates can be incomplete or inappropriate and directs uncovered objects to ordinary primitives. An empty response is useful when nothing fits; silence is not proof that a component cannot be represented.

## Bounds and costs

Existing limits are unchanged: 10,000 entries, 2,048 UTF-8 bytes per complete card, 512 JavaScript string code units per query, 32 distinct normalized query terms, four returned cards, and 4,096 UTF-8 bytes for the complete minified response. Query term counting still includes function words. Whole cards are skipped rather than cut if they cannot fit. `truncated` means admitted candidates were omitted by count/bytes, not that all useful components were found. Source and returned cards remain isolated plain-JSON clones.

Index once and reuse. Normalized metadata is cached during construction and that temporary cache is then released. Repeated positive evidence is deduplicated. Search still visits postings and sorts admitted matches: bounded output is **not constant-time retrieval**. More curated metadata increases file size, index construction and response bytes. Synthetic repeats are not a substitute for 10,000 distinct, useful components.

## Independent comparison and the rejected attempt

All requests are original AI-authored smoke examples, not real user traffic, human judgments or representative accuracy. Each independent author saw only the old public part semantics, never the retrieval code, tests, earlier corpora or results, and did not execute retrieval. Labels mean useful depicted families, not exact shape correctness or complete scene satisfaction.

The original 36-case corpus is development/regression evidence. A new 48-case v2 set first tested a strict phrase-only candidate. That attempt increased precision but reduced positive hits from 33/40 to 28/40 and relevant families from 61/110 to 45/110. It was rejected. V2 then became development evidence for the general content-word approach; it is not held out for the final selector.

A different author created a further 48-case v3 corpus without seeing any prior corpus or selector. The successor's retrieval and card sources were frozen before that set was first inspected or scored:

- Retriever SHA-256: `cfea95443b88a49091c263de4277bd36403301df312cadc8e964393d2d1880b4`.
- Card source SHA-256: `a576f4d2aa1fed168d897b662acfa04086f5ffa49dfffbbc5c36e7838ff0f237`.
- V3 corpus SHA-256: `b48923ba997ed496782a1ce9ccb800261685e9c347c78e5b0aa0485422a2c702`.

Subsequent independent review found generic implementation errors: a negative command reset its own exclusion, category browsing ignored excluded IDs, universal browsing accepted a partial-word prefix, and a conflict could suppress a separate coordinated object. Each received a failing regression before correction. No aliases, keywords or labels changed after v3 exposure. The final source's entire v3 quality object is identical, including every case result. Nevertheless, the amended-source rerun is regression evidence, **not another untouched holdout**. Exact before/after source hashes are recorded in the results file. Every corpus is now public regression material.

## Fresh V3 result

Baseline is public PR27 `bdba58dc144f6e13918088d779990f81cab222ae`, exact tree `1fe78dda7d072e688fd3021232e70f40065bd26b`. Main was `bda682acd8b5fd2e0f2efef8d4caac864ecef40e`. Both selectors were scored by the unchanged evaluator with the same labels.

| Measure | Baseline | Successor |
| --- | ---: | ---: |
| Positive requests with any useful card | 35/40 | 37/40 |
| Positive requests with useful first card | 30/40 | 34/40 |
| Labelled families retrieved | 59/81 | 64/81 |
| Relevant / all returned cards | 59/180 | 64/78 |
| Correct absent-query abstentions | 0/8 | 4/8 |
| Empty positive requests | 2 | 3 |
| Broad-query families retrieved | 15/25 | 16/25 |
| Mixed supported/unsupported families retrieved | 14/15 | 14/15 |
| Mixed-request precision | 14/32 | 14/14 |
| English paraphrase families retrieved | 7/10 | 6/10 |
| Non-English families retrieved | 1/9 | 6/9 |
| Errors / response-budget violations | 0/0 | 0/0 |
| Largest complete response, UTF-8 bytes | 1,772 | 2,730 |

Broad and mixed hit rates both remain 8/8, but a hit can hide missing targets. Queries requesting more than four useful families cannot achieve full recall under the four-card cap. The report includes the count-only recall ceiling; byte budgets and ranking can reduce achievable recall further. Do not discard broad requests or relax their labels to improve a score.

Remaining failures include food wheels, newspaper headers, sports fans and human elbows; unseen synonyms; context mistaken for the depicted object; and exclusions phrased with “rather than”, “remove” or unsupported language forms. For example, requesting an Ethernet socket rather than a screen/button still includes the excluded controls. More empty answers and reduced English paraphrase recall are real costs, not successful fallback. The four non-English cases cannot establish language-wide accuracy.

The original 36-case regression now finds 37/41 labelled families and correctly abstains on 8/8 absent requests. V2 finds 71/110 families with 71/78 returned cards relevant and 5/8 abstentions. V2 retains one over-term-limit query as a visible error, rather than silently excluding it. These development scores must not be presented as independent final validation.

## Reproduce and inspect every outcome

```sh
node --test test/component-catalogue.test.ts test/catalogue-selection.test.ts test/catalogue-relevance.test.ts
node scripts/prototypes/evaluate-catalogue.ts
node scripts/prototypes/evaluate-catalogue.ts --corpus challenge-v2
node scripts/prototypes/evaluate-catalogue.ts --corpus validation-v3
node scripts/prototypes/benchmark-catalogue.ts
node scripts/prototypes/benchmark-first-visual.ts --entries 10000
```

`scripts/prototypes/catalogue-selection-results.json` retains baseline and candidate aggregate/category/language scores and every returned, missing and unexpected ID, exception, truncation flag and byte count, linked to the complete query/label/rationale corpora. It records exact baseline/current source and card hashes. Current CLI output recomputes every candidate result with provenance, separately labelled local CPU timing and a null live-target verdict. The unchanged `evaluateCatalogue` function can score the baseline checkout's `createCatalogue(partCards)` on the same files to reproduce the other side. Do not combine different corpora, hashes or selector revisions into one claimed comparison.

## Local measurements, not live performance

One Node v24.22.1 Linux x64 / AMD EPYC 9V74 run measured v3's 21-card in-memory construction at 6.04 ms, then equally pooled warm search plus JSON encoding at p50 0.036 ms / p95 0.103 ms (20 warmups and 100 samples per query). Imports and file loading are excluded.

A separate 10,000-entry synthetic scale run measured construction at 524.08 ms, broad `mechanical` lookup p50 3.97 ms / p95 9.15 ms and a 2,685-byte response from a 5,588,098-byte catalogue. This is slower than the simpler original index, and the earlier roughly 2.8 ms figure must not be reused for this revision. Repeated common-word queries were also probed; work and timing still grow with query/posting composition. These are observed local diagnostics, not guarantees.

One fresh-process Electron 45.2.2 run with those 10,000 synthetic cards reached catalogue readiness at 512.47 ms and first qualifying fixture-paint receipt at 657.55 ms. Baseline and invalid-action marker counts were zero; the valid marker appeared before the fixture step closed. This includes file decode/index and actual offscreen 2D fixture work, not model generation, a useful generated model, physical display presentation or a cold disk. Catalogue results do not change the hand-written fixture. No live three-second target, saved tokens, model-speed improvement or visual-quality claim is made.

## Verification and next gate

The baseline full suite passed 1,349 tests with 13 skips. The amended successor passed 1,362 with the same skips, 42 combined catalogue/relevance/first-paint checks, typecheck and build. Synthetic loopback fixtures use process-only proxy exclusions for 127.0.0.2. The first review run without that exclusion had one socket error; the rerun with the baseline test environment passed. Independent re-review found no remaining blocker for this bounded offline scope and confirmed the complete v3 quality output unchanged after corrections.

Keep PR27 draft and unmerged. Future work needs broader fresh judgments, realistic supported/unsupported and mixed requests, explicit product acceptance criteria for wrong suggestions versus misses, and paired authorized model/rendered-output trials. Preserve ordinary primitives and required guide/schema throughout. Current cards add prompt bytes if appended; this prototype does not reduce the existing guide/schema.
