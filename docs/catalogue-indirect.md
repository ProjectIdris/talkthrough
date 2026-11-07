# Compositional description matching, still offline

This successor to PR27 adds a general **lexical description-matching mechanism**, not general language understanding. It still covers the same 21 public prebuilt component families. No new geometry, model call, production routing, model tool, network destination or dependency is added. The app, adapters, guide/schema, validator and renderer are untouched.

The fresh evaluation found more of the requested parts, but also added irrelevant context parts. **Keep production unwired.** This is an offline recall improvement with a measured precision cost, not an accepted production selector.

## Method and tradeoff

Whole-question aliases would reward memorising examples. Instead, maintained component metadata now contains compositional descriptors. A descriptor profile requires two to four author-defined groups of short alternatives. Maintainers intend each group to represent a separate shape, function or context fact, but the runtime can validate only distinct spans, not semantic independence: for example, air movement combined with rotating blades. All groups must match distinct positive word spans within sixteen words and one lexical segment. Different synonyms for one group do not count as another required fact. Profile alternatives are facts about components, not stored request templates.

A narrow English inflection fold handles regular forms such as rotate/rotating/rotated only in descriptor evidence. Existing ID/alias semantics and the earlier keyword/category paths are preserved. Descriptor scores are 4 + group count / 4, below complete names and above loose keyword pairs. They are heuristics, not calibrated confidence. Generic “rather than” and “remove” exclusions join the earlier limited lexical exclusions.

Commas, punctuation, several spatial separators and and/or followed by a determiner split descriptor evidence. This prevents some cross-object combinations but is not a parser: ambiguous coordination, possessive relations, contextual mentions, indirect negation and non-English paraphrases remain unresolved. Conservative boundaries can also miss valid descriptions split by a comma. Descriptor matching can select a part mentioned only as context; that is a failure, not useful recall.

Index construction validates the optional profile shape and caches repeated metadata. Each search shares complete phrase-occurrence lists, rejects incomplete group sets before expanding evidence, and caches matches for identical observed group evidence. A positional/group-mask interval algorithm enforces distinct spans and the sixteen-word limit without restarting a search at every occurrence. Search-local caches cannot carry request text into later searches. These are bounded CPU/data operations on maintained JSON, never code from a model.

The existing limits remain: 10,000 cards; 2,048 UTF-8 bytes per card; 512 JavaScript string code units and 32 distinct normalized terms per query; four cards and 4,096 UTF-8 bytes per complete response. Whole cards are omitted when they do not fit. Output limits do not imply constant-time work. Extra metadata increases catalogue and response sizes. Ordinary primitives remain the fallback.

## Independent V4 evaluation

A separate author received only the public semantics of the 21 families and the label schema. It saw no retrieval implementation, discovery vocabulary, earlier corpus, tests or results, and executed no retrieval. It independently produced 64 English smoke requests: 30 indirect, 18 absent-category, six mixed, five direct and five negation cases. One negation case also has no relevant family, making **19 absent cases** by the evaluator's definition. These are AI-authored challenge judgments, not human labels, real traffic, representative coverage or population accuracy. The entirely English set establishes no multilingual improvement.

The corpus was frozen independently. Code review then found and corrected cross-object evidence and repeated-word time/memory problems before the implementation was frozen. Only after that freeze was V4 first read or scored. No retrieval/card source or label changes followed exposure. Its original LF SHA-256 is `1d9f157bf31f3e3e09afcf275c80bda20019231c7fb01eb27c5147ebdf12bbb8`. It is now public regression material, not a future holdout.

Baseline: public PR27 `815ba7fbb74ae818b7a200ab7a6016cc827034ab`, exact tree `ceb48c48ed62ae2cf16d38bd91d8b12a63681f35`. Candidate sources frozen before exposure:

- Retriever SHA-256: `82f18f789d1bc7379d3344379703b2d1d6ab68c822504f8b2f1b554bb998272a`.
- Card source SHA-256: `906f0a6da9ab1b021c64e0a18d2ade03ef060c4034d4b273d94f85fc381ac812`.
- Unchanged evaluator SHA-256: `ea412df84308659dd1c1ce2436710738f94bd0d267f168d280d5fa1774ce4404`.

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Indirect requests with any relevant card | 22/30 | 26/30 |
| Indirect requests with relevant first card | 20/30 | 25/30 |
| Indirect labelled families retrieved | 29/39 | 34/39 |
| Indirect relevant / all returned cards | 29/37 (78.4%) | 34/45 (75.6%) |
| All positive requests with any relevant card | 37/45 | 41/45 |
| All positive requests with relevant first card | 34/45 | 39/45 |
| All labelled families retrieved | 55/65 | 60/65 |
| Relevant / all returned cards | 55/69 (79.7%) | 60/77 (77.9%) |
| Correct empty responses on absent cases | 15/19 | 15/19 |
| Empty positive responses | 7 | 4 |
| Search errors / budget violations | 0/0 | 0/0 |
| Largest complete response, UTF-8 bytes | 2,268 | 2,872 |

The direct controls retrieve 14/14 labelled families and mixed requests 8/8 on both sides. Those tiny controls do not prove broad regression safety. No case requests more than four labelled families, so the count cap does not explain this set's missing families.

### Failures retained

- The candidate misses descriptions of the computing chip, parallel exposed posts, a light-up instrument readout and the shell around a gearbox. A multi-part readout/control request still omits the screen. Unseen words and fact combinations remain a limitation.
- It newly returns a piston for an engine-block description, a connecting-link description and a crankshaft description. Those contextual parts raise false positives from 14 to 17 overall. In the connecting-link case, the extra piston also moves the intended part out of first place. A higher aggregate top-1 score does not erase that regression.
- All four prior absent-case mistakes remain: fabric cinema screen, a flower bud compared with a button, an unsupported butterfly valve and a socket wrench. The returned poppet valve is not the requested butterfly mechanism. The fallback sentence accompanying these wrong cards is not an abstention.
- A title mentioning camshaft still distracts retrieval when the requested drawing is only a coolant conduit. The system does not resolve depicted-object roles reliably.

