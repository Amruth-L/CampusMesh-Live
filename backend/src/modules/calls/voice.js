// Trial TwiML is sanitized by Twilio. Keep spoken text directly inside Say
// so removing unsupported SSML children cannot remove the entire message.
function saySoft(node, text, { trial = false } = {}) {
  const voice = { voice: 'Polly.Aditi', language: 'en-IN' };
  if (trial) return node.say(voice, text);
  return node.say(voice, '').prosody({ rate: '90%', volume: 'soft' }, text);
}
module.exports = { saySoft };
