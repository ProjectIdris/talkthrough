// Living subjects built from shapes: what to tell a model when the question is about one. The renderer draws the soft solids of a living thing as one body
// wherever they touch, with layers under the skin (overlay/organic-bodies.ts), from the shapes the guide already teaches; the hint says how to write them so
// that it can. A few sentences beside the question, never in the static guide.

import { norm } from './names.ts';

/**
 * Words that say a question is about a living thing: the body and its organs, animals and their parts, plants, what grows to be eaten. Whole words; a plural
 * is found by its singular. Words that mean something else as often (a mouse, a bulb, a branch, a root, a wing, a virus, a seed, a pod, a cat, an ant, a
 * spider, the body of a letter, a cell of a table, the organ in a church) are left out: the question that means the living one nearly always names another
 * of these too.
 */
const LIVING: ReadonlySet<string> = new Set(`
anatomy tissue muscle tendon ligament bone skeleton skull spine vertebra cartilage skin nerve neuron vein artery gland membrane blood
heart brain lung kidney liver stomach intestine bowel colon bladder pancreas spleen gallbladder uterus womb ovary placenta thyroid tonsil appendix esophagus oesophagus
trachea windpipe diaphragm larynx eye eyeball retina cornea iris ear eardrum cochlea nose nostril mouth tongue tooth teeth jaw lip throat
hand finger thumb palm wrist knuckle fist forearm elbow shoulder leg knee ankle toe heel thigh limb paw claw hoof beak feather antler
tentacle gill snout animal fish bird insect mammal reptile amphibian dog horse cow pig sheep goat rabbit whale dolphin shark octopus squid jellyfish starfish crab
lobster snail earthworm wasp butterfly caterpillar moth beetle mosquito frog toad snake lizard turtle tortoise crocodile dinosaur chicken duck
eagle owl penguin lion tiger elephant giraffe monkey ape deer wolf fox squirrel hedgehog kangaroo camel salmon trout
plant tree leaf leaves flower petal seedling fruit berry vegetable grass moss fern cactus mushroom fungus fungi algae pollen stamen pistil sepal bud
tuber twig thorn vine chloroplast photosynthesis peach pear plum cherry lemon grape banana strawberry tomato potato carrot onion avocado mango melon
watermelon pumpkin coconut pea bean corn wheat egg yolk bacteria bacterium amoeba mitochondria mitochondrion organelle embryo fetus foetus
`.split(/\s+/).filter(Boolean));

/** Living words used of something else: these pairs of words are taken out of the question before it is read. */
const FIGURES = /\b(?:(?:decision|binary|file|search|syntax|parse|family|directory) trees?|leaf nodes?|(?:other|one) hand|(?:by|at|on) hand|hands? on|second hand|hand tools?|power plants?)\b/g;
/** Words that say the question is about software or a drawing of it, where a tree, a leaf or a heart is a figure or an icon: no hint beside these. */
const SOFTWARE: ReadonlySet<string> = new Set('app code git command icon logo theme file folder'.split(' '));

/** A word of the question as the list has it: itself, or its singular. */
const singular = (word: string): string[] => [word, word.replace(/ies$/, 'y'), word.replace(/es$/, ''), word.replace(/s$/, '')];

/** Whether a question names a living thing (whole words of the list above, in any case, singular or plural). */
export function namesLiving(question: string): boolean {
  const words = norm(question).replace(/[^a-z0-9 ]+/g, ' ').replace(FIGURES, ' ').split(' ');
  if (words.some((word) => singular(word).some((w) => SOFTWARE.has(w)))) return false;
  return words.some((word) => word.length > 2 && singular(word).some((w) => LIVING.has(w)));
}

/**
 * What to tell a model when the question names a living thing: how to write its parts so they are drawn as one body with an inside. Nothing when the
 * question names none. The caller leaves it out when a real model of the thing is offered instead.
 */
export function livingHint(question: string): string | undefined {
  if (!namesLiving(question)) return undefined;
  return [
    // The outline before the inside: a model told only about the inside gives up the shape a thing is known by (a kidney that is no bean, lungs with no diaphragm).
    'If you build a living thing from shapes (an organ, a limb, an animal, a plant, a fruit): get its outline right first, the shape it is known by, with every part a person would look for and whatever goes into it or out of it (a kidney is a bean with a notch and its vessels; a hand is a broad flat palm with four fingers in a row and, low on one side toward the wrist, a short thick thumb). The inside comes after, and never costs the outside a part.',
    'Its soft parts are drawn as one body, with a smooth join wherever two of them touch and layers under the skin where it is cut. So write each named part as its own object, with its own id, colour and a living material (skin, muscle, organ, vessel, fat, bone, cartilage, leaf, petal, fruit; fur, feathers and the shell of an insect are skin in their own colour), and make it overlap what it grows from: a finger, a vessel or a stem starts inside the palm, the chamber or the trunk; parts that only come near stay apart.',
    // Proportions, in the shapes the renderer draws best: a box of flesh is a rounded pad, pads in one plane run into one another, and a tube of skin through a few points has a joint at each.
    'Give each part its true proportions. A leaf, a petal or a fin is an extrude of its outline, thin. A human palm or sole is an extrude of its true outline, as thick as a finger is wide (about a quarter of its width), never a ball and not a box: a palm is broad across the knuckles and narrows to the wrist, and the wrist and forearm run on from it as outlines of their own in the same plane (a sole is broad at the ball and narrow at the heel). Let the outline do the work: the palm is a smooth pad, and any other mound (the heel of the little finger) is at most a broad, low blob sunk into it that shows only as a soft swelling, never a round bump; leave it out rather than make a lump. The knuckles are a gentle row of four low rounded rises, one at the root of each finger, never a band across the hand. A finger, a toe, a leg or a tail is a tube with a point at each joint, thinner toward its tip with a slight swelling at each joint (swell), each apart from its neighbours and fanned a little toward its tip. Keep the lengths true: the middle finger longest, about as long as the palm, the index and ring a little shorter, the little finger shortest and thinnest; a finger or toe is three stretches (four points); a thumb or big toe is two (three points), only about two thirds as long as the fingers and a quarter thicker at its root. A thumb starts inside the lower side of the palm, near the wrist, and points out and toward the viewer (give its points a z), never up beside the fingers; write the fleshy ball at its root as its own broad, low blob of skin that overlaps both the palm and the thumb. A limb with a muscular root (a thigh, a haunch, a tail base) gets that mass as its own blob in the same way.',
    'Put inner parts (a bone, a stone, airways) inside the part that holds them; a vessel, and a soft part made see-through with opacity, is drawn hollow with a wall.',
  ].join(' ');
}
