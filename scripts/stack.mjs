import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Processes,root,native,python,json,waitFor,assertPortAvailable} from './runtime.mjs';
export async function startStack({directory,apiPort=3000,queuePort=8081,anomalyPort=5000,frontendPort=3001,ui=false,anomaly=false,quiet=false,leaseSeconds=30,capacity=500000}) {
 await mkdir(directory,{recursive:true});const file=path.join(directory,'events.ndjson');await writeFile(file,'',{flag:'a'});
 const processes=new Processes(directory,quiet),apiUrl='http://127.0.0.1:'+apiPort,queueUrl='http://127.0.0.1:'+queuePort,dbPath=path.join(directory,'logs.db');
 const startQueue=()=>processes.start('queue',native('log_queue'),['--db',path.join(directory,'queue.db'),'--port',String(queuePort),'--lease-seconds',String(leaseSeconds),'--capacity',String(capacity)]);
 const startApi=()=>processes.start('api',process.execPath,[root+'/api/dist/index.js'],{env:{DB_PATH:dbPath,QUEUE_URL:queueUrl,PORT:String(apiPort),HOST:'127.0.0.1'}});
 const startAgent=()=>processes.start('agent',native('log_agent'),['--file',file,'--checkpoint',path.join(directory,'agent.checkpoint.json'),'--queue-port',String(queuePort),'--batch-size','2048']);
 try {
  for(const port of [apiPort,queuePort,...(ui?[frontendPort]:[]),...(anomaly?[anomalyPort]:[])])await assertPortAvailable(port);
  const queue=startQueue();await waitFor(()=>{processes.assertHealthy();return json(queueUrl+'/health');},30000,'queue');
  const api=startApi();await waitFor(()=>{processes.assertHealthy();return json(apiUrl+'/health');},30000,'API');
  const agent=startAgent();
  if(anomaly){processes.start('anomaly',python,['-m','uvicorn','src.main:app','--host','127.0.0.1','--port',String(anomalyPort)],{cwd:root+'/anomaly',env:{DB_PATH:dbPath,MODEL_PATH:path.join(directory,'model.pkl'),POLL_INTERVAL_SECONDS:'1',BATCH_SIZE:'5000'}});await waitFor(()=>{processes.assertHealthy();return json('http://127.0.0.1:'+anomalyPort+'/health');},60000,'detector');}
  if(ui){processes.start('frontend',process.execPath,[root+'/frontend/node_modules/next/dist/bin/next','dev','--hostname','0.0.0.0','--port',String(frontendPort)],{cwd:root+'/frontend',env:{API_INTERNAL_URL:apiUrl,ANOMALY_INTERNAL_URL:'http://127.0.0.1:'+anomalyPort}});await waitFor(async()=>{processes.assertHealthy();return(await fetch('http://127.0.0.1:'+frontendPort,{signal:AbortSignal.timeout(10000)})).ok;},90000,'dashboard');}
  return {processes,apiUrl,queueUrl,file,directory,dbPath,queue,api,agent,startQueue,startApi,startAgent};
 } catch(error){await processes.stop();throw error;}
}
