export class AudioEngine {
  constructor() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = AudioContext ? new AudioContext() : null;
    this.master = this.context?.createGain() || null;
    if (this.master) {
      this.master.gain.value = 0.22;
      this.master.connect(this.context.destination);
    }
  }

  setVolume(value) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, value));
  }

  async unlock() {
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  cast(spell) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const notes = {
      fireball: [135, 250, 90],
      shield: [220, 330, 440],
      lightning: [820, 380, 1100],
      telekinesis: [310, 460, 620],
    }[spell];
    if (!notes) return;

    const wave = spell === 'lightning' ? 'square' : spell === 'fireball' ? 'sawtooth' : 'sine';
    const duration = spell === 'lightning' ? 0.16 : 0.34;
    notes.forEach((frequency, index) => {
      const start = now + index * (spell === 'lightning' ? 0.035 : 0.07);
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * 0.52), start + duration);
      gain.gain.setValueAtTime(index === 0 ? 0.18 : 0.08, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + duration);
    });

    if (spell === 'lightning' || spell === 'fireball') this.noise(spell === 'lightning' ? 0.085 : 0.2);
  }

  hit() {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(210, now);
    oscillator.frequency.exponentialRampToValueAtTime(70, now + 0.12);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.14);
  }

  noise(duration) {
    if (!this.context || !this.master) return;
    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.12;
    source.connect(gain);
    gain.connect(this.master);
    source.start();
  }
}
