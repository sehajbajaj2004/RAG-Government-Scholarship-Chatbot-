import { defineConfig } from 'eslint/config';
import { flatConfig } from 'eslint-config-next';

export default defineConfig([
  flatConfig.recommended,
  { ignores: ['.next/**', 'node_modules/**'] },
]);
