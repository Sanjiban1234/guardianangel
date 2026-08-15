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
  const apiBaseUrl = process.env.API_BASE_URL || fileEnv.API_BASE_URL;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || fileEnv.GOOGLE_MAPS_API_KEY;

  const plugins = [];

  // Plugin to inject environment variables at build time
  plugins.push([
    function ({ types: t }) {
      return {
        visitor: {
          MemberExpression(nodePath) {
            if (nodePath.matchesPattern('process.env.API_BASE_URL') && apiBaseUrl) {
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

