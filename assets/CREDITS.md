# Credits for the real models

Talkthrough's own code is MIT licensed. The MIT licence covers that code only: it excludes the models named here, which are separate works under their own licences, listed below with who made them and what was changed.
This file is generated from `assets/models/*.json` (`npm run assets:index`) and is shipped with the app.

## Alarm clock (`alarm-clock`)

- Source: Poly Haven, https://polyhaven.com/a/alarm_clock_01 (Alarm Clock 01, 1k glTF, published 2021-08-13)
- Licence: CC0 1.0 Universal, version 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- As the licence is stated at https://polyhaven.com/license: Our assets are all licensed as CC0. You do not need to give credit.
- Made by: Yann Kervran (rigging), James Ray Cock (modelling and texturing) (no credit is required; named here as a courtesy)
- Fetched on 2026-11-08 from: https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/alarm_clock_01/alarm_clock_01.bin and 4 more files named in the manifest
- Changes: Passed through: geometry, UV coordinates, materials and the 1k textures are the source's own, unchanged. Added: a root that puts the model on the scene's axes, in metres, centred on its own middle, and a tag on each named part.
- Built file: alarm-clock.glb, 3017188 bytes, sha256 783a73ee344b333a8a878d2a02254fe47f1622aef8752a0aaa014c00c63a3096
- Parts (source node): Clock body and glass (alarm_clock_01); Hour hand (houd_hand); Minute hand (minute_hand); Second hand (second_hand)

## Bolt cutters (`bolt-cutters`)

- Source: Poly Haven, https://polyhaven.com/a/bolt_cutters_01 (Bolt Cutters 01, 1k glTF, published 2022-12-02)
- Licence: CC0 1.0 Universal, version 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- As the licence is stated at https://polyhaven.com/license: Our assets are all licensed as CC0. You do not need to give credit.
- Made by: Yann Kervran (rigging), Antanas Kep (modelling and texturing) (no credit is required; named here as a courtesy)
- Fetched on 2026-11-08 from: https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/bolt_cutters_01/bolt_cutters_01.bin and 4 more files named in the manifest
- Changes: Passed through: geometry, UV coordinates, materials and the 1k textures are the source's own, unchanged. Added: a root that puts the model on the scene's axes, in metres, centred on its own middle, and a tag on each named part.
- Built file: bolt-cutters.glb, 2496808 bytes, sha256 470c491d351b1bf2831d69511bcdb18a01243a5eaf8881db0de84874f13217a0
- Parts (source node): Bolt cutters (bolt_cutters_01)
- Limit: A single scanned or modelled object: it can be labelled as a whole, but has no named parts to cut or take apart.

## Human brain (`brain`)

