import { readFile, writeFile } from 'node:fs/promises';

// Ship license notices, never local review notes or internal asset-library links.
const notices = (await readFile(new URL('../THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8'))
  .replace(' See ASSET_SOURCES.md for provenance.', '');
await writeFile(new URL('../dist/THIRD_PARTY_NOTICES.txt', import.meta.url), notices);
await writeFile(new URL('../dist/.nojekyll', import.meta.url), '');
