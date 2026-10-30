import { classifyGesture } from './gesture-recognition.js';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const STABLE_FRAMES = 3;
const LOST_GRACE_MS = 320;

export class HandTracker {
  constructor({ onFrame, onGesture, onStatus }) {
    this.onFrame = onFrame;
    this.onGesture = onGesture;
    this.onStatus = onStatus;
    this.stream = null;
    this.detector = null;
    this.video = null;
    this.running = false;
    this.startPromise = null;
    this.timer = 0;
    this.smoothed = new Map();
    this.gestures = new Map();
    this.lastSeen = new Map();
    this.lastHandAt = 0;
    this.generation = 0;
  }

  async start(video) {
    if (this.running && this.detector && this.stream?.active) return true;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.initialize(video).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async initialize(video) {
    const generation = ++this.generation;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not provide webcam access.');
    }
    if (!window.isSecureContext) {
      throw new Error('Webcam access requires HTTPS or http://localhost.');
    }
    if (!window.tf || !window.handPoseDetection || !window.Hands) {
      throw new Error('TensorFlow.js or the MediaPipe Hands model did not load. Check your internet connection and reload.');
    }

    this.video = video;
    if (!this.stream?.active) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.stream = stream;
    }
    const activeStream = this.stream;
    activeStream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (!this.running || this.stream !== activeStream) return;
        this.running = false;
        window.clearTimeout(this.timer);
        this.gestures.clear();
        this.smoothed.clear();
        this.onFrame([], { detected: false, lostFor: 0 });
        this.onStatus('camera-ended');
      }, { once: true });
    });

    video.srcObject = this.stream;
    await video.play();
    await this.waitForVideo(video);
    if (generation !== this.generation) return false;

    if (!this.detector) {
      this.onStatus('loading');
      await window.tf.ready();
      const detector = await window.handPoseDetection.createDetector(
        window.handPoseDetection.SupportedModels.MediaPipeHands,
        {
          runtime: 'mediapipe',
          solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
          modelType: 'full',
          maxHands: 2,
        }
      );
      if (generation !== this.generation) {
        await detector.dispose();
        return false;
      }
      this.detector = detector;
    }

    if (!this.stream?.active) throw new Error('The webcam disconnected during setup. Reconnect it and retry.');
    this.running = true;
    this.onStatus('ready');
    this.schedule(0);
    return true;
  }

  async waitForVideo(video) {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) return;
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for a webcam frame.'));
      }, 10000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeEventListener('loadeddata', ready);
        video.removeEventListener('error', failed);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('The browser could not read a frame from the webcam.'));
      };
      video.addEventListener('loadeddata', ready, { once: true });
      video.addEventListener('error', failed, { once: true });
    });
  }

  schedule(delay) {
    if (this.running) this.timer = window.setTimeout(() => this.detect(), delay);
  }

  async detect() {
    if (!this.running || !this.detector || !this.video || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.schedule(80);
      return;
    }

    const now = performance.now();
    try {
      const predictions = await this.detector.estimateHands(this.video);
      const hands = [];
      const seen = new Set();
      const width = this.video.videoWidth || 640;
      const height = this.video.videoHeight || 480;

      (predictions || []).slice(0, 2).forEach((prediction, index) => {
        const points = prediction.keypoints || prediction.landmarks;
        if (!points || points.length !== 21) return;
        const label = prediction.handedness || prediction.handednesses?.[0]?.displayName || `hand-${index}`;
        const key = String(label);
        seen.add(key);
        const previous = this.smoothed.get(key);
        const landmarks = points.map((point, pointIndex) => {
          const next = { x: point.x / width, y: point.y / height };
          const old = previous?.[pointIndex];
          return old ? {
            x: old.x * 0.42 + next.x * 0.58,
            y: old.y * 0.42 + next.y * 0.58,
          } : next;
        });
        this.smoothed.set(key, landmarks);
        this.lastSeen.set(key, now);
        hands.push({
          key,
          landmarks,
          confidence: Number.isFinite(prediction.score) ? prediction.score : 0.85,
        });
      });

      for (const [key, state] of this.gestures) {
        if (!seen.has(key) && now - (this.lastSeen.get(key) || 0) > LOST_GRACE_MS) {
          this.advanceGesture(key, 'neutral', 0, null, now);
          if (state.stable === 'neutral' && now - (this.lastSeen.get(key) || 0) > 1500) {
            this.gestures.delete(key);
            this.smoothed.delete(key);
            this.lastSeen.delete(key);
          }
        }
      }

      for (const hand of hands) {
        const result = classifyGesture(hand.landmarks, hand.confidence);
        this.advanceGesture(hand.key, result.label, result.confidence, hand, now);
      }

      this.lastHandAt = hands.length ? now : this.lastHandAt;
      this.onFrame(hands, {
        detected: hands.length > 0,
        lostFor: hands.length ? 0 : now - this.lastHandAt,
      });
      this.onStatus('tracking');
    } catch (error) {
      console.warn('Hand tracking inference failed; retrying on the next frame.', error);
      this.onStatus('tracking-error');
      this.onFrame([], { detected: false, lostFor: now - this.lastHandAt });
    }
    this.schedule(35);
  }

  advanceGesture(key, label, confidence, hand, now) {
    const state = this.gestures.get(key) || {
      candidate: 'neutral',
      frames: 0,
      stable: 'neutral',
      lastHand: hand,
    };
    const recognized = confidence >= 0.38 ? label : 'neutral';
    if (recognized === state.candidate) state.frames += 1;
    else {
      state.candidate = recognized;
      state.frames = 1;
    }
    state.lastHand = hand || state.lastHand;

    if (state.frames >= STABLE_FRAMES && state.stable !== recognized) {
      const previous = state.stable;
      state.stable = recognized;
      if (previous !== 'neutral') {
        this.onGesture({ gesture: previous, phase: 'end', hand: state.lastHand, key });
      }
      if (recognized !== 'neutral') {
        this.onGesture({ gesture: recognized, phase: 'start', hand: state.lastHand, key });
      }
    } else if (state.frames >= STABLE_FRAMES && state.stable !== 'neutral' && hand) {
      this.onGesture({ gesture: state.stable, phase: 'hold', hand, key });
    }
    this.gestures.set(key, state);
  }

  stop() {
    this.generation += 1;
    this.running = false;
    window.clearTimeout(this.timer);
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this.gestures.clear();
    this.smoothed.clear();
  }
}

export function getHandConnections() {
  return CONNECTIONS;
}
