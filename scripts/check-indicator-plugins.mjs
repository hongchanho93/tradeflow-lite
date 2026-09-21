import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pluginRoot = join(projectRoot, 'src/indicator-plugins');
const pluginIndexPath = join(pluginRoot, 'index.ts');
const pluginIndexSource = readFileSync(pluginIndexPath, 'utf8');
const builtinIndexSource = readFileSync(join(pluginRoot, 'builtins/index.ts'), 'utf8');

const forbiddenGlobalStyleImport = /\b(?:import|export)\s+(?:(?:[^'";\n]+?)\s+from\s+)?['"][^'"]+\.(?:css|scss|less)(?:\?[^'"]*)?['"]/m;

function hasForbiddenGlobalStyleImport(source) {
  return forbiddenGlobalStyleImport.test(source);
}

function hasTopLevelAwait(source) {
  let braceDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === quote) break;
        index += 1;
      }
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      const lineEnd = source.indexOf('\n', index + 2);
      index = lineEnd < 0 ? source.length : lineEnd;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd < 0 ? source.length : commentEnd + 1;
      continue;
    }
    if (character === '{') {
      braceDepth += 1;
      continue;
    }
    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (!/[A-Za-z_$]/.test(character)) continue;
    let end = index + 1;
    while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) end += 1;
    if (braceDepth === 0 && source.slice(index, end) === 'await') return true;
    index = end - 1;
  }
  return false;
}

assert.equal(
  hasForbiddenGlobalStyleImport("import './indicator.css';"),
  true,
  'static CSS imports must be detected',
);
assert.equal(
  hasForbiddenGlobalStyleImport("import styles from './indicator.scss';"),
  true,
  'named global SCSS imports must be detected',
);
assert.equal(
  hasForbiddenGlobalStyleImport("const stylesheet = './indicator.less';"),
  false,
  'a string mentioning a style file is not an import',
);
assert.equal(hasTopLevelAwait("const text = 'await'; // await\n"), false);
assert.equal(hasTopLevelAwait("async function load() { await import('./late.ts'); }"), false);
assert.equal(hasTopLevelAwait("const module = await import('./late.ts');"), true);

assert.match(
  pluginIndexSource,
  /import\.meta\.glob<IndicatorModule>\('\.\/user\/\*\.indicator\.ts'\)/,
  'user indicators must be discovered by the expected Vite glob',
);
assert.match(
  pluginIndexSource,
  /import\.meta\.glob<IndicatorModule>\('\.\/contributed\/\*\.indicator\.ts'\)/,
  'contributed indicators must be discovered by the expected Vite glob',
);
assert.match(pluginIndexSource, /Promise\.all\(Object\.entries\(modules\)\.map\(async/);
assert.match(pluginIndexSource, /\.sort\(\(left, right\) => left\.file\.localeCompare\(right\.file\)\)/,
  'successfully loaded plugins must register in deterministic file order');
assert.match(pluginIndexSource, /for \(const \{ file, module \} of successful\)[\s\S]*registry\.register\(module\.default\)/,
  'registration happens only after deterministic loading order is established');
assert.match(pluginIndexSource, /return \{ file, error \} satisfies IndicatorPluginLoadFailure/);
assert.equal(hasForbiddenGlobalStyleImport(pluginIndexSource), false);
assert.equal(hasTopLevelAwait(pluginIndexSource), false, 'plugin index only awaits inside its async loader');

for (const builtinId of ['ma', 'ema', 'boll', 'macd', 'rsi']) {
  assert.match(builtinIndexSource, new RegExp(`import ${builtinId} from './${builtinId}\\.indicator'`));
  const source = readFileSync(join(pluginRoot, 'builtins', `${builtinId}.indicator.ts`), 'utf8');
  assert.match(source, new RegExp(`id: 'builtin\\.${builtinId}'`));
  assert.match(source, /apiVersion: 1/);
  assert.match(source, new RegExp(`indicatorVersion: ${['ma','ema'].includes(builtinId) ? 2 : 1}`));
  if (['ma','ema'].includes(builtinId)) {
    assert.match(source, /sourceResolution/);
    assert.match(source, /dataRequests\(inputs, selection\)/);
    assert.match(source, /context\.data\.get\('source'\)/);
  }
  assert.match(source, /create\(/);
}

for (const directoryName of ['user', 'contributed']) {
  const directory = join(pluginRoot, directoryName);
  for (const fileName of readdirSync(directory).filter((name) => name.endsWith('.indicator.ts'))) {
    const source = readFileSync(join(directory, fileName), 'utf8');
    assert.equal(
      hasForbiddenGlobalStyleImport(source),
      false,
      `${directoryName}/${fileName} must not import CSS/SCSS/Less globally; use overlay.setStyles()`,
    );
    assert.equal(
      hasTopLevelAwait(source),
      false,
      `${directoryName}/${fileName} must not use top-level await`,
    );
  }
}

console.log('Indicator plugin discovery, builtins, and source-boundary checks passed');
