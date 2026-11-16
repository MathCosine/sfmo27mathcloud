// Turns dist-demo/ into a page the claude.ai Artifact host can serve: the page
// body only (the host adds <html>/<head>) with the app's files beside it.
import { readFileSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../dist-demo/', import.meta.url).pathname;

// The artifact host serves a fixed list of file types and .data isn't one, so
// PGlite's file-system bundle goes up as .wasm (the bytes are only fetched and read).
for (const f of readdirSync(join(dir, 'assets')).filter((x) => x.endsWith('.data'))) {
  const renamed = f.replace(/\.data$/, '-fs.wasm');
  renameSync(join(dir, 'assets', f), join(dir, 'assets', renamed));
  for (const js of readdirSync(join(dir, 'assets')).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(join(dir, 'assets', js), 'utf8');
    if (src.includes(f)) writeFileSync(join(dir, 'assets', js), src.split(f).join(renamed));
  }
}
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const js = /src="\.\/(assets\/index-[^"]+\.js)"/.exec(html)[1];
const css = /href="\.\/(assets\/index-[^"]+\.css)"/.exec(html)[1];
writeFileSync(
  join(dir, 'artifact.html'),
  `<title>SFMO 2027 Online</title>
<meta name="description" content="Demo of the SFMO 2027 online testing portal">
<link rel="stylesheet" href="${css}">
<div id="root"></div>
<script type="module" src="${js}"></script>
`,
);
const files = Object.fromEntries(
  readdirSync(join(dir, 'assets')).map((f) => [`assets/${f}`, `assets/${f}`]),
);
files['favicon.svg'] = 'favicon.svg';
writeFileSync(join(dir, 'artifact-files.json'), JSON.stringify(files, null, 1));
console.log(`artifact.html → ${js}, ${css}; ${Object.keys(files).length} files`);
