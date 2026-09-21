import { defineConfig } from 'vite';

const LOCALE_RELOAD = '    window.location.reload();';

function windowsReleaseAdapter() {
  let localePersistenceAdapted = false;
  return {
    name: 'tradeflow-windows-release-adapter',
    enforce: 'pre',
    transform(source, id) {
      const filename = id.split('?', 1)[0].replaceAll('\\', '/');
      if (!filename.endsWith('/src/main.ts')) return null;
      if (!source.includes(LOCALE_RELOAD)) throw new Error('Windows release locale persistence seam changed');
      localePersistenceAdapted = true;
      return source.replace(
        LOCALE_RELOAD,
        '    await workspaceStorage.flush();\n    window.location.reload();',
      );
    },
    buildEnd(error) {
      if (!error && !localePersistenceAdapted) {
        throw new Error('Windows release locale persistence was not applied');
      }
    },
  };
}

export default defineConfig({
  plugins: [windowsReleaseAdapter()],
});
