# Real models

Talkthrough's MIT licence covers its code only. The models are separate works under their own licences, named in [assets/CREDITS.md](../assets/CREDITS.md), and are excluded from the MIT grant.

Talkthrough can draw a thing as it really is (today a human heart and a brain) instead of building it from shapes. A model is a **manifest** in `assets/models/<id>.json` plus files that are fetched once and never stored in git.

## Getting the files

```
npm run assets        # fetch what the manifests name, build assets/built/*.glb, check the generated files
```

The fetch reads only the files the manifests name, by byte range out of the source archive, and checks each against the size and sha256 the manifest pins. It is the only time anything is downloaded; the app itself never fetches a model. `assets/cache/` and `assets/built/` are ignored by git. `npm run build` copies the built files into `dist/models/` (without them it warns, and a scene that uses one of those models shows the stage without it and says so); `npm run dist` builds a release (`npm run build -- --release`) and refuses to pack without the files of the models it carries.

## Adding a model

1. Write `assets/models/<id>.json`: the source and its version, the licence (`CC0-1.0` or `CC-BY-4.0` only) with its version and the evidence for it, the credit line (required for CC BY), what was changed, `orient` (which source axis is up and which faces front), `scale.unitsToMetres`, the `files` (archive entries) and the named `parts`, each naming its files and how well the source backs it (`atlas`, `grouped`, `approximate`).
2. `npm run assets:pin` fetches, builds and records the hashes, then writes `src/scene/model-catalogue.ts` and `assets/CREDITS.md`. Commit the manifest and those two generated files; a test fails when they drift from the manifests.
3. A scene uses it with `{ "op": "add", "shape": "model", "id": "h", "model": "heart", "size": 8 }`; its parts are then `h.left-ventricle` and so on, for `pin`, `highlight`, `style`, `explode` and `cut`.

## Releases

A manifest can hold its model back (`release: { blocked: true, why }`): the model is for local use. A release build leaves held models out: they are not in the catalogue the app is built with (so the guide, the schema and the validator never offer them and answers use shapes), their files and credits are not shipped, and the build says what it left out. The two anatomy models are held as a prototype until they are cleared for a release. Where a source's files still carry an older licence notice than its current grant, the manifest records the older notice (`licence.earlierNotice`) and the credits file keeps it.

## Credits

`assets/CREDITS.md` lists every model, its source, licence, credit and changes; the tray's "Save the 3D model credits…" saves it. A drawing that shows a CC BY model carries its credit line at the foot of the stage.
