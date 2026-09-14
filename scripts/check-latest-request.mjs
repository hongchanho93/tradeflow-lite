import assert from 'node:assert/strict';

import { LatestRequestGate } from '../src/latest-request.ts';

const gate = new LatestRequestGate();
assert.equal(gate.current(), 0);
let displayed = '';

let releaseOlder;
const older = new Promise((resolve) => { releaseOlder = resolve; });
let releaseLatest;
const latest = new Promise((resolve) => { releaseLatest = resolve; });

async function load(label, response) {
  const generation = gate.begin();
  await response;
  if (gate.isCurrent(generation)) displayed = label;
}

const olderLoad = load('older', older);
const latestLoad = load('latest', latest);
releaseLatest();
await latestLoad;
releaseOlder();
await olderLoad;

assert.equal(displayed, 'latest', 'a late older response must not overwrite the latest selection');
console.log('Latest request gate OK');
