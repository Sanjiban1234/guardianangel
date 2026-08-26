import fs from 'fs';
import path from 'path';

const source = (relativePath: string) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('GA-07 runtime logging guard', () => {
  it.each([
    'src/sockets/RideSocketController.ts',
    'src/handlers/SessionHandler.ts',
    'src/handlers/DisconnectHandler.ts',
    'src/handlers/RideStartHandler.ts',
    'src/handlers/BulkSyncHandler.ts',
  ])('%s does not interpolate identifiers into console logs', (file) => {
    const contents = source(file);
    expect(contents).not.toMatch(/console\.(?:log|warn|error|info)\([^\n]*(?:socket\.id|groupCode|group_code|userId|name)/);
    expect(contents).not.toMatch(/console\.(?:log|warn|error|info)\([^\n]*,\s*(?:err|error|payload|data)\b/);
  });
});
