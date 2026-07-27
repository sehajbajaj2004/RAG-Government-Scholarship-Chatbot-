import { embedQuery } from './lib/embeddings.js';
import { getQdrant } from './lib/qdrant.js';
import { buildPrompt } from './lib/prompt.js';
import { QDRANT_COLLECTION, TOP_K } from './lib/config.js';

const q = process.argv[2];
const vector = await embedQuery(q);
const matches = await getQdrant().search(QDRANT_COLLECTION, { vector, limit: TOP_K, with_payload: true });
const prompt = buildPrompt(q, matches);

console.log('total prompt characters:', prompt.length);
console.log('chunks in context:', matches.length);
console.log('='.repeat(78));
// Print the skeleton: everything except the bulk of each chunk body.
const lines = prompt.split('\n');
let inChunk = false, shown = 0;
for (const line of lines) {
  if (/^\[\d+\] /.test(line)) { inChunk = true; shown = 0; console.log(line); continue; }
  if (line === '---' || line === '--- END CONTEXT ---') { inChunk = false; console.log(line); continue; }
  if (inChunk) {
    if (shown < 2) { console.log('    ' + line.slice(0, 90)); shown++; }
    else if (shown === 2) { console.log('    … <rest of chunk body> …'); shown++; }
    continue;
  }
  console.log(line);
}
