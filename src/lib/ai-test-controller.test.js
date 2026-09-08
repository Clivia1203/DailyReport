const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAiTestController } = require('./ai-test-controller');

test('切换 AI 平台会取消上一轮测试，并隔离旧请求的返回结果', () => {
  let cancelCount = 0;
  const controller = createAiTestController({ onCancel: () => { cancelCount += 1; } });

  const openAiRequest = controller.start();
  assert.equal(controller.isCurrent(openAiRequest), true);

  assert.equal(controller.cancel(), true);
  assert.equal(cancelCount, 1);
  assert.equal(controller.isCurrent(openAiRequest), false);

  const deepSeekRequest = controller.start();
  assert.equal(controller.isCurrent(deepSeekRequest), true);
  assert.equal(controller.finish(openAiRequest), false);
  assert.equal(controller.isCurrent(deepSeekRequest), true);
  assert.equal(controller.finish(deepSeekRequest), true);
  assert.equal(controller.isCurrent(deepSeekRequest), false);
});
