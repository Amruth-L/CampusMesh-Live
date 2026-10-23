/* AudioWorklet: converts microphone samples to transport PCM, not speech recognition. */
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(1024);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      const value = Math.max(-1, Math.min(1, sample));
      this.samples[this.offset++] = value < 0 ? value * 32768 : value * 32767;
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(1024);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("campusmesh-voice-capture", VoiceCapture);
