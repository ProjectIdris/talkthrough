# Real models

Talkthrough's MIT licence covers its code only. The models are separate works under their own licences, named in [assets/CREDITS.md](../assets/CREDITS.md), and are excluded from the MIT grant.

Talkthrough can draw a thing as it really is (a heart, a brain, and a handful of everyday objects) instead of building it from shapes. A model is a **manifest** in `assets/models/<id>.json` plus its source files, fetched once from the publisher and never stored in git. The finished file of a model that releases carry (CC0, pinned by hash) is committed; a model held back from releases is not.

## Getting the files

```
npm run assets        # fetch what the manifests name, build assets/built/*.glb, check the generated files
```

The fetch reads only the files the manifests name, by byte range out of the source archive, and checks each against the size and sha256 the manifest pins. It is the only time anything is downloaded; the app itself never fetches a model. `assets/cache/` is ignored by git, and so is `assets/built/` except for the models releases carry: their `.glb` files are committed as plain binaries (`.gitattributes` marks `*.glb` binary; no LFS), listed by name in `.gitignore`, so a fresh clone can build and pack a release without fetching anything. A test checks that exactly the carried models' files are tracked, that the held ones' are ignored, and that nothing of a machine or of ours is in what is committed. `npm run build` copies the built files into `dist/models/` (without them it warns, and a scene that uses one of those models shows the stage without it and says so); `npm run dist` builds a release (`npm run build -- --release`) and refuses to pack without the files of the models it carries.

## Adding a model

1. Write `assets/models/<id>.json`: the source and its version, the licence (`CC0-1.0` or `CC-BY-4.0` only) with its version and the evidence for it, the credit line (required for CC BY), what was changed, `orient` (which source axis is up and which faces front), `scale.unitsToMetres`, the `files` (archive entries) and the named `parts`, each naming its files and how well the source backs it (`atlas`, `grouped`, `approximate`).
2. `npm run assets:pin` fetches, builds and records the hashes, then writes `src/scene/model-catalogue.ts` and `assets/CREDITS.md`. Commit the manifest and those two generated files; a test fails when they drift from the manifests. For a model releases carry, also commit its built file (`git add -f` is not needed: add `!assets/built/<id>.glb` to `.gitignore`). A model that is not cleared for a release says so in `release.blocked` and its file stays out of git; releases leave it out of the catalogue, the files and the credits.
3. A scene uses it with `{ "op": "add", "shape": "model", "id": "h", "model": "heart", "size": 8 }`; its parts are then `h.left-ventricle` and so on, for `pin`, `highlight`, `style`, `explode` and `cut`.

## What a model says about how it works

A model is the outside: it shows how a thing looks and where its parts are, not its inside. So a manifest may carry `works`, the working mechanism that explains it, as data: `how` (a sentence or two, at most 400 characters), `assemblies` (ready assemblies from the scene language's rows to build beside it, each with its role), `kit` (kit parts for what has no assembly) and `motion` (how the model's own named parts move: a part, what it does, and one `spin` or `loop` action). `npm run assets` checks it (every action key is one the scene language has, a `by` driver is another part of the same model) and writes it into `src/scene/model-catalogue.ts`; a test checks that every assembly, kit part and part it names exists.

When a question is about a thing that has such a model, the how-it-works hint names that data: build the mechanism large and moving, with the real model standing beside it at its own size so the thing is recognised, and move the model's own parts as the data says. A part of a model may drive another with `by` (the minute hand follows the second hand at a sixtieth, the hour hand the minute hand at a twelfth).

## Textured objects (glTF)

A model whose manifest says `"format": "gltf"` is an artist's own glTF or GLB, passed through: its geometry, UV coordinates, materials and images are copied unchanged into one GLB, and the page draws them with their textures. The manifest lists every file with its address (https, on the publisher's own host: Poly Haven or the Smithsonian's 3D server; any other host is a code change, not a manifest edit), its bytes and sha256, the date the files were fetched, the authors, and the licence as the publisher's page states it (`licence.statement`, `licence.statedOn`). `npm run assets` fetches into a folder of the model's own (`source.cacheFolder`), checks each file against its pin and refuses a file the glTF points at that the manifest does not name. The only changes the build makes are a root that puts the model on the scene's axes, in metres and centred (`orient`, `scale.unitsToMetres`) and a `part` tag on the nodes the manifest names as parts (by node name, or `#3` for the node at an index when the source's nodes have no names). A file that needs Draco, meshopt or KTX2, has skins, animations or morph targets, or holds a mesh in no part, is refused.

Drawing: the colour map on every tier; the normal, roughness, metal and occlusion maps on mid and high; glass (transmission or blended transparency) as the overlay's glass. A texture larger than its tier keeps (1024 px low, 2048 mid and high) is reduced when the model loads. The page's policy allows `blob:` for connections, which is how the loader reads the images inside a model file; a blob is only ever something the page made.

A model with one part (`parts.length === 1`, key `whole`) is one object, such as a scan: it is labelled as a whole (`pin` or `highlight` its id), part names on it are refused with a note, `explode` and `cut` on it are dropped, and the Explode and Cut buttons are not offered for it alone. A textured model's parts are not watertight solids, so `cut` shows the inside of the shell, not a cap.

A part that turns (a clock hand) names its **hub** in the manifest: `"hub": "node"` takes the origin of its source node (the boss it is mounted on), or `"hub": [x, y, z]` gives a point in metres from the model's middle. The build records it, and a `spin`, `loop` or hinge on the part that names no pivot of its own turns it about that point, not about the middle of its box (which for a thin hand is somewhere along the hand). A part may also name `"explode": [x, y, z]` (metres): where it goes when the model is exploded, so a hand lifts straight off its face instead of flying outward across the case.

## Releases

A manifest can hold its model back (`release: { blocked: true, why }`): the model is for local use. A release build leaves held models out: they are not in the catalogue the app is built with (so the guide, the schema and the validator never offer them and answers use shapes), their files and credits are not shipped, and the build says what it left out. The two anatomy models are held as a prototype until they are cleared for a release; the CC0 objects are carried, except the Morse-Vail key, held as "licence unverified" (its CC0 was seen only in a search snippet, the record page returned 403) until the record is read. Where a source's files still carry an older licence notice than its current grant, the manifest records the older notice (`licence.earlierNotice`) and the credits file keeps it.

## Credits

`assets/CREDITS.md` lists every model, its source, licence, credit and changes; the tray's "Save the 3D model credits…" saves it. A drawing that shows a CC BY model carries its credit line at the foot of the stage.
