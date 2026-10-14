const fs = require('node:fs');
const { parseEnv } = require('node:util');

const parsed = parseEnv(fs.readFileSync(process.env.STUDIO_PASSWORD_TEST_PATH, 'utf8'));
if (parsed.ADMIN_PASSWORD !== 'Test pass#42!' ||
    parsed.SESSION_SECRET === 'old' ||
    parsed.OTHER_SETTING !== 'preserved') {
  process.exitCode = 1;
}
