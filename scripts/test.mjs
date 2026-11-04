import {npm,run,root,python} from './runtime.mjs';
await npm(['test','--','--runInBand'],root+'/api');await npm(['test'],root+'/frontend');await run(python,['-m','pytest','-q'],{cwd:root+'/anomaly'});await run(process.execPath,[root+'/scripts/integration.mjs']);
