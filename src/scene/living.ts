// Living subjects built from shapes: what to tell a model when the question is about one. The renderer draws the soft solids of a living thing as one body
// wherever they touch, with layers under the skin (overlay/organic-bodies.ts), from the shapes the guide already teaches; the hint says how to write them so
// that it can. A few sentences beside the question, never in the static guide.

import { norm } from './names.ts';

/**
 * Words that say a question is about a living thing: the body and its organs, animals and their parts, plants, what grows to be eaten. Whole words; a plural
 * is found by its singular. Words that mean something else as often (a mouse, a bulb, a branch, a root, a wing, a virus, the body of a letter, a cell of a table) are left out: the
 * question that means the living one nearly always names another of these too.
 */
const LIVING: ReadonlySet<string> = new Set(`
anatomy organ tissue muscle tendon ligament bone skeleton skull spine vertebra rib cartilage skin nerve neuron vein artery gland membrane blood
heart brain lung kidney liver stomach intestine bowel colon bladder pancreas spleen gallbladder uterus womb ovary placenta thyroid tonsil appendix esophagus oesophagus
trachea windpipe diaphragm larynx eye eyeball retina cornea iris ear eardrum cochlea nose nostril mouth tongue tooth teeth jaw lip throat
hand finger thumb palm wrist knuckle fist forearm elbow shoulder leg knee ankle toe heel hip thigh limb paw claw hoof beak feather antler
tentacle gill snout animal fish bird insect mammal reptile amphibian dog cat horse cow pig sheep goat rabbit whale dolphin shark octopus squid jellyfish starfish crab
lobster snail worm earthworm spider ant bee wasp butterfly caterpillar moth beetle mosquito frog toad snake lizard turtle tortoise crocodile dinosaur chicken duck
eagle owl penguin lion tiger elephant giraffe monkey ape deer wolf fox squirrel hedgehog kangaroo camel salmon trout
plant tree leaf leaves flower petal seed seedling fruit berry vegetable grass moss fern cactus mushroom fungus fungi algae pollen stamen pistil sepal bud
tuber twig thorn vine pod chloroplast photosynthesis peach pear plum cherry lemon grape banana strawberry tomato potato carrot onion avocado mango melon
watermelon pumpkin coconut pea bean corn wheat egg yolk bacteria bacterium amoeba mitochondria mitochondrion organelle embryo fetus foetus
`.split(/\s+/).filter(Boolean));

/** A word of the question as the list has it: itself, or its singular. */
const singular = (word: string): string[] => [word, word.replace(/ies$/, 'y'), word.replace(/es$/, ''), word.replace(/s$/, '')];

/** Whether a question names a living thing (whole words of the list above, in any case, singular or plural). */
export function namesLiving(question: string): boolean {
  return norm(question).replace(/[^a-z0-9 ]+/g, ' ').split(' ').some((word) => word.length > 2 && singular(word).some((w) => LIVING.has(w)));
}

/**
 * What to tell a model when the question names a living thing: how to write its parts so they are drawn as one body with an inside. Nothing when the
 * question names none. The caller leaves it out when a real model of the thing is offered instead.
 */
export function livingHint(question: string): string | undefined {
  if (!namesLiving(question)) return undefined;
  return 'If you build a living thing from shapes (an organ, a limb, an animal, a plant, a fruit): its soft parts are drawn as one body, with a smooth join wherever two of them touch and layers under the skin where it is cut. So write each named part as its own object, with its own id, colour and a living material (skin, muscle, organ, vessel, fat, bone, cartilage, leaf, petal, fruit), and make it overlap what it grows from: a finger, a vessel or a stem starts inside the palm, the chamber or the trunk; parts that only come near stay apart. Give each part its true proportions: a palm, a leaf or a fin is wide and thin (a flat blob of several lumps, or an extrude of its outline), never a ball; a finger, a limb or a vessel is a tube with swell. Put inner parts (a bone, a stone, airways) inside the part that holds them; a vessel, and a soft part made see-through with opacity, is drawn hollow with a wall.';
}
