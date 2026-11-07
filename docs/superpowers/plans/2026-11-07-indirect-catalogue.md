# Indirect Catalogue Implementation Plan

> For agentic workers: use the native executing-plans workflow for this scoped continuation.

**Goal:** Add and measure bounded compositional description matching without production integration.
**Architecture:** Optional descriptor profiles contain mandatory independent evidence groups. Cache normalized alternatives at index construction; match positive occurrences with bounded locality and narrow inflection folding. Retain named and category paths.
**Tech stack:** Existing Node 24 TypeScript, no new dependencies.
**Spec:** ../specs/2026-11-07-indirect-catalogue-design.md

## Global constraints

Keep production untouched, existing caps unchanged, public sources only, no model/network/security/credential changes or merge. New evaluation stays hidden until implementation freeze. User has asked to proceed using best judgment and permits confident draft publication through hearthworksai.

## Review focus

- Different synonyms for one fact must not satisfy multiple required facts.
- Review goal: reduce cross-object evidence and reject clause/exclusion crossings; lexical boundaries cannot establish object roles or guarantee every coordination.
- Morphological folding must not alter ID/alias semantics or turn unrelated short words into matches.
- Malformed descriptor metadata must fail clearly rather than silently changing ranking.
- Responses and construction must remain bounded with 10,000 entries.

## Task 1: Descriptor engine and metadata

- [x] Add generic failing synthetic-card tests for conjunction, synonyms, morphology, locality, exclusion, mutation and bounds.
- [x] Run those tests and record intended failures.
- [x] Add optional descriptor profiles and a keyword-only narrow morphology layer; add shared-word definitions to maintained public cards without whole-query aliases.
- [x] Extend lexical exclusion recognition for rather-than and remove with a failing regression first.
- [x] Rerun focused tests, baseline development corpus and typecheck. Record tradeoffs rather than tuning held-out data.

## Task 2: Independent measurement and review

- [x] Freeze exact retrieval/card bytes and hash them before reading new independent corpus.
- [x] Evaluate unchanged baseline and frozen candidate with unchanged scorer, preserving every result and provenance.
- [x] Obtain independent code/evidence review, apply only independently justified corrections and disclose any post-holdout amendments.
- [x] Run full tests, typecheck, production build, scale timing and optional first-paint fixture. Document local-only and sampling limits.
- [x] Prepare a guarded successor publication manifest; preserve PR27 history and all previous evidence, no merge.
