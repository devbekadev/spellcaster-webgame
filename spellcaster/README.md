# Spellcaster: The Arena

A browser-based dark-fantasy survival game controlled by real hand gestures. TensorFlow.js and the official `@tensorflow-models/hand-pose-detection` MediaPipe Hands detector process webcam frames locally in the browser; the game does not record or upload video.

## Run locally

Webcam access requires a secure origin. From this folder, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-local.ps1
```

Open [http://localhost:8765](http://localhost:8765), choose **Enter the arena**, and allow camera access. The TensorFlow.js, MediaPipe Hands, and hand-pose-detection scripts are loaded from jsDelivr, so an internet connection is needed to initialize gesture controls. If a webcam is unavailable, the calibration screen offers mouse and keyboard controls.

## Spells

| Spell | Gesture | Mouse / keyboard |
|---|---|---|
| Fireball | Close your fist | Click or `1` |
| Magic shield | Open your palm | `2` |
| Lightning | Extend index and middle fingers | `3` |
| Telekinesis | Pinch thumb and index; release to throw | Hold `4`, then release |

Move your hand to aim. The camera preview can be hidden without interrupting tracking. Gestures are smoothed over several frames and cast once per gesture, not continuously while held.

## Project structure

- `app.js` connects the screens, controls, and game.
- `hand-tracking.js` initializes MediaPipe Hands and smooths landmarks.
- `gesture-recognition.js` classifies the 21 landmarks and resolves gestures using joint angles and relative distances.
- `game.js` owns waves, spell behavior, scoring, and lives.
- `enemy.js` defines enemy variants, spawning, and approach behavior.
- `renderer.js` coordinates the canvas rendering passes and magical effects.
- `audio.js` generates spell sounds with the Web Audio API.
