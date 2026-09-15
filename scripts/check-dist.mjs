import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';

const root = resolve(process.argv[2] || 'dist');
const base = process.env.QR_BASE_PATH || '/';
const html = await readFile(resolve(root, 'index.html'), 'utf8');
assert.match(html, /<title>Fynd QR/);
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const path = resolve(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Symlink in public artifact: ${path}`);
    if (entry.isDirectory()) await collect(path); else files.push(path);
  }
}
await collect(root);
for (const path of files) {
  const name = relative(root, path).replaceAll('\\', '/');
  assert.ok(!/(?:^|\/)(?:\.env|qa|src|work|node_modules|verified-downloads)(?:\.|\/|$)/i.test(name), `Non-site file: ${name}`);
  assert.ok(!/(?:ASSET_SOURCES|CUSTOMIZATION_REVIEW|\.map$)/i.test(name), `Local-only file: ${name}`);
  if (!['.js','.css','.html','.txt','.svg'].includes(extname(path))) continue;
  const content = await readFile(path, 'utf8');
  assert.ok(!/(?:drive\.google\.com|figma\.com|gofynd\.com|\/Users\/|slack\.com)/i.test(content), `Internal reference in ${name}`);
  if (extname(path) === '.html' || extname(path) === '.css') {
    const urls = extname(path) === '.html'
      ? [...content.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>m[1])
      : [...content.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(m=>m[1]);
    const documentUrl = `https://deployment.invalid${base}${name}`;
    for (const value of urls) {
      if (value.startsWith('data:')) continue;
      const url = new URL(value, documentUrl);
      assert.equal(url.origin, 'https://deployment.invalid', `Unexpected external asset: ${value}`);
      assert.ok(url.pathname.startsWith(base), `Asset escaped deployment base: ${value}`);
      await readFile(resolve(root, decodeURIComponent(url.pathname.slice(base.length))));
    }
  }
}
for (const path of ['logos/fynd.svg','logos/fynd.png','logos/impetus.png','fonts/fynd-sans-compact.woff2','fonts/inter-display-regular.ttf','THIRD_PARTY_NOTICES.txt','.nojekyll']) await readFile(resolve(root,path));
const javascript = (await Promise.all(files.filter(p=>p.endsWith('.js')).map(p=>readFile(p,'utf8')))).join('');
assert.ok(javascript.includes(`${base}logos/fynd.svg`), 'Brand URL does not use the deployment base');
assert.ok(javascript.includes(`${base}logos/fynd.png`) && javascript.includes(`${base}logos/impetus.png`), 'Preset URLs do not use the deployment base');
console.log(`Deployment artifact verified: ${files.length} files, base ${base}, local assets only, no review/private-source metadata.`);
