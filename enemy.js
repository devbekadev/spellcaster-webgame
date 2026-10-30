const ENEMY_TYPES = {
  shade: { health: 34, speed: 74, radius: 19, damage: 12, score: 100, color: '#ae9fd4' },
  brute: { health: 92, speed: 47, radius: 28, damage: 22, score: 220, color: '#c87969' },
  wisp: { health: 46, speed: 94, radius: 16, damage: 10, score: 150, color: '#78c7cf' },
};

export function createEnemy(wave, width, height) {
  const edge = Math.floor(Math.random() * 4);
  const margin = 44;
  const point = edge === 0 ? { x: Math.random() * width, y: -margin }
    : edge === 1 ? { x: width + margin, y: Math.random() * height }
      : edge === 2 ? { x: Math.random() * width, y: height + margin }
        : { x: -margin, y: Math.random() * height };
  const pool = ['shade', 'shade', 'shade', 'wisp'];
  if (wave >= 2) pool.push('brute');
  if (wave >= 4) pool.push('brute', 'wisp');
  const type = pool[Math.floor(Math.random() * pool.length)];
  const config = ENEMY_TYPES[type];
  const healthScale = 1 + (wave - 1) * 0.15;
  const speedScale = 1 + Math.min((wave - 1) * 0.035, 0.5);

  return {
    type,
    x: point.x,
    y: point.y,
    radius: config.radius,
    hp: config.health * healthScale,
    maxHp: config.health * healthScale,
    speed: config.speed * speedScale,
    damage: config.damage + Math.floor((wave - 1) * 1.4),
    score: config.score,
    color: config.color,
    attackTimer: 0.6 + Math.random() * 0.8,
    thrown: 0,
    vx: 0,
    vy: 0,
    hitFlash: 0,
    dead: false,
    hitVictims: new Set(),
  };
}

export function moveEnemyToward(enemy, target, deltaTime) {
  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const distance = Math.hypot(dx, dy) || 1;
  enemy.x += (dx / distance) * enemy.speed * deltaTime;
  enemy.y += (dy / distance) * enemy.speed * deltaTime;
  return distance;
}
