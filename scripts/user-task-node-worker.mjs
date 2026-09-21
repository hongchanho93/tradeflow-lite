// Trusted bridge to the production driver; task source runs only inside QuickJS.
import { parentPort } from 'node:worker_threads';
import { attachTaskWorker } from '../src/user-task/runtime-worker.ts';
const port = { onmessage: null, postMessage: message => parentPort.postMessage(message), close: () => parentPort.close() };
attachTaskWorker(port);
parentPort.on('message', data => port.onmessage?.({ data }));
