# Indirect catalogue discovery design

## Intent and boundary

Find existing schematic components when requests describe their shape or function without naming them. Keep this a removable offline experiment over the 21 public families. Production routing, prompt/schema, renderer, validation, dependencies, credentials and network behavior are unchanged. No live-model or general semantic-understanding claim is permitted.

## Diagnosis and approaches

The existing selector needs an exact alias or two literal keyword forms. Inflection and synonyms break that evidence, while any two keywords need not describe the same object. More whole-query aliases would overfit examples. Learned embeddings could cover more paraphrases, but require a separately selected artifact, licensing, deployment and calibration evaluation. This candidate instead uses maintainer-authored **compositional descriptors**: multiple required groups of short alternatives, with bounded local evidence and narrow morphology. The choice is an implementation proposal under the request to proceed using best judgment, not a product acceptance decision.

Descriptors are reusable facts about a component, not complete example requests. Each descriptor requires all of its groups, on distinct positive occurrences within one clause and a limited window. A group is intended as alternative word/phrase evidence for one fact. Runtime checks distinct spans, not semantic independence; authors are responsible for meaningful groups. A synonym does not count as a second fact. Existing aliases and two-keyword admission remain for comparison. Descriptor evidence ranks below exact names and above incidental keyword overlaps; it is not probability. Exclusions apply before evidence combination. Add generic `rather than` and `remove` exclusion scopes, retaining separately positive clauses.

## Requirements

- Keep existing 512-code-unit/32-distinct-term query, 10,000-entry, four-card and 4,096-byte response limits.
- Keep all cards plain JSON, cloned, validated for structural/byte bounds.
- Preserve category discovery, stable ordering, ordinary-primitive fallback and existing named matches.
- Do not add per-question conditions or change any existing corpus labels.
- Freeze the candidate before reading a new independently authored corpus. Once exposed, the corpus is regression evidence. Report misses, extra cards, abstention, errors and every case, not just aggregate hits.
- Record baseline/candidate source and corpus hashes, local construction/query timing and limits. Publication remains draft and unmerged.

## Known limitations

This is a finite lexical representation of component semantics, not semantic inference. It cannot reliably resolve relational roles, arbitrary negation, unseen synonyms or arbitrary languages. It may retain wrong homonym suggestions. A successful small independent smoke set cannot establish production readiness. Synthetic scale entries repeat existing descriptions and are not useful new components.
