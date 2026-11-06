# Keep the overlay usable without WebGL

## Intent
An unavailable WebGL context must not prevent the overlay IPC, text, speech, or Canvas 2D drawing from starting. Current main creates WebGLRenderer before its ready handshake; a graphics exception aborts all of those independent capabilities.

## Approach
Make the 3D renderer optional. Keep the existing Three.js scene graph and player, but strip unavailable 3D content from the displayed frame before drawing or publishing hit regions. Retain flat diagrams, page marks, text and voice. Show a dismissible warning while a scene asks for unavailable 3D, underneath higher-priority application notices. Do not describe missing models as rendered in capture metadata.

Forcing software graphics or changing browser security settings is excluded. Replacing the renderer with a fake renderer would conceal missing graphics and is excluded. Reimplementing 3D in Canvas 2D is unnecessary scope. Automatic recovery after a later GPU failure is not part of this startup repair.

## Constraints and verification
Keep schemas, IPC compatibility, voice preferences and providers unchanged. No dependencies, GPU flags, or security changes. No merge or deployment. Start from upstream main's exact tree. Test the real bundled startup with WebGL unavailable, scene playback, visible 2D output, text/voice routing, warning precedence and absent model targets. Run portable tests, typecheck and build, seek an independent review and a real cloud desktop smoke test. Hardware 3D acceptance remains separate and must not be claimed.
