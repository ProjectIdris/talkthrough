# Native visual checks implementation plan

**Goal:** Add reproducible, offline 3D renderer smoke captures with explicit diagnostic failures and a human inspection sheet.

**Architecture:** A standalone runner bundles the current production overlay and preload into a private temporary directory. A sandboxed Electron worker seeks validated, hand-written 3D-only fixtures, captures their actual composited output and records conservative pixel diagnostics. Unsupported WebGL remains a non-pass. No production renderer, adapter, schema or dependency changes.

**Tech stack:** Node 24, TypeScript, Electron, esbuild, existing scene validation.

## Steps

- [x] Write and observe failing tests for blank, transparent, dark, tiny, clipped, off-centre and malformed bitmap inputs. Implement the pixel analyser and report status rules.
- [x] Write and observe failing tests for fixtures accepted unchanged by the real validator and for safe HTML inspection output. Add three fixture families and two views per family.
- [x] Add native Electron captures with profile guard, denied network/permissions/navigation, bounded timeouts and baseline/capture artifacts. Record real renderer availability, source hashes and explicit acceptance limitations.
- [x] Run focused tests, full suite, typecheck, production build and native harness. Treat absent WebGL as unsupported, not visual success. Obtain independent review before publication.

## Review focus

The analyser must not count hidden transparent RGB. UI text must not count as 3D. Missing or failed renderer startup cannot produce a pass. Reports must retain artifacts when checks fail. Passing smoke checks do not establish aesthetic quality, semantic completeness or physical desktop acceptance.
