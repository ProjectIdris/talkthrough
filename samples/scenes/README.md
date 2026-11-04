# Sample scenes

Hand-written scenes in the scene language (`docs/scene-language.md`) for playing without a model. Each was written against an imagined 16:9 page layout; coordinates are 0 to 1000 across the screenshot. Every file passes the validator unchanged and matches the schema (see `test/scene-validate.test.ts` and `test/scene-schema.test.ts`).

| file | the page it assumes | what it shows |
|---|---|---|
| `bar-chart.json` | a quarterly revenue bar chart on the left (80,180 to 560,620) with empty margin on the right | marks on the chart and its tallest bar; then a 3D bar chart growing bar by bar in time with the narration, a camera orbit at the end to invite dragging |
| `request-flow.json` | a three-box diagram across the page (browser, server, database; 60,240 to 940,470) with room underneath | marks on each box and arrow; a 3D browser, server and database appear in turn while a small packet moves between them (move tweens), turns green on the way back |
| `earth-layers.json` | an article with a cutaway picture on the left (60,130 to 580,470), a paragraph below and empty margin on the right | concentric translucent spheres built from the core outwards while the group turns |
| `earth-layers-followup.json` | the same page, after `earth-layers.json` | a follow-up question that reaches the earlier objects by id: fades layers, focuses and zooms on the core, restores them |
| `escalate.json` | a settings menu top-left (20,40 to 180,100) | a brief partial answer with a mark, plus an `escalate` reason: the app offers a deeper backend |


`samples/pages/` has a 1920x1080 backdrop for each page layout (`bar-chart.svg`, `request-flow.svg`, `earth-layers.svg`) so the marks can be seen landing on the parts they point at; see `docs/overlay.md` for rendering frames over them.

The follow-up must be validated with the same `SceneState` as the first scene; on its own its tweens refer to ids that do not exist and are dropped.

The timings (`at`, `dur`) assume a speaking pace of about 2.5 words a second; a renderer playing without a voice can use that to time each step.
