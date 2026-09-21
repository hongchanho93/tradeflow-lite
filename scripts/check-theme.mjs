import assert from 'node:assert/strict';

import {
  APP_THEME_STORAGE_KEY,
  appThemePalette,
  loadAppTheme,
  saveAppTheme,
} from '../src/theme.ts';

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};

assert.equal(loadAppTheme(storage), 'dark');
assert.equal(saveAppTheme(storage, 'light'), true);
assert.equal(values.get(APP_THEME_STORAGE_KEY), 'light');
assert.equal(loadAppTheme(storage), 'light');
values.set(APP_THEME_STORAGE_KEY, 'system');
assert.equal(loadAppTheme(storage), 'dark', 'unsupported themes must fail closed to dark');
assert.equal(saveAppTheme({ setItem: () => { throw new Error('quota'); } }, 'dark'), false);
assert.equal(appThemePalette('dark').background, '#000000');
assert.equal(appThemePalette('light').background, '#ffffff');
assert.notEqual(appThemePalette('dark').grid, appThemePalette('light').grid);

console.log('App theme state OK');
