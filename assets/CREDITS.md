# Credits for the real models

Talkthrough's own code is MIT licensed. The MIT licence covers that code only: it excludes the models named here, which are separate works under their own licences, listed below with who made them and what was changed.
This file is generated from `assets/models/*.json` (`npm run assets:index`) and is shipped with the app.

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
