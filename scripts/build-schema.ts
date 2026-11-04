// Writes docs/scene.schema.json and docs/scene.schema.lean.json from the scene table.
// Run: node scripts/build-schema.ts
import { writeFileSync } from 'node:fs';
import { sceneSchema, sceneSchemaLean } from '../src/scene/index.ts';

for (const [file, schema] of [['scene.schema.json', sceneSchema], ['scene.schema.lean.json', sceneSchemaLean]] as const) {
  const out = new URL(`../docs/${file}`, import.meta.url);
  writeFileSync(out, JSON.stringify(schema, null, 2) + '\n');
  console.log(`wrote ${file}`);
}
