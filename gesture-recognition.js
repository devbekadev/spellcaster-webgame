export function classifyGesture(landmarks, detectorConfidence = 0.85) {
  if (!landmarks || landmarks.length !== 21) return { label: 'neutral', confidence: 0 };
  const wrist = landmarks[0];
  const palmWidth = distance(landmarks[5], landmarks[17]);
  if (palmWidth < 0.015) return { label: 'neutral', confidence: 0 };

  const fingers = [
    { mcp: 5, pip: 6, dip: 7, tip: 8 },
    { mcp: 9, pip: 10, dip: 11, tip: 12 },
    { mcp: 13, pip: 14, dip: 15, tip: 16 },
    { mcp: 17, pip: 18, dip: 19, tip: 20 },
  ];
  const extended = fingers.map(({ mcp, pip, dip, tip }) => {
    const pipAngle = jointAngle(landmarks[mcp], landmarks[pip], landmarks[dip]);
    const dipAngle = jointAngle(landmarks[pip], landmarks[dip], landmarks[tip]);
    return pipAngle > 150 && dipAngle > 135
      && distance(landmarks[tip], wrist) > distance(landmarks[pip], wrist) * 1.13;
  });
  const [index, middle, ring, pinky] = extended;
  const pinchDistance = distance(landmarks[4], landmarks[8]) / palmWidth;
  const pinch = pinchDistance < 0.34 && (index || middle || ring || pinky);
  const fist = !index && !middle && !ring && !pinky
    && distance(landmarks[4], midpoint(landmarks[0], landmarks[9])) < palmWidth * 0.92;
  const twoFingers = index && middle && !ring && !pinky;
  const openPalm = index && middle && ring && pinky;

  let label = 'neutral';
  if (pinch) label = 'pinch';
  else if (fist) label = 'fist';
  else if (twoFingers) label = 'two-fingers';
  else if (openPalm) label = 'open-palm';

  const shapeConfidence = label === 'neutral' ? 0.5 : 0.9;
  return {
    label,
    confidence: Math.min(1, Math.max(0, detectorConfidence)) * shapeConfidence,
  };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function jointAngle(a, b, c) {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const magnitude = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (!magnitude) return 0;
  const cosine = Math.max(-1, Math.min(1, (abx * cbx + aby * cby) / magnitude));
  return Math.acos(cosine) * (180 / Math.PI);
}
