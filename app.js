import { AudioEngine } from './audio.js';
import { ArenaGame } from './game.js';
import { getHandConnections, HandTracker } from './hand-tracking.js';

const HIGH_SCORE_KEY = 'spellcaster-arena-best-v1';
const SPELL_COOLDOWNS = { fireball: 0.72, shield: 4.4, lightning: 1.8, telekinesis: 2.2 };
const GESTURE_NAMES = {
  fist: 'Fireball',
  'open-palm': 'Magic shield',
  'two-fingers': 'Lightning',
  pinch: 'Telekinesis',
};

const elements = {
  screens: {
    menu: document.getElementById('menu-screen'),
    calibration: document.getElementById('calibration-screen'),
    game: document.getElementById('game-screen'),
    gameover: document.getElementById('gameover-screen'),
  },
  video: document.getElementById('camera-feed'),
  gameVideo: document.getElementById('game-camera'),
  overlay: document.getElementById('hand-overlay'),
  cameraStatus: document.getElementById('camera-status'),
  modelStatus: document.getElementById('model-status'),
  cameraHelp: document.getElementById('camera-help'),
  trackingBadge: document.getElementById('tracking-badge'),
  trackingText: document.getElementById('tracking-text'),
  gestureStatus: document.getElementById('gesture-status'),
  startGame: document.getElementById('start-game'),
  keyboardStart: document.getElementById('keyboard-start'),
  gameTracking: document.getElementById('game-tracking'),
  gameTrackingText: document.getElementById('game-tracking-text'),
  gameMessage: document.getElementById('game-message'),
  previewSetting: document.getElementById('preview-setting'),
  volume: document.getElementById('sfx-volume'),
};

const audio = new AudioEngine();
const handOverlayContext = elements.overlay.getContext('2d');
let currentScreen = 'menu';
let previewEnabled = true;
let messageTimer = 0;
let usedCameraForRun = false;
let bestScore = readBestScore();
audio.setVolume(Number(elements.volume.value) / 100);

const game = new ArenaGame(document.getElementById('game-canvas'), audio, {
  onHud: updateHud,
  onGameOver: finishRun,
  onMessage: showMessage,
});

const tracker = new HandTracker({
  onFrame: drawHands,
  onGesture: handleGesture,
  onStatus: updateTrackingStatus,
});

document.getElementById('menu-best-score').textContent = formatScore(bestScore);
bindControls();

