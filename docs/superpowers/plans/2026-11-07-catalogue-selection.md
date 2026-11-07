# Bounded catalogue selection implementation plan

**Goal:** Improve the offline 21-card candidate selector while preserving honest ordinary-primitive fallback, bounded responses and no live integration.

**Architecture:** Replace independent description-word admission with positive, normalized ID/alias phrases and a separately maintained content-word field. Separate explicit category browsing from incidental domain words; keep specific matches ahead of category candidates. Apply small lexical exclusion scopes and maintained local sense conflicts, without claiming semantic understanding. Expand curated names and descriptive phrases across all public families, including a small multilingual vocabulary. No model, embedding dependency, credentials or production source changes.

**Authority and scope:** The user asked to continue by best judgment and offered review through hearthworksai PRs. This continues draft PR27 at public head bdba58dc144f6e13918088d779990f81cab222ae (tree 1fe78dda7d072e688fd3021232e70f40065bd26b). Public main is bda682acd8b5fd2e0f2efef8d4caac864ecef40e. No merge.

## Steps

- [x] Reproduce the unchanged corpus and baseline tests. Author a fresh independent held-out set without revealing its questions to the implementer until the retrieval policy is frozen.
- [x] Add failing behavioral regressions for incidental summary words, atomic alias phrases, positive versus excluded mentions, Unicode names, exact IDs, category browsing and mixed supported/unsupported requests. Add budget, duplicate-query, order and mutation checks where the new fields affect them.
- [x] Implement bounded indexing and lexical matching in scripts/prototypes/catalogue-retrieval.ts, with curated metadata in catalogue-parts.ts. Preserve existing result envelope, entry/card/query/count/byte limits and ordinary validated examples.
- [x] Freeze the candidate before reading the independent corpus; score unchanged and candidate selectors with the same labels. Retain every failure and broad-query cap loss. Do not tune on held-out results or call the existing 36 requests held out.
- [x] Update the offline evaluation CLI and docs with exact provenance, raw quality results and local CPU diagnostics kept separate. No live latency/token/visual claims.
- [x] Run full tests, typecheck/build, 10,000 synthetic scale and native first-paint regression where available. Independent review and adversarial probes. Prepare a guarded successor manifest for the existing hearthworksai publisher only if ready; keep draft/unmerged.

## Review focus

False positives from common descriptive words; compound aliases incorrectly split; negative scope swallowing later positive objects; unsupported objects suppressing useful mixed-query cards; category browsing accidentally disappearing; Unicode normalization or matching expanding unbounded work; fixed responses dominated by extra metadata. Curated lexical aliases cannot solve arbitrary paraphrase, context, translation or negation. Expose those limitations rather than fitting a small set.

## Outcome

The strict phrase-only attempt was rejected on a new 48-case set because recall fell. That set became development material. A second independent 48-case set was created blind to all retrieval work and scored only after the successor was frozen. Useful family recall increased from 59/81 to 64/81 and precision from 59/180 to 64/78, while English paraphrase recall regressed and only 4/8 absent cases abstained. Independent review corrected generic exclusion, prefix and coordinated-object bugs with failing regressions; the entire final validation output stayed unchanged. Full evidence and remaining limitations are in docs/catalogue-selection.md. No production routing or merge. Publication is prepared for a guarded update through the existing hearthworksai publisher.
