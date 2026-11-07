# Component discovery relevance check

This is an **offline smoke evaluation**, not a production retrieval feature. The initial run evaluated PR27's baseline 21-card lexical catalogue on 36 original questions with explicit relevance labels. The app, model tools, providers, prompt/schema, validator and renderer remain unchanged. It adds no component geometry or assembly feature.

## Why evaluate before connecting it

Fast lookup does not establish useful selection. The original retriever matched independent ASCII words without understanding intent, negation, polysemy or other languages. Ordinary words in a full question can match descriptions even when no existing part is suitable. The fallback sentence is always present, but unrelated cards alongside it are **not** a successful abstention.

The first run found a relevant card in 22 of 28 positive cases. It also returned four unrelated cards for **all eight cases requiring the ordinary-primitive path**. Do not enable automatic selection or assume that the first card is appropriate on the strength of the timing benchmark. Those results supported keeping discovery offline while improving and independently validating its selection policy. The [selection successor](catalogue-selection.md) now records the current algorithm, fresh validation, trade-offs and unresolved failures; numbers below remain the original baseline.

## Run it

Node 24+, from the repository root:

```sh
node --test test/component-catalogue.test.ts test/catalogue-relevance.test.ts
node scripts/prototypes/evaluate-catalogue.ts
```

The CLI prints JSON to stdout with every request, label rationale, expected/returned/missing/unexpected ID, metric, exception and response size. It also emits aggregate, category and language slices, hashes of the exact corpus bytes, serialized cards, retriever and evaluator, plus local CPU timing. It reads only the selected committed original fixture (`--corpus regression`, `challenge-v2` or `validation-v3`); it does not collect screens, recordings, questions or model output. Redirect stdout to a local file if desired. Exit success means the evaluation ran, **not** that retrieval meets a production quality threshold. No quality threshold has been established.

## Corpus and label limits

`scripts/prototypes/catalogue-requests.json` contains 36 original requests: eight direct, eight paraphrased, eight multi-part, four negated and eight absent-family cases. Four paraphrases are in Spanish, French, German and Japanese. All 21 public built-in families are represented in the positive labels.

A separate author read the public part descriptions and scene spec/guide, but did not read the retrieval implementation, tests or results and did not execute retrieval. Labels mean a family is directly useful for an explicitly depicted object, not just mentioned, excluded or geometrically similar. Multiple instances and variants count once per family. Contextual engine endpoints, for example, are not relevant when the request asks to isolate only their connecting link. The labels do not mean that a component fully satisfies the requested appearance, dimensions or motion.

These are **AI-authored challenge labels**, not human judgments, real user traffic, representative coverage or statistically reliable population estimates. The corpus deliberately includes difficult failures. There is only one request in each non-English language; no language-wide conclusion follows. It was not used to tune the original baseline. It was subsequently used as development/regression evidence for the selection successor, which required fresh independent corpora. Once first scored, it is public regression material and must not be called a future held-out set. Fix genuine label errors with an explained revision, not to improve a score; collect a fresh independent set before evaluating tuned retrieval.

## Metrics

- **Hit rate:** positive requests with at least one relevant returned family / positive requests. A multi-part request can get a hit while still missing other required parts.
- **Top-1 accuracy:** positive requests whose first returned family is relevant / positive requests.
- **MRR:** average reciprocal rank of the first relevant card over positive requests, zero when none is returned.
- **Macro recall:** average per-positive-request fraction of labelled families found.
- **Micro recall:** total relevant retrieved families / total labelled families.
- **Micro precision:** total relevant retrieved families / **all returned cards**, including false positives on absent requests.
- **Abstention accuracy:** successful empty responses / absent requests. A search exception is not a correct fallback. False-positive cases count absent requests returning any cards.

Empty denominators are `null`, not a perfect score. Errors remain visible and positive errors count as misses. Duplicate or unknown relevance/result IDs, missing labels and malformed response envelopes fail the evaluator rather than inflate metrics. Response checks cover the cards array, IDs, fallback text and truncated flag, not the complete contents of each card. These are family-ID relevance metrics, not payload validity or semantic correctness of card descriptions/examples; the existing catalogue tests validate its maintained examples separately. Byte/card-budget checks are separate from relevance; a small response can be entirely wrong. The scorer is reusable with another bounded retriever, so future comparisons can keep the labels and metric definitions fixed.

## Observed unchanged baseline

Base: PR27 `9454d374dc4b607271a8b9ef1770078795dfa816`; upstream main remained `bda682acd8b5fd2e0f2efef8d4caac864ecef40e` when checked. The retriever and seed cards are unchanged.

| Measure | Result |
| --- | ---: |
| Positive requests with any relevant card | 22 / 28 (78.6%) |
| Positive requests with relevant first card | 20 / 28 (71.4%) |
| Mean reciprocal rank | 0.7411 |
| Macro recall | 78.6% |
| Micro recall | 35 / 41 (85.4%) |
| Micro precision, including absent requests | 35 / 132 (26.5%) |
| Correct absent-request abstentions | 0 / 8 |
| Search errors / budget violations | 0 / 0 |
| Largest complete response | 1,742 UTF-8 bytes |

Direct and multi-part requests found all labelled families. Paraphrases found a relevant family in 2/8 cases, including 2/4 English paraphrases and 0/4 non-English requests. Negated requests included the intended family in 4/4 cases but ranked it first in only 2/4, while also returning excluded families. These tiny slices diagnose examples, not general accuracy.

Examples: the sea **port**, seasonal **spring**, and anatomical **elbow** requests return literal mechanical/electronic names despite needing general geometry. A request for only a camera lens, excluding screen and button, still returns both excluded families. A plunger inside an engine and an offset-throw engine shaft both miss the intended family. See the complete JSON output for all 36 results rather than selecting only successful demonstrations.

On Node v24.22.1 / Linux x64 / AMD EPYC 9V74, one run measured 21-card in-memory index construction at **2.15 ms**. Pooled warm search plus response JSON encoding across the 36 queries, with 20 warmups and 100 samples per query, measured p50 **0.034 ms**, p95 **0.047 ms**. This excludes imports, fixture loading, provider/model work and rendering; it is not an end-to-end or startup measurement. Future machines/load can differ. Errors are retained in quality scoring and excluded, by explicit ID, from timing samples. The existing 10,000 synthetic-card scale benchmark measures a different workload.

No live model, model token count, actual rendered quality, physical display or improvement to the roughly three-second first-stream target is measured. The JSON target verdict is deliberately null.

## Before production use

1. Improve request-to-family relevance and explicit abstention without expanding provider privileges. Consider curated multilingual aliases, better lexical selection or locally available semantic retrieval, with the ordinary-primitive path always available. Do not simply append every matched card.
2. Retain this corpus as regression evidence and obtain fresh independent labels for tuning-independent comparison. Review disagreements, distractors, missing components and errors as well as hit rate. Choose thresholds with the product owner from realistic use, not after seeing a single small benchmark.
3. Use an opt-in application-side context builder only after that gate. Keep selection bounded, construction outside the request-critical path where possible, no model tools/file access, unchanged validation and fallback. Preserve the required guide/schema; card bytes are additional prompt content unless a separate prompt design is validated.
4. Run paired requests through the same authorized model and renderer, with matching source context/settings/budgets. Measure time to the first **useful** rendered object, total answer time, token cost, validation/retry rate and visual suitability. Include selection failures. Local lexical timings do not establish the live target.
