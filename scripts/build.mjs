import { npm, root } from './runtime.mjs';
import { buildNative } from './build-native.mjs';
await buildNative();
await npm(['run', 'build'], root + '/api');
await npm(['run', 'build'], root + '/frontend');
