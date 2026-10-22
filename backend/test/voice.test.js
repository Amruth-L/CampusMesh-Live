const test = require('node:test');
const assert = require('node:assert/strict');
const { twiml: { VoiceResponse } } = require('twilio');
const { saySoft } = require('../src/modules/calls/voice');

test('trial speech survives removal of nested SSML and escapes item titles', () => {
  const response = new VoiceResponse();
  saySoft(response.gather({ numDigits: 1 }), 'CampusMesh: Camera & lens <kit>', { trial: true });
  const xml = response.toString();
  assert.match(xml, /<Say voice="Polly.Aditi" language="en-IN">CampusMesh: Camera &amp; lens &lt;kit&gt;<\/Say>/);
  assert.doesNotMatch(xml, /<prosody/);
});

test('full accounts retain the soft voice controls', () => {
  const response = new VoiceResponse();
  saySoft(response, 'Welcome to CampusMesh.');
  assert.match(response.toString(), /<prosody rate="90%" volume="soft">Welcome to CampusMesh\.<\/prosody>/);
});
