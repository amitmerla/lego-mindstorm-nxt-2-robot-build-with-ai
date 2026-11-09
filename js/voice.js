// Hebrew speech in (Web Speech recognition) and out (speechSynthesis).
import { log } from './log.js';

const SR = self.SpeechRecognition || self.webkitSpeechRecognition;

export class Voice {
  constructor({ onInterim, onFinal, onState }) {
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onState = onState;
    this.listening = false;
    this.supported = !!SR;
    this.muted = false;
    if (!SR) log('voice', 'SpeechRecognition not supported in this browser');
  }

  start() {
    if (!SR || this.listening) return;
    const r = new SR();
    r.lang = 'he-IL';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    // Prefer on-device recognition when Chrome offers it (no audio leaves the device).
    if ('processLocally' in r) r.processLocally = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript.trim();
        if (res.isFinal) {
          log('voice', `heard: "${text}" (conf ${(res[0].confidence || 0).toFixed(2)})`);
          this.onFinal(text);
        } else {
          this.onInterim(text);
        }
      }
    };
    r.onerror = (e) => {
      log('voice', `error: ${e.error}`);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.stop();
    };
    r.onend = () => {
      // keep listening until the kid turns the mic off
      if (this.listening) { try { r.start(); } catch { /* already restarting */ } }
    };
    this.rec = r;
    this.listening = true;
    r.start();
    log('voice', 'listening (he-IL)…');
    this.onState(true);
  }

  stop() {
    this.listening = false;
    this.rec?.stop();
    this.onState(false);
    log('voice', 'mic off');
  }

  toggle() { this.listening ? this.stop() : this.start(); }

  speak(text) {
    if (this.muted || !self.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, ''));
    u.lang = 'he-IL';
    u.rate = 0.95;
    u.pitch = 1.1;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('he'));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }
}
