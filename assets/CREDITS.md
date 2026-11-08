# Credits for the real models

Talkthrough itself is MIT licensed. The models it can show are separate works under their own licences, listed here, and are not part of the MIT grant.
This file is generated from `assets/models/*.json` (`npm run assets:index`) and is shipped with the app.

## Human brain (`brain`)

- Source: BodyParts3D, https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ (4.0, polygon reduction 99 percent (archive of 2013-05-22; README and licence of 2025-02-27))
- Licence: CC BY 4.0, version 4.0 International: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- Credit: BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/)
- Changes: Files converted from OBJ to glTF, millimetres to metres, axes turned to y up and the front toward the viewer, parts recentred on themselves; left and right meshes and gyri are merged into one named part. Duplicate vertices were welded and smooth normals computed; no shape was edited.
- Note: The database licence page (updated 2025-02-27) and README name CC BY 4.0 International and the credit line given here. The OBJ files in the 2013 archive still carry an older header naming CC Attribution-Share Alike 2.1 Japan; the current statement of the licensor is followed here, and the files are converted without their header.
- Built file: brain.glb, 8358176 bytes, sha256 0d353d478830dff8e6fac252909c2e236229932336e63eb8a7665179b2f914d1
- Parts: Frontal lobe (grouped); Parietal lobe (grouped); Temporal lobe (grouped); Occipital lobe (atlas); Insula (atlas); Cingulate gyrus (atlas); Cerebellum (atlas); Pons (atlas); Medulla oblongata (atlas); Midbrain (atlas); Thalamus (atlas); Hypothalamus (atlas); Hippocampus (atlas); Amygdala (atlas); Caudate nucleus (atlas); Globus pallidus (atlas); Corpus callosum (atlas); Cerebral white matter (atlas); Lateral ventricles (atlas); Pituitary gland (atlas)
- Limit: The atlas models the main gyri, not every fold: the lobes are made of the named gyri it has, so small regions (the precuneus, the posterior superior temporal gyrus) are not separate and may show as gaps.

## Human heart (`heart`)

- Source: BodyParts3D, https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ (4.0, polygon reduction 99 percent (archive of 2013-05-22; README and licence of 2025-02-27))
- Licence: CC BY 4.0, version 4.0 International: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- Credit: BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/)
- Changes: Files converted from OBJ to glTF, millimetres to metres, axes turned to y up and the front toward the viewer, parts recentred on themselves; a file may be merged with others into one named part. Duplicate vertices were welded and smooth normals computed; no shape was edited.
- Note: The database licence page (updated 2025-02-27) and README name CC BY 4.0 International and the credit line given here. The OBJ files in the 2013 archive still carry an older header naming CC Attribution-Share Alike 2.1 Japan; the current statement of the licensor is followed here, and the files are converted without their header.
- Built file: heart.glb, 2558152 bytes, sha256 309af9886b9388323beb7e9c933c2b1f2a30b05ba93768eda6c8999b7da20ef1
- Parts: Right atrium (atlas); Wall of the right atrium (atlas); Left atrium (atlas); Wall of the left atrium (atlas); Right ventricle (atlas); Left ventricle (atlas); Mitral valve (grouped); Tricuspid valve (grouped); Aortic valve (grouped); Pulmonary valve (grouped); Papillary muscles (grouped); Ascending aorta (atlas); Arch of the aorta (atlas); Pulmonary trunk (atlas); Superior vena cava (atlas); Left coronary artery and its branches (grouped); Right coronary artery and its branches (grouped); Cardiac veins (grouped)
- Limit: The atlas has no mesh for the ventricular wall or the pericardium: the chambers are drawn as their blood-filled cavities, so a cut shows cavities, valves and vessels, not a wall.
- Limit: The pulmonary veins, the branches of the pulmonary arteries and the inferior vena cava (its mesh runs 24 cm into the abdomen) are not included.
