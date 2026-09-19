// Point the X/social preview tags at your live domain.
//   node scripts/set-domain.mjs https://your-site.vercel.app
// X's crawler needs absolute image URLs, and it does not run JavaScript,
// so the domain has to be written into the HTML.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/set-domain.mjs https://your-site.com');
  process.exit(1);
}
let origin;
try {
  origin = new URL(input.includes('://') ? input : `https://${input}`).origin;
} catch {
  console.error(`Not a valid domain: ${input}`);
  process.exit(1);
}

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const pages = ['index.html', 'story.html', 'board.html'];
const tags = /(<meta\s+(?:property|name)="(?:og:image|og:url|twitter:image)"\s+content=")https?:\/\/[^"]*?(\/[^"]*)?(">)/g;

for (const page of pages) {
  const file = path.join(publicDir, page);
  const before = await readFile(file, 'utf8');
  const after = before.replace(tags, (_m, head, tail, close) => `${head}${origin}${tail || '/'}${close}`);
  if (after !== before) await writeFile(file, after);
  console.log(`${page}: ${after === before ? 'unchanged' : `preview tags -> ${origin}`}`);
}
console.log('\nAfter deploying, check the card at https://cards-dev.twitter.com/validator');
