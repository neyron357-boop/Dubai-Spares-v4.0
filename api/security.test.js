import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasValidSecret, isAllowedPushEndpoint } from './security.js';

test('push endpoint validation prevents requests to private and arbitrary servers', () => {
  for (const endpoint of ['http://fcm.googleapis.com/send/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data',
    'https://fcm.googleapis.com.evil.test/x', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', null]) {
    assert.equal(isAllowedPushEndpoint(endpoint), false);
  }
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/example'), true);
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/example'), true);
  assert.equal(isAllowedPushEndpoint('https://wns2-am3p.notify.windows.com/example'), true);
});

test('authentication requires an exact nonempty key', () => {
  assert.equal(hasValidSecret('correct', 'correct'), true);
  assert.equal(hasValidSecret('wrong', 'correct'), false);
  assert.equal(hasValidSecret('', ''), false);
  assert.equal(hasValidSecret(undefined, 'correct'), false);
});
