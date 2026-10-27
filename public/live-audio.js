class Microphone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      this.samples.push(...channel);
      if (this.samples.length >= 2048) {
        this.port.postMessage(new Float32Array(this.samples));
        this.samples = [];
      }
    }
    return true;
  }
}
registerProcessor("microphone", Microphone);