function bindControls() {
  document.getElementById('play-button').addEventListener('click', enterCalibration);
  document.getElementById('how-to-button').addEventListener('click', () => openDialog('how-to-dialog'));
  document.getElementById('settings-button').addEventListener('click', () => openDialog('settings-dialog'));
  document.getElementById('enable-camera').addEventListener('click', initializeCamera);
  elements.startGame.addEventListener('click', () => startGame(true));
  elements.keyboardStart.addEventListener('click', () => startGame(false));
  document.getElementById('preview-toggle').addEventListener('click', () => setPreview(!previewEnabled));
  document.getElementById('game-preview-toggle').addEventListener('click', () => setPreview(!previewEnabled));
  elements.previewSetting.checked = previewEnabled;
  elements.previewSetting.addEventListener('change', (event) => setPreview(event.currentTarget.checked));
  elements.volume.addEventListener('input', (event) => {
    audio.setVolume(Number(event.currentTarget.value) / 100);
  });
  document.getElementById('restart-button').addEventListener('click', restartRun);
  document.getElementById('menu-button').addEventListener('click', returnToMenu);
  document.getElementById('leave-game').addEventListener('click', returnToMenu);
  document.querySelectorAll('[data-screen="menu"]').forEach((button) => button.addEventListener('click', returnToMenu));
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', closeDialog));
  document.getElementById('dialog-backdrop').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeDialog();
  });
  document.querySelectorAll('[data-spell]').forEach((button) => {
    button.addEventListener('click', async () => {
      await audio.unlock();
      game.castManual(button.dataset.spell);
    });
  });

  const canvas = document.getElementById('game-canvas');
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    game.setAim(
      ((event.clientX - rect.left) / rect.width) * game.width,
      ((event.clientY - rect.top) / rect.height) * game.height
    );
  });
  canvas.addEventListener('click', async () => {
    if (currentScreen !== 'game') return;
    await audio.unlock();
    game.castManual('fireball');
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', () => game.resize());
  window.addEventListener('beforeunload', () => tracker.stop(), { once: true });
}

function enterCalibration() {
  showScreen('calibration');
  initializeCamera();
}

async function initializeCamera() {
  const button = document.getElementById('enable-camera');
  button.disabled = true;
  button.textContent = 'Connecting…';
  elements.cameraHelp.textContent = 'Requesting permission and loading the MediaPipe hand model…';
  elements.keyboardStart.classList.add('hidden');
  try {
    const ready = await tracker.start(elements.video);
    if (!ready) return;
    elements.gameVideo.srcObject = tracker.stream;
    await elements.gameVideo.play();
    document.getElementById('preview-placeholder').classList.add('hidden');
    button.textContent = 'Camera ready';
    elements.startGame.disabled = false;
    elements.cameraHelp.textContent = 'Model ready. Show each gesture to test it, then enter the arena.';
  } catch (error) {
    console.error('Camera or hand model initialization failed.', error);
    elements.cameraStatus.textContent = error.name === 'NotAllowedError' ? 'Permission denied' : 'Unavailable';
    elements.cameraStatus.dataset.state = 'error';
    elements.modelStatus.textContent = window.handPoseDetection ? 'Not ready' : 'CDN unavailable';
    elements.modelStatus.dataset.state = 'error';
    elements.cameraHelp.textContent = error.message || 'Camera setup failed. Check your webcam and network, then retry.';
    document.getElementById('preview-placeholder').classList.remove('hidden');
    elements.keyboardStart.classList.remove('hidden');
    button.textContent = 'Retry camera';
  } finally {
    button.disabled = false;
  }
}

function updateTrackingStatus(status) {
  if (status === 'loading') {
    elements.cameraStatus.textContent = 'Connected';
    elements.cameraStatus.dataset.state = 'ready';
    elements.modelStatus.textContent = 'Loading model…';
    elements.modelStatus.dataset.state = 'loading';
  } else if (status === 'ready') {
    elements.cameraStatus.textContent = 'Active';
    elements.cameraStatus.dataset.state = 'ready';
    elements.modelStatus.textContent = 'Ready';
    elements.modelStatus.dataset.state = 'ready';
    elements.trackingText.textContent = 'NO HAND DETECTED';
    elements.trackingBadge.dataset.state = 'waiting';
    elements.keyboardStart.classList.add('hidden');
  } else if (status === 'tracking-error') {
    elements.modelStatus.textContent = 'Retrying…';
    elements.modelStatus.dataset.state = 'error';
    elements.cameraHelp.textContent = 'A camera frame could not be processed. Tracking will retry automatically.';
  } else if (status === 'tracking' && elements.modelStatus.dataset.state === 'error') {
    elements.modelStatus.textContent = 'Ready';
    elements.modelStatus.dataset.state = 'ready';
    elements.cameraHelp.textContent = 'Model ready. Show each gesture to test it, then enter the arena.';
  } else if (status === 'camera-ended') {
    elements.cameraStatus.textContent = 'Disconnected';
    elements.cameraStatus.dataset.state = 'error';
    elements.modelStatus.textContent = 'Unavailable';
    elements.modelStatus.dataset.state = 'error';
    elements.startGame.disabled = true;
    elements.keyboardStart.classList.remove('hidden');
  }
}

function drawHands(hands, tracking) {
  const context = handOverlayContext;
  context.clearRect(0, 0, elements.overlay.width, elements.overlay.height);
  for (const hand of hands) {
    const points = hand.landmarks;
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(126, 223, 255, 0.84)';
    context.shadowColor = '#66cfff';
    context.shadowBlur = 7;
    for (const [from, to] of getHandConnections()) {
      context.beginPath();
      context.moveTo(points[from].x * elements.overlay.width, points[from].y * elements.overlay.height);
      context.lineTo(points[to].x * elements.overlay.width, points[to].y * elements.overlay.height);
      context.stroke();
    }
    context.shadowBlur = 0;
    for (const point of points) {
      context.beginPath();
      context.arc(point.x * elements.overlay.width, point.y * elements.overlay.height, 3, 0, Math.PI * 2);
      context.fillStyle = '#d7c7ff';
      context.fill();
    }
  }

  if (tracking.detected) {
    elements.trackingText.textContent = hands.length === 2 ? 'TWO HANDS DETECTED' : 'HAND DETECTED';
    elements.trackingBadge.dataset.state = 'active';
    if (currentScreen === 'game') {
      elements.gameTrackingText.textContent = hands.length === 2 ? 'TWO HANDS DETECTED' : 'HAND DETECTED';
      elements.gameTracking.dataset.state = 'active';
    }
    const primary = hands.reduce((best, hand) => hand.confidence > best.confidence ? hand : best, hands[0]);
    const palm = primary.landmarks[9];
    if (currentScreen === 'game') game.setAimFromNormalized(palm.x, palm.y);
    if (currentScreen === 'calibration' && elements.gestureStatus.textContent === 'Waiting for a hand') {
      elements.gestureStatus.textContent = 'Hand detected · try a spell';
    }
  } else {
    const recovering = tracking.lostFor > 0 && tracking.lostFor < 520;
    elements.trackingText.textContent = recovering ? 'REACQUIRING HAND…' : 'NO HAND DETECTED';
    elements.trackingBadge.dataset.state = recovering ? 'waiting' : 'offline';
    if (currentScreen === 'game') {
      elements.gameTrackingText.textContent = recovering ? 'REACQUIRING HAND' : 'HAND NOT DETECTED';
      elements.gameTracking.dataset.state = recovering ? 'waiting' : 'offline';
    }
  }
}

function handleGesture(event) {
  if (event.phase === 'start') {
    const card = document.querySelector(`[data-gesture="${event.gesture}"]`);
    if (card) {
      card.classList.add('tested');
      card.querySelector('.gesture-check').setAttribute('aria-label', 'Gesture detected');
    }
    elements.gestureStatus.textContent = `${GESTURE_NAMES[event.gesture]} detected`;
  } else if (event.phase === 'end' && currentScreen === 'calibration') {
    elements.gestureStatus.textContent = 'Gesture released · ready';
  }

  if (currentScreen === 'game') game.handleGesture(event);
}

function startGame(useCamera) {
  if (useCamera && !tracker.detector) return;
  usedCameraForRun = useCamera;
  closeDialog();
  showScreen('game');
  elements.gameTrackingText.textContent = useCamera ? 'WAITING FOR HAND' : 'MOUSE + KEYBOARD';
  elements.gameTracking.dataset.state = useCamera ? 'waiting' : 'offline';
  game.setAim(760, 360);
  game.start();
  audio.unlock();
}

async function restartRun() {
  if (!usedCameraForRun) {
    startGame(false);
    return;
  }
  try {
    await tracker.start(elements.video);
    elements.gameVideo.srcObject = tracker.stream;
    await elements.gameVideo.play();
    startGame(true);
  } catch (error) {
    console.error('Could not reconnect the camera for the next run.', error);
    showMessage('Camera unavailable. Mouse and keyboard controls are active.');
    startGame(false);
  }
}

function returnToMenu() {
  game.stop();
  tracker.stop();
  elements.gameVideo.srcObject = null;
  elements.startGame.disabled = true;
  document.getElementById('enable-camera').textContent = 'Enable camera';
  elements.cameraStatus.textContent = 'Waiting';
  elements.cameraStatus.dataset.state = '';
  elements.modelStatus.textContent = 'Not loaded';
  elements.modelStatus.dataset.state = '';
  elements.cameraHelp.textContent = 'Camera access is requested only after you enter calibration.';
  elements.trackingText.textContent = 'NO HAND DETECTED';
  elements.trackingBadge.dataset.state = 'offline';
  usedCameraForRun = false;
  showScreen('menu');
}

function finishRun(result) {
  tracker.stop();
  elements.gameVideo.srcObject = null;
  bestScore = Math.max(bestScore, result.score);
  writeBestScore(bestScore);
  document.getElementById('menu-best-score').textContent = formatScore(bestScore);
  document.getElementById('final-score').textContent = formatScore(result.score);
  document.getElementById('final-best').textContent = formatScore(bestScore);
  document.getElementById('final-wave').textContent = String(Math.max(0, result.wave - 1)).padStart(2, '0');
  document.getElementById('final-defeated').textContent = String(result.defeated);
  showScreen('gameover');
}

function updateHud(state) {
  document.getElementById('score-value').textContent = formatScore(state.score);
  document.getElementById('wave-value').textContent = String(state.wave).padStart(2, '0');
  document.getElementById('enemy-count').textContent = `THREATS · ${state.remaining}`;
  document.getElementById('health-value').textContent = String(Math.ceil(state.health));
  document.getElementById('health-fill').style.width = `${Math.max(0, state.health)}%`;
  document.querySelectorAll('.life-heart').forEach((heart, index) => {
    heart.classList.toggle('spent', index >= state.lives);
  });
  document.querySelectorAll('[data-spell]').forEach((button) => {
    const cooldown = state.cooldowns[button.dataset.spell] || 0;
    const fullCooldown = SPELL_COOLDOWNS[button.dataset.spell];
    const progress = fullCooldown ? Math.min(1, cooldown / fullCooldown) : 0;
    button.classList.toggle('is-cooling', cooldown > 0);
    button.style.setProperty('--cooldown-progress', String(progress));
    button.title = cooldown > 0 ? `${button.dataset.spell} ready in ${cooldown.toFixed(1)} seconds` : `Cast ${button.dataset.spell}`;
  });
}

function showMessage(message) {
  elements.gameMessage.textContent = message;
  elements.gameMessage.classList.add('is-visible');
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => elements.gameMessage.classList.remove('is-visible'), 1900);
}

