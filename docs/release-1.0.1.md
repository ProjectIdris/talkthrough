# Talkthrough 1.0.1

A small release on top of [1.0.0](release-1.0.0.md): living things are drawn better. **Windows 11, 64-bit only.** It installs for your own Windows account and needs no administrator rights. If you have 1.0.0, the app's own update check offers this version; the update works as described in the 1.0.0 notes.

**Windows will probably warn you.** The installer is still not code-signed. SmartScreen may say "Windows protected your PC". Choose **More info**, then **Run anyway**, only if you got the installer from this project's releases page. `SHA256SUMS.txt` on the release lists the installer's SHA-256 if you want to check it yourself (`Get-FileHash Talkthrough-Setup-1.0.1.exe`).

You still need a model of your own and a way for it to hear you: your own Claude Code or Codex (signed in by you), an OpenAI API key, or a vision model running on your own computer, and the Windows speech recogniser, a clearer local one you can download, or a speech server you run. See [setup](setup.md).

## What is new

- **Living things are drawn as bodies.** When an answer builds an organ, a hand, an animal, a plant or a fruit from soft shapes, those shapes are drawn as one body with one skin, joined smoothly where they touch, instead of as separate lumps. Cut one open and the cut face shows its layers under the skin.
- **Hands and other jointed parts.** A finger, a toe or a limb written as a tube of skin has a joint at each of its points. A box of flesh (a palm, a sole) is drawn as a rounded pad. Flat parts in one plane run into one another, and bones or stones placed inside a body show in its cut face.
- **A hint for questions about living things.** When your question names one (an organ, an animal, a plant, a fruit) and the app has no real model of it, the model is told, beside your question, how to write its parts so they are drawn this way, with the outline first.
- **Soft cones.** A cone of a soft material (flesh, a plant, food) is drawn rounded, at its full height and width, as the muscle pyramids of a kidney are. A cone of a hard material, such as metal, is unchanged and stays sharp.
- **More of a living answer is kept.** The checks that every answer passes now repair more of what a model gets slightly wrong for a living thing: a point written with two numbers takes the depth of its neighbour, so a vessel is not lost; a vessel or finger that starts inside a living part stays where it was written and goes with the part; and a pulse written as a small amount (a lung breathing by 0.06) is read as a swell and not as a shrink to a speck.

## What is unchanged

Everything else in 1.0.0: the marks, diagrams, guide mode, the seven real models and thirteen mechanisms, materials, updates, first-run help and the privacy notes. The limits listed under "Not in 1.0" in the 1.0.0 notes still stand.

## Uninstalling

*Apps > Installed apps*, or the uninstaller in `%LOCALAPPDATA%\Programs\Talkthrough`. Your settings, pins and records stay in `%APPDATA%\Talkthrough` until you delete that folder.