All 64 requests, labels/rationales, baseline and candidate results, missing/unexpected IDs, exceptions and byte counts are committed. No failed row was removed and no labels were changed to improve metrics.

## Earlier development sets

The original V1, V2 and V3 sets were already exposed during earlier work and are development/regression evidence here. Against the same current PR27 baseline:

| Set | Labelled families, baseline → candidate | Relevant / all returned, baseline → candidate | Correct absent cases |
| --- | --- | --- | --- |
| V1 | 37/41 → 38/41 | 37/41 → 38/43 | 8/8 unchanged |
| V2 | 71/110 → 72/110 | 71/78 → 72/80 | 5/8 unchanged |
| V3 | 64/81 → 66/81 | 64/78 → 66/77 | 4/8 unchanged |

V2 retains the existing over-term-limit request as a visible error in both selectors. Broader sets may request more than four families. These results must not be combined with V4 as one tuning-independent accuracy estimate. The previous selection results and historical measurements are preserved unchanged.

## Local timing and scale

One Node 24.22.1 Linux x64 / AMD EPYC 9V74 run measured 21-card construction at **7.68 ms** and pooled warm lookup plus JSON encoding over V4 at p50 **0.050 ms**, p95 **0.143 ms**, with 20 warmups and 100 samples per query. Imports, file reads, inference and rendering are excluded.

The extended scale runner uses the same 21 cards repeatedly, not 10,000 useful distinct components. One 10,000-card run measured construction at **540.65 ms** and a 6,748,118-byte catalogue. Search-only timings with 20 warmups/100 samples were:

- Broad category: p50 2.81 ms, p95 4.56 ms; response 3,194 bytes.
- Indirect description: p50 0.31 ms, p95 0.60 ms; response 3,277 bytes.
- Fifteen repetitions of that description: p50 0.97 ms, p95 1.38 ms; response 3,277 bytes.

These vary with machine/load and workload. The response contains descriptors too, so appending it to today's prompt adds bytes; the existing guide plus lean schema remains 49,581 bytes. No token saving is established.

Independent stress review also covered 10,000 **different descriptor profiles** sharing repeated query evidence. Missing-tail and late-complete cases measured 44.9 ms and 60.8 ms search, with approximately 71 MB and 107 MB process-wide heap observed sequentially in one review process. These are not isolated, incremental or peak-allocation measures. These are single diagnostic observations, not percentile guarantees or upper bounds. They explicitly show that the simple repeated-card benchmark is not a worst case. The pre-correction implementations took seconds or allocated hundreds of MB at only 1,000 profiles; failing subprocess regressions preceded the fixes.

One fresh-process native 2D fixture with 10,000 synthetic cards reached catalogue readiness in **545.34 ms** and first qualifying offscreen paint receipt in **672.77 ms**. Baseline and invalid-action marker counts were zero, and the valid marker arrived before the complete step. Catalogue results do not alter the hand-written marker. This is not a model-generated answer, useful generated object, physical-display observation or cold-disk result. The live three-second target verdict remains null.

## Reproduction and verification

```sh
node scripts/prototypes/evaluate-catalogue.ts --corpus independent-v4
node scripts/prototypes/benchmark-catalogue.ts
node scripts/prototypes/benchmark-first-visual.ts --entries 10000
node --test test/component-catalogue.test.ts test/catalogue-selection.test.ts test/catalogue-indirect.test.ts test/catalogue-indirect-oracle.test.ts test/catalogue-relevance.test.ts test/first-visual-native.test.ts test/first-visual-probe.test.ts
npm run typecheck
npm test
npm run build
```

`catalogue-indirect-results.json` contains complete results for all four corpora, source/card/evaluator/corpus hashes, the source-freeze time and the complete local timing/scale/first-paint observations. The CLI recomputes the candidate results; its hashes describe exact checkout bytes, including line endings. Frozen historical hashes use LF bytes. Compare byte representations before asserting identity, as explained in catalogue-selection.md. To reproduce the baseline, check out the exact public baseline commit and use its unchanged `createCatalogue(partCards)` with the same corpus files and unchanged evaluator.

Final local verification: 54 combined catalogue/native-fixture checks pass; the full portable suite has 1,387 tests, 1,374 passed and 13 skipped, with zero failures. The prior PR27 source passes 1,363 with the same skips. Typecheck, production build and whitespace checks pass. Loopback fixtures use process-only NO_PROXY/no_proxy entries for 127.0.0.2. These Linux checks do not replace hosted Windows verification for the published successor.

Independent code review found no remaining blocker for this offline scope after the time/memory and coordination corrections. Its positional matcher checks included 2,000 randomized single-profile and 1,000 randomized three-card comparisons against an exhaustive interval oracle. The 1,000-query oracle is committed as test/catalogue-indirect-oracle.test.ts. These checks establish the defined lexical behavior, not semantic relevance.

Fresh main remains bda682acd8b5fd2e0f2efef8d4caac864ecef40e. The 12 changed paths do not overlap other open PR16–26 paths; this does not establish combined-tree behavioral acceptance.

Keep PR27 draft and unmerged. Further work needs a better way to distinguish requested objects from contextual parts, broader fresh human judgments with explicit precision/abstention acceptance criteria, and then paired authorised model/rendered-output trials. Do not keep adding aliases to these now-exposed examples and call the result independently validated.
