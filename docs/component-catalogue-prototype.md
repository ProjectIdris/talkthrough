# Bounded component discovery experiment

**Offline, removable prototype. Not wired into Talkthrough.** This tests one piece of a larger-library design: keep component knowledge on the application side and retrieve a small number of relevant cards rather than listing every component in each model prompt.

The seed catalogue describes the **21 existing public part families** on main `bda682a`. It adds no geometry or assemblies. `scripts/prototypes/catalogue-parts.ts` derives numeric parameter limits from the real scene spec and provides one ordinary example action per family. `catalogue-retrieval.ts` builds a local lexical index. Only trusted, maintainer-authored cards belong in this index; it is not a loader or validator for untrusted plugin manifests.

## Try it

From the repository root with Node 24+:

```sh
node --test test/component-catalogue.test.ts
node scripts/prototypes/benchmark-catalogue.ts
node --input-type=module -e "import { createCatalogue } from './scripts/prototypes/catalogue-retrieval.ts'; import { partCards } from './scripts/prototypes/catalogue-parts.ts'; console.log(JSON.stringify(createCatalogue(partCards).search('usb-c'), null, 2));"
```

The prototype API is `createCatalogue(partCards).search(query, options)`. Construct the index once, then reuse it. Search returns `{ cards, truncated, fallback }`; each card includes its stable catalogue ID, description, search aliases, parameter descriptions and an ordinary scene action example. Ranking uses unique lowercase ASCII words with ID weight 8, alias weight 4 and description weight 1, summed for matching words. Ties sort by catalogue ID, independently of input order. This is simple lexical matching, not semantic retrieval or evidence that a component fits a particular engineering task.

## Finite budgets

- At most 10,000 indexed entries, each at most 2,048 UTF-8 bytes of serialized JSON, with unique catalogue IDs. Cards must be plain JSON data: finite numbers, strings, booleans, null, dense arrays and plain objects. A traversal also caps structure at 1,024 values and 16 nested levels. Non-JSON containers, accessors and function values are refused before serialization. This is a guard for maintained data, not a sandbox for arbitrary JavaScript objects or Proxies.
- Query: at most 512 JavaScript string code units and 32 distinct ASCII word tokens. Over-limit input is rejected, not silently cut down.
- A search returns at most four cards and **4,096 UTF-8 bytes for the complete minified JSON response**, including the fallback text. A caller can request smaller bounds: one through four cards and 512 through 4,096 bytes.
- Cards are never cut mid-field. A matching card that does not fit is skipped; smaller lower-ranked cards can fill the remaining space. `truncated` means matching cards were omitted by either budget. A full-card omission can yield zero cards despite a match.
- Empty, unsupported-language-only and unmatched queries return no cards and the same ordinary-primitive fallback. Query text is not copied into the response. This does not make questions with overlapping malicious words impossible to match: matching is not instruction following.
- Source cards and returned cards are independently cloned so caller mutation cannot change subsequent ranking or results.

The index has bounded input size, but not constant lookup cost: a broad term can match all entries, and ranking sorts all matches. The benchmark measures that cost rather than assuming it is negligible. Initialization is separate from warm lookup.

## Existing actions and editability

Examples are normal `add` / `part` actions, not new recipe syntax. A model would still choose parameters, assign **a unique scene ID instead of the example's `example` ID**, and pass every action through the existing validator. Tests validate all 21 examples unchanged and then target each accepted object with an ordinary `pin` follow-up.

The `n` limits in cards are **validator acceptance bounds**, not exact rendered-count guarantees. Individual renderers can clamp further: crankshaft 1–8, camshaft 1–12, gear 6–120, spring 2–40 and bearing 5–16. The accepted authoring limit for `n` is 1–64, so a gear can only request up to 64 through the validator.

An existing built-in part is addressable as one scene object. Its internal meshes are **not** new independently addressable subparts. This experiment does not expand assemblies, instantiate templates, add scene state, claim partial-output atomicity or solve nested subpart editing. A later assembly design needs stable namespaced child IDs, post-expansion budget validation and deterministic versioned expansion; none of that is enabled here.

No code is evaluated from the query or cards. There is no network, model, embedding, file-loader, provider tool, dynamic import or dependency added. The application, adapter security contract, production guide, schema, scene validation and fallback remain untouched.

## Local measurements

A Node v24.22.1 Linux x64 run on an AMD EPYC 9V74 measured the following, using 20 warmups and 100 timed lookups per query:

| Entries | Data | Index initialization | Broad-query p50 / p95 | Broad response |
| --- | --- | ---: | ---: | ---: |
| 21 | Existing public parts | 1.38 ms | 0.034 / 0.073 ms | 1,578 bytes, 4 cards |
| 1,000 | Synthetic repeats | 29.10 ms | 0.127 / 0.220 ms | 1,452 bytes, 4 cards |
| 10,000 | Synthetic repeats | 194.99 ms | 1.309 / 1.911 ms | 1,455 bytes, 4 cards |

For the 10,000-entry synthetic set, the entire catalogue is 3,366,577 bytes while the returned broad-query response is 1,455 bytes. Exact-ID lookup p95 was 0.0079 ms in that run. This is a local diagnostic, not a performance guarantee; startup, garbage collection, hardware and query composition affect it. Synthetic entries reuse the same 21 descriptions and examples under distinct catalogue IDs. They test scale and response bounds, **not 10,000 useful or distinct components**.

The benchmark also reports the **unchanged** current guide plus lean schema: 49,581 characters / UTF-8 bytes. Selected cards do not replace that contract. If appended to today's prompt, they add prompt bytes. No token reduction, model creation-time improvement, latency benefit, retrieval recall, authored-scene improvement or visual-quality result is established. No model generations or native GPU captures were run.

## Before live use

1. Resolve the ownership and integration of assembly authoring separately; this change deliberately implements discovery only.
2. Design application-side routing without granting tools or file access to existing scene models. Use only the sources already authorized for each request; do not introduce another provider.
3. Define a real relevance corpus with held-out requests, distractors, missing components and multilingual questions. Measure recall, precision and fallback behavior; curate better aliases or choose another retriever if needed.
4. Run paired model trials using the same questions, model settings, source context and time/token budgets. Measure prompt and output tokens, validation failures, retries, time to first useful object and total completion time. Include selection failures, not just successful examples.
5. Establish which core guide/schema instructions must remain. Preserve the ordinary primitive path when a catalogue card is missing, inappropriate or too limited. Inspect rendered answers separately from CPU retrieval timing.

A growing reusable library is promising only if its components are worth choosing and its discovery is reliable. This prototype tests the bounded-discovery mechanism without making the model learn a larger production language.
