import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run, cmake, root } from './runtime.mjs';
export async function buildNative() {
  await run(cmake, ['-S', root, '-B', root + '/build', '-DCMAKE_BUILD_TYPE=Release']);
  await run(cmake, ['--build', root + '/build', '--config', 'Release', '--parallel', '2']);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  await buildNative();
