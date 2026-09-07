const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const trayPath = path.join(__dirname, '..', 'assets', 'tray.png');

test('专用托盘图标是透明背景的 32px PNG', () => {
  const bytes = fs.readFileSync(trayPath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 32);
  assert.equal(bytes.readUInt32BE(20), 32);
});
