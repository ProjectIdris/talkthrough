// The real models the scene language can place: what each is, its licence and credit, and its named parts. Generated from assets/models/*.json by
// `npm run assets:index` (scripts/assets/index.mjs); do not edit. The meshes themselves are built files, not in git (see scripts/assets).

import type { Vec3 } from './types.ts';

export type ModelPart = {
  key: string; name: string; aliases: string[];
  /** How the source backs the part: atlas (a named mesh of the source), grouped (several of its meshes, grouped by us), approximate (a place, not a structure). */
  confidence: 'atlas' | 'grouped' | 'approximate';
  color: [number, number, number];
  /** Whether the mesh is a watertight solid, so a cut can be capped. */
  closed: boolean;
  /** The part's middle and size in metres, from the model's own middle. */
  center: Vec3; size: Vec3; triangles: number;
};
export type ModelEntry = {
  id: string; name: string; description: string; aliases: string[];
  licence: { id: string; name: string; version: string; url: string };
  /** The credit line the licence asks to be shown (CC BY); none for CC0. */
  credit: string | undefined;
  /** The whole model's size in metres, and the real length of its subject. */
  size: Vec3; realLengthMetres: number; caveats: string[];
  built: { file: string; bytes: number; sha256: string; triangles: number };
  parts: ModelPart[];
};