- Source: BodyParts3D, https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ (4.0, polygon reduction 99 percent (archive of 2013-05-22; README and licence of 2025-02-27))
- Source archive: https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip (142903898 bytes)
- Licence: CC BY 4.0, version 4.0 International: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- Earlier notice, kept on record: the header of every OBJ file in the 2013 archive name CC Attribution-ShareAlike 2.1 Japan; the current grant above is what is relied on.
- Held back from releases: a local prototype only: not published and not packed into a release until it is cleared for one.
- Credit: BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International
- Changes: Files converted from OBJ to glTF, millimetres to metres, axes turned to y up and the front toward the viewer, parts recentred on themselves; left and right meshes and gyri are merged into one named part. Duplicate vertices were welded and smooth normals computed; no shape was edited.
- Note: The licensor's current statement (the database licence page updated 2025-02-27, and the README) is CC BY 4.0 International, and it is what is relied on. The OBJ files in the 2013 archive still carry an older header naming CC Attribution-ShareAlike 2.1 Japan; that is recorded here and kept in the credits, not erased.
- Built file: brain.glb, 8358176 bytes, sha256 0d353d478830dff8e6fac252909c2e236229932336e63eb8a7665179b2f914d1
- Parts (confidence; source element ids): Frontal lobe (grouped; FJ1833 FJ1834 FJ1787 FJ1788 FJ1744 FJ1745 FJ1800 FJ1801 FJ1793 FJ1794); Parietal lobe (grouped; FJ1797 FJ1798 FJ1841 FJ1842 FJ1732 FJ1733 FJ1835 FJ1836); Temporal lobe (grouped; FJ1746 FJ1747 FJ1789 FJ1790 FJ1783 FJ1784 FJ1785 FJ1786 FJ1837 FJ1838); Occipital lobe (atlas; FJ1791 FJ1792); Insula (atlas; FJ1748 FJ1749); Cingulate gyrus (atlas; FJ1739 FJ1740); Cerebellum (atlas; FJ1781 FJ1830); Pons (atlas; FJ1775 FJ1822); Medulla oblongata (atlas; FJ1769 FJ1831); Midbrain (atlas; FJ1770 FJ1817); Thalamus (atlas; FJ1782 FJ1827); Hypothalamus (atlas; FJ1760 FJ1808); Hippocampus (atlas; FJ1759 FJ1807); Amygdala (atlas; FJ1753 FJ1829); Caudate nucleus (atlas; FJ1754 FJ1802); Globus pallidus (atlas; FJ1757 FJ1805); Corpus callosum (atlas; FJ1742); Cerebral white matter (atlas; FJ1758 FJ1806); Lateral ventricles (atlas; FJ1767 FJ1814); Pituitary gland (atlas; FJ1796)
- Limit: The atlas models the main gyri, not every fold: the lobes are made of the named gyri it has, so small regions (the precuneus, the posterior superior temporal gyrus) are not separate and may show as gaps.

## Vintage camera (`camera`)

- Source: Poly Haven, https://polyhaven.com/a/Camera_01 (Camera 01, 1k glTF, published 2020-03-30)
- Licence: CC0 1.0 Universal, version 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- As the licence is stated at https://polyhaven.com/license: Our assets are all licensed as CC0. You do not need to give credit.
- Made by: Rajil Jose Macatangay (no credit is required; named here as a courtesy)
- Fetched on 2026-11-08 from: https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/Camera_01/Camera_01.bin and 10 more files named in the manifest
- Changes: Passed through: geometry, UV coordinates, materials and the 1k textures are the source's own, unchanged. Added: a root that puts the model on the scene's axes, in metres, centred on its own middle, and a tag on each named part.
- Built file: camera.glb, 2436424 bytes, sha256 538e0612753fce31aa31da50426567ed4336853d20afab07d2a033e80de7b31a
- Parts (source node): Strap (Camera_01_strap); Camera body and lens (Camera_01)

## Power drill (`drill`)

- Source: Poly Haven, https://polyhaven.com/a/Drill_01 (Drill 01, 1k glTF, published 2020-03-30)
- Licence: CC0 1.0 Universal, version 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- As the licence is stated at https://polyhaven.com/license: Our assets are all licensed as CC0. You do not need to give credit.
- Made by: Fernando Quinn (no credit is required; named here as a courtesy)
- Fetched on 2026-11-08 from: https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/Drill_01/Drill_01.bin and 4 more files named in the manifest
- Changes: Passed through: geometry, UV coordinates, materials and the 1k textures are the source's own, unchanged. Added: a root that puts the model on the scene's axes, in metres, centred on its own middle, and a tag on each named part.
- Built file: drill.glb, 500292 bytes, sha256 a5afd4c33c8d24b4c2f5a0978047654e81835adcf38a4f7de916dfd2cee7683b
- Parts (source node): Power drill (Drill_01)
- Limit: A single scanned or modelled object: it can be labelled as a whole, but has no named parts to cut or take apart.

## Davenport electric motor (`electric-motor`)

