// Trusted Node bridge for the exact production Worker driver. Guest source only
// enters QuickJS/WASM, never Node's JS runtime or eval.
import { parentPort } from 'node:worker_threads';
import { attachConnectorWorker } from '../src/user-data/runtime-worker.ts';
const port={onmessage:null,postMessage:message=>parentPort.postMessage(message),close:()=>parentPort.close()};
attachConnectorWorker(port);
parentPort.on('message',data=>port.onmessage?.({data}));
