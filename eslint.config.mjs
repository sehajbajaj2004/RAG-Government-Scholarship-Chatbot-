// eslint-config-next ships its flat config as the default export — an array of
// config objects, spread in here rather than referenced as a named export.
import next from 'eslint-config-next';

const config = [
  ...next,
  { ignores: ['.next/**', 'node_modules/**'] },
];

export default config;
