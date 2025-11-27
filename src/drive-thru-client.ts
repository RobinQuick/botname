// ============================================
// drive-thru-client.ts - Frontend Logic
// ============================================

// import { WebSocket } from 'ws'; // Note: In browser this uses native WebSocket


interface ClientConfig {
    serverUrl: string;
    testMode?: boolean;
    onOrderUpdate: (order: any) => void;
    onTranscript: (role: string, text: string) => void;
    onStatusChange: (status: string) => void;
}

export class DriveThruClient {
    private ws: WebSocket | null = null;
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private audioWorkletNode: AudioWorkletNode | null = null;
    private audioQueue: Float32Array[] = [];
    private isPlaying: boolean = false;
    private nextStartTime: number = 0;

    constructor(private config: ClientConfig) { }

    async connect(): Promise<void> {
        this.config.onStatusChange('connecting');

        try {
            const url = this.config.testMode
                ? `${this.config.serverUrl}?mode=test`
                : this.config.serverUrl;

            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.config.onStatusChange('connected');
                this.initAudio();
            };

            this.ws.onmessage = async (event) => {
                if (event.data instanceof Blob) {
                    // Audio data
                    const arrayBuffer = await event.data.arrayBuffer();
                    this.handleAudioFromServer(arrayBuffer);
                } else {
                    // JSON message
                    try {
                        const message = JSON.parse(event.data as string);
                        this.handleServerMessage(message);
                    } catch (e) {
                        console.error('Failed to parse message', e);
                    }
                }
            };

            this.ws.onclose = () => {
                this.config.onStatusChange('disconnected');
                this.stopAudioCapture();
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.config.onStatusChange('error');
            };

        } catch (error) {
            console.error('Connection failed:', error);
            this.config.onStatusChange('error');
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.stopAudioCapture();
    }

    private async initAudio(): Promise<void> {
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 24000 // OpenAI Realtime API standard
            });
            this.audioContext = audioContext;

            // Resume AudioContext (required for browser autoplay policy)
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log('AudioContext resumed');
            }

            await audioContext.audioWorklet.addModule('/audio-processor.js');

            // Check if disconnected during await
            if (!this.audioContext) {
                audioContext.close();
                return;
            }

            const mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 24000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            this.mediaStream = mediaStream;

            // Check if disconnected during await
            if (!this.audioContext) {
                mediaStream.getTracks().forEach(track => track.stop());
                audioContext.close();
                return;
            }

            const source = audioContext.createMediaStreamSource(mediaStream);
            this.audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');

            this.audioWorkletNode.port.onmessage = (event) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(event.data);
                }
            };

            source.connect(this.audioWorkletNode);
            this.audioWorkletNode.connect(audioContext.destination); // For monitoring if needed, usually mute

            console.log('Audio initialized successfully', {
                sampleRate: audioContext.sampleRate,
                state: audioContext.state
            });

        } catch (error) {
            console.error('Audio initialization failed:', error);
            this.config.onStatusChange('audio_error');
        }
    }

    private stopAudioCapture() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    private handleAudioFromServer(data: ArrayBuffer) {
        // Convert PCM16 to Float32
        const int16Array = new Int16Array(data);
        const float32Array = new Float32Array(int16Array.length);

        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 0x8000;
        }

        this.audioQueue.push(float32Array);

        if (!this.isPlaying) {
            this.playNextChunk();
        }
    }

    private async playNextChunk() {
        if (this.audioQueue.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const chunk = this.audioQueue.shift()!;

        if (!this.audioContext) return;

        // Ensure AudioContext is running
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            console.log('AudioContext resumed for playback');
        }

        const audioBuffer = this.audioContext.createBuffer(
            1,
            chunk.length,
            this.audioContext.sampleRate
        );

        audioBuffer.copyToChannel(chunk, 0);

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);

        // Schedule playback
        const currentTime = this.audioContext.currentTime;
        const startTime = Math.max(currentTime, this.nextStartTime);
        source.start(startTime);
        this.nextStartTime = startTime + audioBuffer.duration;

        console.log('Playing audio chunk', {
            length: chunk.length,
            duration: audioBuffer.duration,
            contextState: this.audioContext.state
        });

        source.onended = () => {
            this.playNextChunk();
        };
    }

    private handleServerMessage(message: any) {
        switch (message.type) {
            case 'order_update':
                this.config.onOrderUpdate(message.order);
                break;
            case 'transcript':
                this.config.onTranscript(message.role, message.text);
                break;
        }
    }

    // Controls
    interrupt() {
        if (this.ws) {
            this.ws.send(JSON.stringify({ type: 'interrupt' }));
        }
        // Clear local audio queue
        this.audioQueue = [];
        this.nextStartTime = 0;
    }

    forceReply() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'force_reply' }));
        }
    }

    identifyCustomer(qrCode: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'identify_customer', qrCode }));
        }
    }
}
