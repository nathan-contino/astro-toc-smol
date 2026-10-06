import { workerData, parentPort } from 'node:worker_threads';
import { processFile } from './process.js';

for (const file of workerData.files) processFile(file, workerData.articleSelectors);
parentPort.postMessage('done');
