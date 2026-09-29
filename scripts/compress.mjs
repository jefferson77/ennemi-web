// Pre-compresses the text assets in dist/ with gzip (level 9) and brotli (level 11), so nginx
// can serve them with gzip_static / brotli_static instead of compressing on every request.
// Runs as `postbuild`. Uses node:zlib only, so no brotli or gzip binary is needed on the host.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const OUTPUT_DIR = 'dist';
const COMPRESSIBLE = /\.(html|js|css|svg|json|txt)$/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

let count = 0;
for await (const file of walk(OUTPUT_DIR)) {
  if (!COMPRESSIBLE.test(file)) continue;
  const source = await readFile(file);
  const gz = gzipSync(source, { level: 9 });
  const br = brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  await writeFile(`${file}.gz`, gz);
  await writeFile(`${file}.br`, br);
  console.log(`✓ ${file}: ${source.length} → gzip: ${gz.length} / brotli: ${br.length}`);
  count++;
}
console.log(`Pre-compressed ${count} file(s).`);
