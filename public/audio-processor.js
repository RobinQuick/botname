// audio-processor.js
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input.length) return true;

        const channelData = input[0];

        // Fill buffer
        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.bufferIndex++] = channelData[i];

            if (this.bufferIndex >= this.bufferSize) {
                this.flush();
            }
        }

        return true;
    }

    flush() {
        // Convert Float32 to Int16
        const int16Data = new Int16Array(this.bufferSize);
        for (let i = 0; i < this.bufferSize; i++) {
            const s = Math.max(-1, Math.min(1, this.buffer[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send to main thread
        this.port.postMessage(int16Data.buffer, [int16Data.buffer]);

        this.bufferIndex = 0;
    }
}

registerProcessor('audio-processor', AudioProcessor);