function setPreview(enabled) {
  previewEnabled = enabled;
  document.body.classList.toggle('preview-off', !enabled);
  elements.previewSetting.checked = enabled;
  document.getElementById('preview-toggle').textContent = enabled ? 'Hide preview' : 'Show preview';
  document.getElementById('game-preview-toggle').setAttribute('aria-label', enabled ? 'Hide camera preview' : 'Show camera preview');
}

function showScreen(name) {
  currentScreen = name;
  for (const [key, screen] of Object.entries(elements.screens)) {
    screen.classList.toggle('hidden', key !== name);
  }
}

function openDialog(id) {
  document.getElementById('dialog-backdrop').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}

function closeDialog() {
  document.getElementById('dialog-backdrop').classList.add('hidden');
  document.querySelectorAll('.dialog-panel').forEach((panel) => panel.classList.add('hidden'));
}

function onKeyDown(event) {
  if (currentScreen !== 'game' || event.repeat || isTyping(event.target)) return;
  if (event.code === 'Digit1') game.castManual('fireball');
  else if (event.code === 'Digit2') game.castManual('shield');
  else if (event.code === 'Digit3') game.castManual('lightning');
  else if (event.code === 'Digit4') game.handleGesture({ gesture: 'pinch', phase: 'start' });
  else if (event.code === 'Space') {
    event.preventDefault();
    game.castManual('fireball');
  }
}

function onKeyUp(event) {
  if (currentScreen === 'game' && event.code === 'Digit4') {
    game.handleGesture({ gesture: 'pinch', phase: 'end' });
  }
}

function isTyping(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

function readBestScore() {
  try {
    const value = Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch (error) {
    console.warn('Could not read the saved high score.', error);
    return 0;
  }
}

function writeBestScore(score) {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch (error) {
    console.warn('Could not save the high score.', error);
  }
}

function formatScore(value) {
  return Math.max(0, Math.floor(value)).toString().padStart(6, '0');
}