- Source: Smithsonian Open Access, https://3d-api.si.edu/voyager/3d_package:a18922b9-a00f-4c9e-988a-f526382b15cc (Davenport electric motor, US patent #132, record edanmdm:nmah_703302)
- Licence: CC0 1.0 Universal, version 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- As the licence is stated at https://api.si.edu/openaccess/api/v1.0/content/edanmdm:nmah_703302: The 3D media of the record carries usage access "CC0" (read from the Smithsonian Open Access API record on 2026-11-08).
- Made by: Smithsonian National Museum of American History, Digitization Program Office (no credit is required; named here as a courtesy)
- Fetched on 2026-11-08 from: https://3d-api.si.edu/content/document/3d_package:a18922b9-a00f-4c9e-988a-f526382b15cc/resources/Davenport_motor-100k-2048_std.glb
- Changes: Passed through: the geometry, texture coordinates, material and textures are the museum's own, unchanged. Added: a root that puts the model on the scene's axes, in metres, centred on its own middle, and a tag on the part.
- Built file: electric-motor.glb, 4335360 bytes, sha256 d26c1f8dbdfca5abc178136004ccc52ec6c6877be03fcfb423e397975fcf8be1
- Parts (source node): Davenport electric motor (#0)
- Limit: A single scanned or modelled object: it can be labelled as a whole, but has no named parts to cut or take apart.
- Limit: The source's textures are larger than the page draws them at; they are reduced when loaded, to the size each tier allows.

## Human heart (`heart`)

- Source: BodyParts3D, https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ (4.0, polygon reduction 99 percent (archive of 2013-05-22; README and licence of 2025-02-27))
- Source archive: https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip (142903898 bytes)
- Licence: CC BY 4.0, version 4.0 International: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- Earlier notice, kept on record: the header of every OBJ file in the 2013 archive name CC Attribution-ShareAlike 2.1 Japan; the current grant above is what is relied on.
- Held back from releases: a local prototype only: not published and not packed into a release until it is cleared for one.
- Credit: BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International
- Changes: Files converted from OBJ to glTF, millimetres to metres, axes turned to y up and the front toward the viewer, parts recentred on themselves; a file may be merged with others into one named part. Duplicate vertices were welded and smooth normals computed; no shape was edited.
- Note: The licensor's current statement (the database licence page updated 2025-02-27, and the README) is CC BY 4.0 International, and it is what is relied on. The OBJ files in the 2013 archive still carry an older header naming CC Attribution-ShareAlike 2.1 Japan; that is recorded here and kept in the credits, not erased.
- Built file: heart.glb, 2558152 bytes, sha256 309af9886b9388323beb7e9c933c2b1f2a30b05ba93768eda6c8999b7da20ef1
- Parts (confidence; source element ids): Right atrium (atlas; FJ2424); Wall of the right atrium (atlas; FJ2439); Left atrium (atlas; FJ2425); Wall of the left atrium (atlas; FJ2438); Right ventricle (atlas; FJ2423); Left ventricle (atlas; FJ2422); Mitral valve (grouped; FJ2420 FJ2432); Tricuspid valve (grouped; FJ2421 FJ2433 FJ2436); Aortic valve (grouped; FJ2435 FJ2426 FJ2431); Pulmonary valve (grouped; FJ2417 FJ2427 FJ2434); Papillary muscles (grouped; FJ2418 FJ2419 FJ2429 FJ2430 FJ2437); Ascending aorta (atlas; FJ3413); Arch of the aorta (atlas; FJ3411); Pulmonary trunk (atlas; FJ2966); Superior vena cava (atlas; FJ3645); Left coronary artery and its branches (grouped; FJ2737 FJ2631 FJ2632 FJ2633 FJ2634 FJ2635 FJ2636 FJ2637 FJ2638 FJ2639 FJ2640 FJ2641 FJ2642 FJ2643 FJ2644 FJ2645 FJ2646 FJ2647 FJ2648 FJ2649 FJ2650 FJ2651 FJ2652 FJ2653 FJ2654); Right coronary artery and its branches (grouped; FJ2723 FJ2667 FJ2668 FJ2670 FJ2671 FJ2672 FJ2673 FJ2674 FJ2675 FJ2676 FJ2677 FJ2692 FJ2693 FJ2694 FJ2695 FJ2696 FJ2697 FJ2698 FJ2699 FJ2700 FJ2714 FJ2715 FJ2716 FJ2717 FJ2718 FJ2719 FJ2720 FJ2721 FJ2722); Cardiac veins (grouped; FJ2655 FJ2656 FJ2724 FJ2727 FJ2728 FJ2729 FJ2731)
- Limit: The atlas has no mesh for the ventricular wall or the pericardium: the chambers are drawn as their blood-filled cavities, so a cut shows cavities, valves and vessels, not a wall.
- Limit: The pulmonary veins, the branches of the pulmonary arteries and the inferior vena cava (its mesh runs 24 cm into the abdomen) are not included.

## Measuring tape (`measuring-tape`)

- Source: Poly Haven, https://polyhaven.com/a/measuring_tape_01 (Measuring Tape 01, 1k glTF, published 2021-10-15)
- Licence: CC0 1.0 Universal, version 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- As the licence is stated at https://polyhaven.com/license: Our assets are all licensed as CC0. You do not need to give credit.
- Made by: Kuutti Siitonen (no credit is required; named here as a courtesy)
- Fetched on 2026-11-08 from: https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/measuring_tape_01/measuring_tape_01.bin and 4 more files named in the manifest
- Changes: Passed through: geometry, UV coordinates, materials and the 1k textures are the source's own, unchanged. Added: a root that puts the model on the scene's axes, in metres, centred on its own middle, and a tag on each named part.
- Built file: measuring-tape.glb, 445184 bytes, sha256 a947441fd19e3a5b89f27f62510c805e36dd0077120e966729ddd3bec21713e9
- Parts (source node): Measuring tape (measuring_tape_01)
- Limit: A single scanned or modelled object: it can be labelled as a whole, but has no named parts to cut or take apart.

## Mousetrap (`mousetrap`)

- Source: Poly Haven, https://polyhaven.com/a/mousetrap (Mousetrap, 1k glTF, published 2023-05-19)
- Licence: CC0 1.0 Universal, version 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- As the licence is stated at https://polyhaven.com/license: Our assets are all licensed as CC0. You do not need to give credit.
- Made by: GreenPixel (no credit is required; named here as a courtesy)
- Fetched on 2026-11-08 from: https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/mousetrap/mousetrap.bin and 4 more files named in the manifest
- Changes: Passed through: geometry, UV coordinates, materials and the 1k textures are the source's own, unchanged. Added: a root that puts the model on the scene's axes, in metres, centred on its own middle, and a tag on each named part.
- Built file: mousetrap.glb, 2233796 bytes, sha256 04def5d43d0c40c2b8a905c65115407c6e3623cc0dc17e95c07e9812ac8194c3
- Parts (source node): Mousetrap (mousetrap)
- Limit: A single scanned or modelled object: it can be labelled as a whole, but has no named parts to cut or take apart.

## Morse-Vail telegraph key (`telegraph-key`)

- Source: Smithsonian Open Access, https://3d-api.si.edu/voyager/3d_package:ed99f44d-3c60-4111-b666-e2908e1b64ef (Morse-Vail Telegraph Key, record edanmdm:nmah_1096762)
- Licence: CC0 1.0 Universal, version 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- As the licence is stated at https://www.si.edu/object/nmah_1096762: Listed as CC0 on its Smithsonian 3D record (seen in a search result on 2026-11-09; the record page itself would not load for us and the Open Access API refused the lookup, so this one is not read from the record directly).
- Made by: Smithsonian National Museum of American History, Digitization Program Office (no credit is required; named here as a courtesy)
- Fetched on 2026-11-08 from: https://3d-api.si.edu/content/document/3d_package:ed99f44d-3c60-4111-b666-e2908e1b64ef/resources/morse-telegraph-key-150k-4096.glb
- Changes: Passed through: the geometry, texture coordinates, material and textures are the museum's own, unchanged. Added: a root that puts the model on the scene's axes, in metres, centred on its own middle, and a tag on the part.
- Built file: telegraph-key.glb, 7582656 bytes, sha256 40aed26cdcb2b5a9b29d6fad85ce3b7ff2309c39ab893320c4f3fc69fc99cc0a
- Parts (source node): Morse-Vail telegraph key (#0)
- Limit: A single scanned or modelled object: it can be labelled as a whole, but has no named parts to cut or take apart.
- Limit: The source's textures are larger than the page draws them at; they are reduced when loaded, to the size each tier allows.