export const MODELS: readonly ModelEntry[] = [
  {
    "id": "brain",
    "name": "Human brain",
    "description": "An adult human brain: the main cortical gyri grouped into the four lobes, deep structures, cerebellum and brainstem, as named parts.",
    "aliases": [
      "brain",
      "human brain",
      "cerebrum",
      "lobes of the brain",
      "cerebral cortex",
      "cerebellum"
    ],
    "licence": {
      "id": "CC-BY-4.0",
      "name": "CC BY 4.0",
      "version": "4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "credit": "BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/)",
    "size": [
      0.138834,
      0.16596,
      0.180006
    ],
    "realLengthMetres": 0.17,
    "caveats": [
      "The atlas models the main gyri, not every fold: the lobes are made of the named gyri it has, so small regions (the precuneus, the posterior superior temporal gyrus) are not separate and may show as gaps."
    ],
    "built": {
      "file": "brain.glb",
      "bytes": 8358176,
      "sha256": "0d353d478830dff8e6fac252909c2e236229932336e63eb8a7665179b2f914d1",
      "triangles": 347340
    },
    "parts": [
      {
        "key": "frontal-lobe",
        "name": "Frontal lobe",
        "aliases": [
          "frontal cortex"
        ],
        "confidence": "grouped",
        "color": [
          226,
          150,
          120
        ],
        "closed": true,
        "center": [
          -0.000109,
          0.03463,
          0.024801
        ],
        "size": [
          0.127036,
          0.0967,
          0.130404
        ],
        "triangles": 39628
      },
      {
        "key": "parietal-lobe",
        "name": "Parietal lobe",
        "aliases": [
          "parietal cortex"
        ],
        "confidence": "grouped",
        "color": [
          232,
          196,
          110
        ],
        "closed": true,
        "center": [
          0.000064,
          0.03401,
          -0.038944
        ],
        "size": [
          0.138492,
          0.0844,
          0.094374
        ],
        "triangles": 30012
      },
      {
        "key": "temporal-lobe",
        "name": "Temporal lobe",
        "aliases": [
          "temporal cortex"
        ],
        "confidence": "grouped",
        "color": [
          120,
          190,
          140
        ],
        "closed": true,
        "center": [
          0,
          -0.004345,
          -0.008636
        ],
        "size": [
          0.138834,
          0.05927,
          0.114089
        ],
        "triangles": 19458
      },
      {
        "key": "occipital-lobe",
        "name": "Occipital lobe",
        "aliases": [
          "visual cortex"
        ],
        "confidence": "atlas",
        "color": [
          130,
          150,
          226
        ],
        "closed": true,
        "center": [
          -0.000125,
          -0.00283,
          -0.058363
        ],
        "size": [
          0.088351,
          0.05382,
          0.063281
        ],
        "triangles": 8954
      },
      {
        "key": "insula",
        "name": "Insula",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          210,
          130,
          170
        ],
        "closed": true,
        "center": [
          -0.000132,
          0.015335,
          0.016858
        ],
        "size": [
          0.08987,
          0.03457,
          0.051781
        ],
        "triangles": 4896
      },
      {
        "key": "cingulate-gyrus",
        "name": "Cingulate gyrus",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          190,
          120,
          200
        ],
        "closed": true,
        "center": [
          -0.000119,
          0.016425,
          0.006743
        ],
        "size": [
          0.057946,
          0.06665,
          0.111379
        ],
        "triangles": 4762
      },
      {
        "key": "cerebellum",
        "name": "Cerebellum",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          150,
          120,
          190
        ],
        "closed": true,
        "center": [
          -0.000137,
          -0.033605,
          -0.039354
        ],
        "size": [
          0.10654,
          0.05327,
          0.056292
        ],
        "triangles": 47700
      },
      {
        "key": "pons",
        "name": "Pons",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          200,
          160,
          140
        ],
        "closed": true,
        "center": [
          -0.000128,
          -0.0311,
          0.00011
        ],
        "size": [
          0.042197,
          0.02862,
          0.034406
        ],
        "triangles": 20650
      },
      {
        "key": "medulla-oblongata",
        "name": "Medulla oblongata",
        "aliases": [
          "medulla"
        ],
        "confidence": "atlas",
        "color": [
          214,
          176,
          150
        ],
        "closed": true,
        "center": [
          -0.00013,
          -0.06234,
          -0.011835
        ],
        "size": [
          0.026734,
          0.04128,
          0.0332
        ],
        "triangles": 12096
      },
      {
        "key": "midbrain",
        "name": "Midbrain",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          184,
          150,
          130
        ],
        "closed": true,
        "center": [
          -0.000132,
          -0.01047,
          0.001592
        ],
        "size": [
          0.029333,
          0.01704,
          0.029371
        ],
        "triangles": 12908
      },
      {
        "key": "thalamus",
        "name": "Thalamus",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          226,
          120,
          120
        ],
        "closed": true,
        "center": [
          -0.000092,
          0.00643,
          0.000427
        ],
        "size": [
          0.047979,
          0.02368,
          0.036589
        ],
        "triangles": 2460
      },
      {
        "key": "hypothalamus",
        "name": "Hypothalamus",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          240,
          160,
          100
        ],
        "closed": true,
        "center": [
          -0.00013,
          -0.005315,
          0.021533
        ],
        "size": [
          0.015228,
          0.01987,
          0.017941
        ],
        "triangles": 4078
      },
      {
        "key": "hippocampus",
        "name": "Hippocampus",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          100,
          180,
          200
        ],
        "closed": true,
        "center": [
          -0.000129,
          -0.007235,
          0.001233
        ],
        "size": [
          0.074507,
          0.02199,
          0.042922
        ],
        "triangles": 2000
      },
      {
        "key": "amygdala",
        "name": "Amygdala",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          240,
          110,
          150
        ],
        "closed": true,
        "center": [
          -0.000097,
          -0.00912,
          0.018688
        ],
        "size": [
          0.068013,
          0.01286,
          0.018457
        ],
        "triangles": 766
      },
      {
        "key": "caudate-nucleus",
        "name": "Caudate nucleus",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          120,
          170,
          230
        ],
        "closed": true,
        "center": [
          -0.000139,
          0.011325,
          0.012475
        ],
        "size": [
          0.068694,
          0.03709,
          0.063585
        ],
        "triangles": 5114
      },
      {
        "key": "globus-pallidus",
        "name": "Globus pallidus",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          150,
          200,
          120
        ],
        "closed": true,
        "center": [
          -0.000129,
          0.00748,
          0.015189
        ],
        "size": [
          0.059349,
          0.0173,
          0.029279
        ],
        "triangles": 12424
      },
      {
        "key": "corpus-callosum",
        "name": "Corpus callosum",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          240,
          232,
          214
        ],
        "closed": true,
        "center": [
          -0.000135,
          0.016355,
          0.005571
        ],
        "size": [
          0.051806,
          0.03885,
          0.091623
        ],
        "triangles": 30232
      },
      {
        "key": "cerebral-white-matter",
        "name": "Cerebral white matter",
        "aliases": [
          "white matter"
        ],
        "confidence": "atlas",
        "color": [
          236,
          226,
          206
        ],
        "closed": true,
        "center": [
          -0.000144,
          0.024975,
          0.001254
        ],
        "size": [
          0.126252,
          0.10109,
          0.163222
        ],
        "triangles": 52054
      },
      {
        "key": "lateral-ventricles",
        "name": "Lateral ventricles",
        "aliases": [
          "ventricles"
        ],
        "confidence": "atlas",
        "color": [
          90,
          150,
          240
        ],
        "closed": true,
        "center": [
          -0.000131,
          0.007345,
          -0.0074
        ],
        "size": [
          0.077503,
          0.04903,
          0.109333
        ],
        "triangles": 35984
      },
      {
        "key": "pituitary-gland",
        "name": "Pituitary gland",
        "aliases": [
          "pituitary"
        ],
        "confidence": "atlas",
        "color": [
          250,
          200,
          90
        ],
        "closed": true,
        "center": [
          -0.000112,
          -0.018425,
          0.02616
        ],
        "size": [
          0.012311,
          0.01297,
          0.009458
        ],
        "triangles": 1164
      }
    ]
  },
  {
    "id": "heart",
    "name": "Human heart",
    "description": "An adult human heart: four chambers, valves, papillary muscles, great vessels and coronary arteries, as separate named parts.",
    "aliases": [
      "heart",
      "human heart",
      "cardiac",
      "cardiovascular",
      "chambers of the heart",
      "aorta"
    ],
    "licence": {
      "id": "CC-BY-4.0",
      "name": "CC BY 4.0",
      "version": "4.0 International",
      "url": "https://creativecommons.org/licenses/by/4.0/"
    },
    "credit": "BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/)",
    "size": [
      0.115695,
      0.14217,
      0.126672
    ],
    "realLengthMetres": 0.12,
    "caveats": [
      "The atlas has no mesh for the ventricular wall or the pericardium: the chambers are drawn as their blood-filled cavities, so a cut shows cavities, valves and vessels, not a wall.",
      "The pulmonary veins, the branches of the pulmonary arteries and the inferior vena cava (its mesh runs 24 cm into the abdomen) are not included."
    ],
    "built": {
      "file": "heart.glb",
      "bytes": 2558152,
      "sha256": "309af9886b9388323beb7e9c933c2b1f2a30b05ba93768eda6c8999b7da20ef1",
      "triangles": 105768
    },
    "parts": [
      {
        "key": "right-atrium",
        "name": "Right atrium",
        "aliases": [
          "atrium right"
        ],
        "confidence": "atlas",
        "color": [
          92,
          132,
          230
        ],
        "closed": true,
        "center": [
          -0.037052,
          -0.014615,
          0.009824
        ],
        "size": [
          0.03739,
          0.09226,
          0.061127
        ],
        "triangles": 2244
      },
      {
        "key": "right-atrium-wall",
        "name": "Wall of the right atrium",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          200,
          120,
          130
        ],
        "closed": true,
        "center": [
          -0.036307,
          -0.014715,
          0.016314
        ],
        "size": [
          0.043082,
          0.09642,
          0.0663
        ],
        "triangles": 17784
      },
      {
        "key": "left-atrium",
        "name": "Left atrium",
        "aliases": [
          "atrium left"
        ],
        "confidence": "atlas",
        "color": [
          226,
          86,
          96
        ],
        "closed": true,
        "center": [
          -0.007574,
          -0.008635,
          -0.014305
        ],
        "size": [
          0.068708,
          0.06184,
          0.055771
        ],
        "triangles": 1064
      },
      {
        "key": "left-atrium-wall",
        "name": "Wall of the left atrium",
        "aliases": [],
        "confidence": "atlas",
        "color": [
          200,
          120,
          130
        ],
        "closed": true,
        "center": [
          -0.001364,
          -0.01009,
          -0.00252
        ],
        "size": [
          0.086119,
          0.07297,
          0.080981
        ],
        "triangles": 7544
      },
      {
        "key": "right-ventricle",
        "name": "Right ventricle",
        "aliases": [
          "ventricle right"
        ],
        "confidence": "atlas",
        "color": [
          86,
          124,
          222
        ],
        "closed": true,
        "center": [
          -0.004635,
          -0.02625,
          0.031126
        ],
        "size": [
          0.071509,
          0.08055,
          0.058223
        ],
        "triangles": 1918
      },
      {
        "key": "left-ventricle",
        "name": "Left ventricle",
        "aliases": [
          "ventricle left"
        ],
        "confidence": "atlas",
        "color": [
          222,
          76,
          88
        ],
        "closed": true,
        "center": [
          0.016813,
          -0.028195,
          0.009281
        ],
        "size": [
          0.063779,
          0.06748,
          0.07212
        ],
        "triangles": 1722
      },
      {
        "key": "mitral-valve",
        "name": "Mitral valve",
        "aliases": [
          "bicuspid valve"
        ],
        "confidence": "grouped",
        "color": [
          238,
          226,
          196
        ],
        "closed": true,
        "center": [
          0.015744,
          -0.028245,
          0.000354
        ],
        "size": [
          0.051133,
          0.03632,
          0.05618
        ],
        "triangles": 11378
      },
      {
        "key": "tricuspid-valve",
        "name": "Tricuspid valve",
        "aliases": [],
        "confidence": "grouped",
        "color": [
          238,
          226,
          196
        ],
        "closed": true,
        "center": [
          -0.017332,
          -0.033445,
          0.021762
        ],
        "size": [
          0.050579,
          0.04784,
          0.04274
        ],
        "triangles": 17612
      },
      {
        "key": "aortic-valve",
        "name": "Aortic valve",
        "aliases": [],
        "confidence": "grouped",
        "color": [
          238,
          226,
          196
        ],
        "closed": true,
        "center": [
          -0.002516,
          -0.00176,
          0.005453
        ],
        "size": [
          0.02672,
          0.02167,
          0.027615
        ],
        "triangles": 2150
      },
      {
        "key": "pulmonary-valve",
        "name": "Pulmonary valve",
        "aliases": [
          "pulmonic valve"
        ],
        "confidence": "grouped",
        "color": [
          238,
          226,
          196
        ],
        "closed": true,
        "center": [
          0.003301,
          0.00908,
          0.030411
        ],
        "size": [
          0.032154,
          0.02037,
          0.031978
        ],
        "triangles": 3638
      },
      {
        "key": "papillary-muscles",
        "name": "Papillary muscles",
        "aliases": [
          "papillary muscle"
        ],
        "confidence": "grouped",
        "color": [
          170,
          70,
          80
        ],
        "closed": true,
        "center": [
          0.019309,
          -0.0367,
          0.025558
        ],
        "size": [
          0.067376,
          0.06173,
          0.067943
        ],
        "triangles": 4014
      },
      {
        "key": "ascending-aorta",
        "name": "Ascending aorta",
        "aliases": [
          "aorta"
        ],
        "confidence": "atlas",
        "color": [
          214,
          82,
          82
        ],
        "closed": true,
        "center": [
          -0.010483,
          0.011975,
          0.00887
        ],
        "size": [
          0.035765,
          0.04784,
          0.030777
        ],
        "triangles": 396
      },
      {
        "key": "aortic-arch",
        "name": "Arch of the aorta",
        "aliases": [
          "aortic arch"
        ],
        "confidence": "atlas",
        "color": [
          214,
          82,
          82
        ],
        "closed": true,
        "center": [
          -0.00754,
          0.05349,
          -0.019677
        ],
        "size": [
          0.041668,
          0.03519,
          0.087318
        ],
        "triangles": 670
      },
      {
        "key": "pulmonary-trunk",
        "name": "Pulmonary trunk",
        "aliases": [
          "pulmonary artery"
        ],
        "confidence": "atlas",
        "color": [
          92,
          128,
          226
        ],
        "closed": true,
        "center": [
          0.005131,
          0.02905,
          0.024509
        ],
        "size": [
          0.0308,
          0.03711,
          0.042348
        ],
        "triangles": 1302
      },
      {
        "key": "superior-vena-cava",
        "name": "Superior vena cava",
        "aliases": [
          "vena cava"
        ],
        "confidence": "atlas",
        "color": [
          92,
          128,
          226
        ],
        "closed": true,
        "center": [
          -0.036916,
          0.046305,
          0.002251
        ],
        "size": [
          0.022525,
          0.035,
          0.023689
        ],
        "triangles": 598
      },
      {
        "key": "left-coronary-artery",
        "name": "Left coronary artery and its branches",
        "aliases": [
          "coronary artery",
          "coronary arteries"
        ],
        "confidence": "grouped",
        "color": [
          236,
          150,
          60
        ],
        "closed": true,
        "center": [
          0.029846,
          -0.02587,
          0.016692
        ],
        "size": [
          0.056002,
          0.08137,
          0.085786
        ],
        "triangles": 12666
      },
      {
        "key": "right-coronary-artery",
        "name": "Right coronary artery and its branches",
        "aliases": [],
        "confidence": "grouped",
        "color": [
          236,
          170,
          70
        ],
        "closed": true,
        "center": [
          0.004379,
          -0.02801,
          0.019393
        ],
        "size": [
          0.09534,
          0.08615,
          0.087885
        ],
        "triangles": 14682
      },
      {
        "key": "cardiac-veins",
        "name": "Cardiac veins",
        "aliases": [
          "coronary sinus"
        ],
        "confidence": "grouped",
        "color": [
          110,
          120,
          200
        ],
        "closed": true,
        "center": [
          -0.004547,
          -0.029925,
          0.013577
        ],
        "size": [
          0.075674,
          0.07476,
          0.0913
        ],
        "triangles": 4386
      }
    ]
  }
];
