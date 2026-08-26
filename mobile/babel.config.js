const fs = require('fs');
const path = require('path');

function parseEnvFile() {
  const envPath = path.resolve(__dirname, '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        env[key] = val;
      }
    }
  }
  return env;
}

module.exports = function (api) {
  if (api && api.cache) {
    api.cache(false);
  }
  const fileEnv = parseEnvFile();
  // Jest needs runtime process.env mutation to exercise configuration logic.
  const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
  const apiBaseUrl = isTest ? undefined : (process.env.API_BASE_URL || fileEnv.API_BASE_URL);
  const googleMapsApiKey = isTest ? undefined : (process.env.GOOGLE_MAPS_API_KEY || fileEnv.GOOGLE_MAPS_API_KEY);

  const plugins = [];

  // Plugin to inject environment variables at build time
  plugins.push([
    function ({ types: t }) {
      return {
        visitor: {
          MemberExpression(nodePath) {
            // Never replace assignment/update targets; tests intentionally set
            // process.env values at runtime.
            const isWriteTarget = nodePath.parentPath.isAssignmentExpression() && nodePath.parentKey === 'left';
            if (!isWriteTarget && nodePath.matchesPattern('process.env.API_BASE_URL') && apiBaseUrl) {
              nodePath.replaceWith(t.stringLiteral(apiBaseUrl));
            } else if (nodePath.matchesPattern('process.env.GOOGLE_MAPS_API_KEY') && googleMapsApiKey) {
              nodePath.replaceWith(t.stringLiteral(googleMapsApiKey));
            }
          },
        },
      };
    },
  ]);

  return {
    presets: ['module:@react-native/babel-preset'],
    plugins,
  };
};

