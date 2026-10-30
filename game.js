import { createEnemy, moveEnemyToward } from './enemy.js';
import { ArenaRenderer } from './renderer.js';

const WIDTH = 1280;
const HEIGHT = 720;
const COLORS = {
  fireball: '#ff823f',
  shield: '#83d9ff',
  lightning: '#a3caff',
  telekinesis: '#c88aff',
};

export class ArenaGame {
  constructor(canvas, audio, { onHud, onGameOver, onMessage }) {
    this.canvas = canvas;
    this.width = WIDTH;
    this.height = HEIGHT;
    this.center = { x: WIDTH / 2, y: HEIGHT / 2 };
    this.renderer = new ArenaRenderer(canvas);
    this.audio = audio;
    this.onHud = onHud;
    this.onGameOver = onGameOver;
    this.onMessage = onMessage;
    this.running = false;
    this.frame = 0;
    this.lastTime = 0;
    this.hudTimer = 0;
    this.aim = { x: this.center.x + 120, y: this.center.y };
    this.aimVelocity = { x: 0, y: 0 };
    this.ambient = Array.from({ length: 92 }, () => this.makeAmbient(true));
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.wave = 1;
    this.score = 0;
    this.defeated = 0;
    this.lives = 3;
    this.health = 100;
    this.invulnerable = 0;
    this.shieldTime = 0;
    this.grabbed = null;
    this.spawnRemaining = 0;
    this.spawnTimer = 0;
    this.wavePause = 0;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.lightning = [];
    this.cooldowns = { fireball: 0, shield: 0, lightning: 0, telekinesis: 0 };
    this.aim = { x: this.center.x + 120, y: this.center.y };
    this.aimVelocity = { x: 0, y: 0 };
    this.aimUpdatedAt = 0;
  }

  start() {
    this.stop();
    this.resize();
    this.reset();
    this.state = 'playing';
    this.beginWave();
    this.running = true;
    this.lastTime = 0;
    this.frame = requestAnimationFrame((time) => this.loop(time));
    this.publishHud(true);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  resize() {
    const oldHeight = this.height;
    this.renderer.resize(this);
    if (oldHeight === this.height) return;
    if (this.state !== 'playing') {
      this.ambient = Array.from({ length: 92 }, () => this.makeAmbient(true));
      return;
    }
    const ratio = this.height / oldHeight;
    for (const item of [...this.enemies, ...this.projectiles, ...this.particles]) item.y *= ratio;
    for (const mote of this.ambient) mote.y *= ratio;
    for (const bolt of this.lightning) {
      bolt.y1 *= ratio;
      bolt.y2 *= ratio;
      bolt.points.forEach((point) => { point.y *= ratio; });
      bolt.branches?.forEach((branch) => branch.forEach((point) => { point.y *= ratio; }));
    }
    this.aim.y *= ratio;
  }

  beginWave() {
    this.spawnRemaining = 3 + this.wave * 2;
    this.spawnTimer = 0.3;
    this.wavePause = 0;
    this.onMessage?.(`Wave ${this.wave} — hold the circle.`);
  }

  setAim(x, y) {
    const now = performance.now();
    const elapsed = Math.max(0.016, Math.min(0.12, (now - (this.aimUpdatedAt || now)) / 1000));
    const next = {
      x: Math.max(0, Math.min(WIDTH, x)),
      y: Math.max(0, Math.min(this.height, y)),
    };
    this.aimVelocity = {
      x: (next.x - this.aim.x) / elapsed,
      y: (next.y - this.aim.y) / elapsed,
    };
    this.aim = next;
    this.aimUpdatedAt = now;
  }

  setAimFromNormalized(x, y) {
    this.setAim((1 - x) * WIDTH, y * this.height);
  }

  handleGesture({ gesture, phase }) {
    if (this.state !== 'playing') return;
    if (gesture === 'pinch') {
      if (phase === 'start') this.beginTelekinesis();
      else if (phase === 'hold') this.moveGrabbed();
      else if (phase === 'end') this.throwGrabbed();
      return;
    }
    if (phase !== 'start') return;

    if (gesture === 'fist') this.castFireball();
    else if (gesture === 'open-palm') this.castShield();
    else if (gesture === 'two-fingers') this.castLightning();
  }

  castManual(spell) {
    if (spell === 'fireball') this.castFireball();
    else if (spell === 'shield') this.castShield();
    else if (spell === 'lightning') this.castLightning();
    else if (spell === 'telekinesis') {
      this.beginTelekinesis();
      if (this.grabbed) this.throwGrabbed();
    }
  }

  castFireball() {
    if (!this.ready('fireball')) return;
    this.cooldowns.fireball = 0.72;
    this.publishHud();
    const target = this.targetEnemy(190) || this.nearestEnemy(this.center.x, this.center.y, 900);
    const point = target ? { x: target.x, y: target.y } : this.aim;
    const angle = Math.atan2(point.y - this.center.y, point.x - this.center.x);
    const speed = 610;
    this.projectiles.push({
      type: 'fireball',
      x: this.center.x + Math.cos(angle) * 28,
      y: this.center.y + Math.sin(angle) * 28,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.8,
      radius: 12,
      damage: 42 + Math.min(this.wave * 1.4, 16),
    });
    this.audio.cast('fireball');
    this.emit(this.center.x, this.center.y, COLORS.fireball, 16, 145);
    this.onMessage?.('Fireball unleashed.');
  }

  castShield() {
    if (!this.ready('shield')) return;
    this.cooldowns.shield = 4.4;
    this.publishHud();
    this.shieldTime = 2.5;
    this.audio.cast('shield');
    this.emit(this.center.x, this.center.y, COLORS.shield, 26, 100);
    this.onMessage?.('Aegis raised — incoming damage is reduced.');
  }

  castLightning() {
    if (!this.ready('lightning')) return;
    this.cooldowns.lightning = 1.8;
    this.publishHud();
    const target = this.targetEnemy(220) || this.nearestEnemy(this.center.x, this.center.y, 2000);
    if (target) {
      this.strike(target);
      this.lightning.push({
        x1: this.center.x, y1: this.center.y, x2: target.x, y2: target.y,
        points: this.boltPoints(this.center.x, this.center.y, target.x, target.y, 13, 30),
        life: 0.32, maxLife: 0.32,
      });
      this.lightning[this.lightning.length - 1].branches = this.branchPoints(this.lightning[this.lightning.length - 1].points);
      this.audio.cast('lightning');
      this.onMessage?.(`${this.enemyName(target)} struck by lightning.`);
    } else {
      this.lightning.push({
        x1: this.center.x, y1: this.center.y, x2: this.aim.x, y2: this.aim.y,
        points: this.boltPoints(this.center.x, this.center.y, this.aim.x, this.aim.y, 10, 28),
        life: 0.26, maxLife: 0.26,
      });
      this.lightning[this.lightning.length - 1].branches = this.branchPoints(this.lightning[this.lightning.length - 1].points);
      this.audio.cast('lightning');
      this.emit(this.aim.x, this.aim.y, COLORS.lightning, 15, 80);
    }
  }

  beginTelekinesis() {
    if (!this.ready('telekinesis')) return;
    const target = this.targetEnemy(170) || this.nearestEnemy(this.center.x, this.center.y, 2000);
    if (!target) {
      this.onMessage?.('No enemy within reach.');
      return;
    }
    this.cooldowns.telekinesis = 2.2;
    this.publishHud();
    this.grabbed = target;
    target.vx = 0;
    target.vy = 0;
    this.audio.cast('telekinesis');
    this.emit(target.x, target.y, COLORS.telekinesis, 18, 60);
    this.onMessage?.('Pinch and move your hand. Release to throw.');
  }

  moveGrabbed() {
    if (!this.grabbed || this.grabbed.dead) return;
    const enemy = this.grabbed;
    enemy.x += (this.aim.x - enemy.x) * 0.32;
    enemy.y += (this.aim.y - enemy.y) * 0.32;
    if (Math.random() < 0.65) this.emit(enemy.x, enemy.y, COLORS.telekinesis, 1, 55);
  }

  throwGrabbed() {
    if (!this.grabbed) return;
    const enemy = this.grabbed;
    this.grabbed = null;
    const outward = normalize(enemy.x - this.center.x, enemy.y - this.center.y);
    const handSpeed = Math.hypot(this.aimVelocity.x, this.aimVelocity.y);
    const direction = handSpeed > 90
      ? normalize(this.aimVelocity.x, this.aimVelocity.y)
      : outward;
    enemy.vx = direction.x * 760;
    enemy.vy = direction.y * 760;
    enemy.thrown = 1.25;
    enemy.hp -= 18 + Math.min(this.wave * 2, 20);
    enemy.hitFlash = 0.2;
    this.emit(enemy.x, enemy.y, COLORS.telekinesis, 16, 180);
    this.audio.cast('telekinesis');
    this.onMessage?.('The enemy tears across the arena.');
    if (enemy.hp <= 0) this.defeat(enemy);
  }

  targetEnemy(range) {
    return this.nearestEnemy(this.aim.x, this.aim.y, range);
  }

  nearestEnemy(x, y, range) {
    let best = null;
    let bestDistance = range;
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy === this.grabbed) continue;
      const current = Math.hypot(enemy.x - x, enemy.y - y);
      if (current < bestDistance) {
        best = enemy;
        bestDistance = current;
      }
    }
    return best;
  }

  ready(spell) {
    if ((this.cooldowns[spell] || 0) > 0) return false;
    return this.state === 'playing';
  }

  spawnEnemy() {
    this.enemies.push(createEnemy(this.wave, this.width, this.height));
  }

  update(dt) {
    for (const key of Object.keys(this.cooldowns)) {
      this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
    }
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.shieldTime = Math.max(0, this.shieldTime - dt);
    for (const mote of this.ambient) {
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
      if (mote.x < -5 || mote.x > this.width + 5 || mote.y < -5 || mote.y > this.height + 5) {
        Object.assign(mote, this.makeAmbient(true));
      }
    }

    if (this.spawnRemaining > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnEnemy();
        this.spawnRemaining -= 1;
        this.spawnTimer = Math.max(0.32, 1.05 - this.wave * 0.055);
      }
    } else if (this.enemies.every((enemy) => enemy.dead)) {
      this.wavePause += dt;
      if (this.wavePause >= 1.25) {
        this.wave += 1;
        this.beginWave();
      }
    }

    for (const projectile of this.projectiles) {
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.life -= dt;
      for (const enemy of this.enemies) {
        if (enemy.dead || enemy === this.grabbed) continue;
        if (Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) < enemy.radius + projectile.radius) {
          enemy.hp -= projectile.damage;
          enemy.hitFlash = 0.18;
          this.emit(projectile.x, projectile.y, COLORS.fireball, 18, 155);
          projectile.life = 0;
          if (enemy.hp <= 0) this.defeat(enemy);
          for (const nearby of this.enemies) {
            if (nearby === enemy || nearby.dead || Math.hypot(nearby.x - projectile.x, nearby.y - projectile.y) > 74) continue;
            nearby.hp -= 22;
            nearby.hitFlash = 0.16;
            if (nearby.hp <= 0) this.defeat(nearby);
          }
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((projectile) => (
      projectile.life > 0 && projectile.x > -40 && projectile.x < this.width + 40
      && projectile.y > -40 && projectile.y < this.height + 40
    ));

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.attackTimer -= dt;
      if (enemy === this.grabbed) {
        enemy.x += (this.aim.x - enemy.x) * Math.min(1, dt * 13);
        enemy.y += (this.aim.y - enemy.y) * Math.min(1, dt * 13);
        if (Math.random() < 0.55) this.emit(enemy.x, enemy.y, COLORS.telekinesis, 1, 55);
        continue;
      }
      if (enemy.thrown > 0) {
        enemy.thrown = Math.max(0, enemy.thrown - dt);
        enemy.x += enemy.vx * dt;
        enemy.y += enemy.vy * dt;
        enemy.vx *= Math.pow(0.88, dt * 60);
        enemy.vy *= Math.pow(0.88, dt * 60);
        for (const other of this.enemies) {
          if (other === enemy || other.dead || enemy.hitVictims.has(other)) continue;
          if (Math.hypot(other.x - enemy.x, other.y - enemy.y) < other.radius + enemy.radius) {
            enemy.hitVictims.add(other);
            other.hp -= 30;
            other.hitFlash = 0.18;
            this.emit(other.x, other.y, COLORS.telekinesis, 7, 100);
            if (other.hp <= 0) this.defeat(other);
          }
        }
        if (enemy.x < -100 || enemy.x > this.width + 100 || enemy.y < -100 || enemy.y > this.height + 100) {
          this.defeat(enemy);
        }
        continue;
      }

      const distance = moveEnemyToward(enemy, this.center, dt);
      const dx = this.center.x - enemy.x;
      const dy = this.center.y - enemy.y;
      const direction = normalize(dx, dy);
      if (distance < enemy.radius + 29 && enemy.attackTimer <= 0) {
        enemy.attackTimer = enemy.type === 'brute' ? 1.25 : 0.92;
        this.damagePlayer(enemy.damage);
        enemy.x -= direction.x * 15;
        enemy.y -= direction.y * 15;
      }
    }
    this.enemies = this.enemies.filter((enemy) => !enemy.dead);

    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.95, dt * 60);
      particle.vy *= Math.pow(0.95, dt * 60);
      particle.life -= dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
    for (const bolt of this.lightning) bolt.life -= dt;
    this.lightning = this.lightning.filter((bolt) => bolt.life > 0);
  }

  damagePlayer(amount) {
    if (this.invulnerable > 0) return;
    this.invulnerable = 0.58;
    if (this.shieldTime > 0) {
      this.health = Math.max(0, this.health - amount * 0.22);
      this.emit(this.center.x, this.center.y, COLORS.shield, 14, 110);
      this.audio.hit();
      this.onMessage?.('The aegis absorbs the blow.');
    } else {
      this.health = Math.max(0, this.health - amount);
      this.emit(this.center.x, this.center.y, '#ff6a78', 18, 140);
      this.audio.hit();
      this.onMessage?.('You were struck!');
    }

    if (this.health <= 0) {
      this.lives -= 1;
      if (this.lives <= 0) {
        this.finish();
      } else {
        this.health = 100;
        this.invulnerable = 1.6;
        this.onMessage?.(`${this.lives} ${this.lives === 1 ? 'life' : 'lives'} remain.`);
      }
    }
  }

  strike(enemy) {
    enemy.hp -= 86 + Math.min(this.wave * 2, 24);
    enemy.hitFlash = 0.24;
    this.emit(enemy.x, enemy.y, COLORS.lightning, 18, 135);
    for (const nearby of this.enemies) {
      if (nearby === enemy || nearby.dead) continue;
      if (Math.hypot(nearby.x - enemy.x, nearby.y - enemy.y) < 70) {
        nearby.hp -= 24;
        nearby.hitFlash = 0.15;
        this.emit(nearby.x, nearby.y, COLORS.lightning, 5, 65);
        if (nearby.hp <= 0) this.defeat(nearby);
      }
    }
    if (enemy.hp <= 0) this.defeat(enemy);
  }

  defeat(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    if (this.grabbed === enemy) this.grabbed = null;
    this.score += enemy.score + Math.floor(this.wave * 8);
    this.defeated += 1;
    this.emit(enemy.x, enemy.y, enemy.color, 22, 160);
  }

  finish() {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this.stop();
    this.onGameOver({
      score: this.score,
      wave: this.wave,
      defeated: this.defeated,
      lives: this.lives,
    });
  }

  loop(timestamp) {
    if (!this.running) return;
    const dt = Math.min(0.04, this.lastTime ? (timestamp - this.lastTime) / 1000 : 0.016);
    this.lastTime = timestamp;
    this.update(dt);
    this.renderer.render(this, timestamp / 1000);
    this.hudTimer += dt;
    if (this.hudTimer >= 0.1) {
      this.hudTimer = 0;
      this.publishHud();
    }
    this.frame = requestAnimationFrame((time) => this.loop(time));
  }

  publishHud(force = false) {
    this.onHud?.({
      score: this.score,
      wave: this.wave,
      health: this.health,
      lives: this.lives,
      shieldTime: this.shieldTime,
      cooldowns: { ...this.cooldowns },
      remaining: this.spawnRemaining + this.enemies.length,
      force,
    });
  }

  emit(x, y, color, count = 10, power = 90) {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = power * (0.25 + Math.random() * 0.75);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.3 + Math.random() * 0.65,
        maxLife: 0.95,
        size: 1.5 + Math.random() * 4.5,
        color,
      });
    }
  }

  makeAmbient(randomY = false) {
    return {
      x: Math.random() * this.width,
      y: randomY ? Math.random() * this.height : this.height + 10,
      vx: (Math.random() - 0.5) * 7,
      vy: -4 - Math.random() * 13,
      size: 0.6 + Math.random() * 2,
      alpha: 0.15 + Math.random() * 0.45,
      phase: Math.random() * Math.PI * 2,
    };
  }

  boltPoints(x1, y1, x2, y2, segments = 12, spread = 26) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const perpendicular = { x: -dy / length, y: dx / length };
    return Array.from({ length: segments + 1 }, (_, index) => {
      const t = index / segments;
      const offset = index === 0 || index === segments ? 0 : (Math.random() - 0.5) * spread;
      return { x: x1 + dx * t + perpendicular.x * offset, y: y1 + dy * t + perpendicular.y * offset };
    });
  }

  branchPoints(points) {
    return Array.from({ length: 4 }, () => {
      const start = points[2 + Math.floor(Math.random() * Math.max(1, points.length - 4))];
      const angle = Math.random() * Math.PI * 2;
      const length = 22 + Math.random() * 38;
      return this.boltPoints(
        start.x,
        start.y,
        start.x + Math.cos(angle) * length,
        start.y + Math.sin(angle) * length,
        3,
        12
      );
    });
  }

  drawBackground(ctx, time) {
    const gradient = ctx.createRadialGradient(this.width * 0.5, this.height * 0.44, 30, this.width * 0.5, this.height * 0.52, 740);
    gradient.addColorStop(0, '#151c32');
    gradient.addColorStop(0.48, '#0b1020');
    gradient.addColorStop(1, '#050711');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    const fog = ctx.createRadialGradient(this.width * 0.22, this.height * 0.35, 18, this.width * 0.22, this.height * 0.35, 420);
    fog.addColorStop(0, 'rgba(95, 55, 142, 0.13)');
    fog.addColorStop(1, 'rgba(95, 55, 142, 0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, this.width, this.height);
    const secondFog = ctx.createRadialGradient(this.width * 0.82, this.height * 0.65, 20, this.width * 0.82, this.height * 0.65, 380);
    secondFog.addColorStop(0, 'rgba(41, 106, 138, 0.11)');
    secondFog.addColorStop(1, 'rgba(41, 106, 138, 0)');
    ctx.fillStyle = secondFog;
    ctx.fillRect(0, 0, this.width, this.height);

    for (const mote of this.ambient) {
      ctx.globalAlpha = mote.alpha * (0.68 + Math.sin(time * 1.8 + mote.phase) * 0.32);
      ctx.fillStyle = '#b6d5f7';
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const vignette = ctx.createRadialGradient(this.width / 2, this.height / 2, 240, this.width / 2, this.height / 2, 760);
    vignette.addColorStop(0, 'rgba(2, 4, 10, 0)');
    vignette.addColorStop(1, 'rgba(2, 4, 10, 0.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawArena(ctx, time) {
    const pulse = Math.sin(time * 0.75) * 4;
    ctx.save();
    ctx.translate(this.center.x, this.center.y);
    ctx.strokeStyle = 'rgba(123, 111, 190, 0.16)';
    ctx.lineWidth = 1;
    [246, 270, 320].forEach((radius, index) => {
      ctx.beginPath();
      ctx.arc(0, 0, radius + (index === 0 ? pulse : 0), 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([3, 11]);
    ctx.lineDashOffset = -time * 9;
    ctx.strokeStyle = 'rgba(157, 145, 226, 0.2)';
    ctx.beginPath();
    ctx.arc(0, 0, 294, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.rotate(-time * 0.08);
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      const x = Math.cos(angle) * 295;
      const y = Math.sin(angle) * 295;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2);
      ctx.strokeStyle = index % 4 === 0 ? 'rgba(220, 187, 255, 0.43)' : 'rgba(151, 145, 201, 0.2)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 0);
      ctx.lineTo(0, 6);
      ctx.lineTo(-4, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawPlayer(ctx, time) {
    ctx.save();
    ctx.translate(this.center.x, this.center.y);
    const ringPulse = 1 + Math.sin(time * 2.2) * 0.025;
    ctx.save();
    ctx.rotate(time * 0.16);
    ctx.scale(ringPulse, ringPulse);
    ctx.strokeStyle = 'rgba(161, 133, 255, 0.37)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 43, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(114, 204, 247, 0.48)';
    ctx.beginPath();
    ctx.arc(0, 0, 53, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      ctx.fillStyle = 'rgba(204, 172, 255, 0.75)';
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * 47, Math.sin(angle) * 47, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const aura = ctx.createRadialGradient(0, 0, 8, 0, 0, 65);
    aura.addColorStop(0, 'rgba(146, 136, 255, 0.28)');
    aura.addColorStop(1, 'rgba(146, 136, 255, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, 65, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#211e3a';
    ctx.shadowColor = '#7b8bff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(-24, 21);
    ctx.quadraticCurveTo(-20, -7, 0, -19);
    ctx.quadraticCurveTo(20, -7, 24, 21);
    ctx.quadraticCurveTo(0, 31, -24, 21);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#d9c8ff';
    ctx.beginPath();
    ctx.arc(0, -10, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#342751';
    ctx.beginPath();
    ctx.moveTo(-10, -14);
    ctx.lineTo(0, -30);
    ctx.lineTo(10, -14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (this.shieldTime > 0) this.drawShield(ctx, time);
    if (this.grabbed) this.drawTelekinesis(ctx, time);
  }

  drawShield(ctx, time) {
    const alpha = Math.min(1, this.shieldTime);
    const radius = 72 + Math.sin(time * 7) * 3;
    ctx.save();
    ctx.translate(this.center.x, this.center.y);
    ctx.globalAlpha = alpha;
    const glow = ctx.createRadialGradient(0, 0, 45, 0, 0, radius + 16);
    glow.addColorStop(0, 'rgba(74, 160, 255, 0)');
    glow.addColorStop(0.77, 'rgba(71, 174, 255, 0.08)');
    glow.addColorStop(1, 'rgba(172, 147, 255, 0.3)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(106, 199, 255, 0.88)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#66bfff';
    ctx.shadowBlur = 19;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2 - time * 0.4;
      const x = Math.cos(angle) * (radius - 2);
      const y = Math.sin(angle) * (radius - 2);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.strokeStyle = 'rgba(220, 199, 255, 0.95)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(0, 0);
      ctx.lineTo(4, -4);
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawEnemies(ctx, time) {
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      const wobble = Math.sin(time * 3.4 + enemy.x * 0.02) * 2;
      ctx.globalAlpha = enemy === this.grabbed ? 0.95 : 1;
      ctx.shadowColor = enemy === this.grabbed ? COLORS.telekinesis : enemy.color;
      ctx.shadowBlur = enemy === this.grabbed ? 28 : 17;
      ctx.fillStyle = enemy.hitFlash > 0 ? '#fff1df' : enemy.color;
      if (enemy.type === 'brute') {
        ctx.beginPath();
        ctx.moveTo(-enemy.radius * 0.76, 8);
        ctx.lineTo(-enemy.radius, -enemy.radius * 0.72);
        ctx.lineTo(-enemy.radius * 0.3, -enemy.radius);
        ctx.lineTo(enemy.radius * 0.65, -enemy.radius * 0.82);
        ctx.lineTo(enemy.radius, 4);
        ctx.lineTo(enemy.radius * 0.5, enemy.radius * 0.8);
        ctx.lineTo(-enemy.radius * 0.62, enemy.radius * 0.72);
        ctx.closePath();
      } else if (enemy.type === 'wisp') {
        ctx.beginPath();
        ctx.moveTo(0, -enemy.radius - wobble);
        ctx.quadraticCurveTo(enemy.radius * 1.1, 0, 0, enemy.radius + 5);
        ctx.quadraticCurveTo(-enemy.radius * 1.1, 0, 0, -enemy.radius - wobble);
      } else {
        ctx.beginPath();
        ctx.moveTo(-enemy.radius, enemy.radius * 0.9);
        ctx.lineTo(-enemy.radius * 0.78, -enemy.radius * 0.15);
        ctx.lineTo(-enemy.radius * 0.52, -enemy.radius * 0.72);
        ctx.lineTo(0, -enemy.radius * 0.96);
        ctx.lineTo(enemy.radius * 0.52, -enemy.radius * 0.72);
        ctx.lineTo(enemy.radius * 0.78, -enemy.radius * 0.15);
        ctx.lineTo(enemy.radius, enemy.radius * 0.9);
        ctx.closePath();
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7, 9, 20, 0.92)';
      ctx.beginPath();
      ctx.ellipse(-enemy.radius * 0.3, -2, 2.4, 3.6, 0, 0, Math.PI * 2);
      ctx.ellipse(enemy.radius * 0.3, -2, 2.4, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(246, 191, 212, 0.68)';
      ctx.fillRect(-enemy.radius, -enemy.radius - 11, enemy.radius * 2, 3);
      ctx.fillStyle = enemy.color;
      ctx.fillRect(-enemy.radius, -enemy.radius - 11, enemy.radius * 2 * Math.max(0, enemy.hp / enemy.maxHp), 3);
      ctx.restore();
    }
  }

  drawProjectiles(ctx) {
    for (const projectile of this.projectiles) {
      const tailX = projectile.x - projectile.vx * 0.045;
      const tailY = projectile.y - projectile.vy * 0.045;
      const trail = ctx.createLinearGradient(tailX, tailY, projectile.x, projectile.y);
      trail.addColorStop(0, 'rgba(255, 94, 40, 0)');
      trail.addColorStop(1, '#ffc16e');
      ctx.save();
      ctx.strokeStyle = trail;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.shadowColor = COLORS.fireball;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(projectile.x, projectile.y);
      ctx.stroke();
      ctx.fillStyle = '#fff2c6';
      ctx.beginPath();
      ctx.arc(projectile.x, projectile.y, projectile.radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawParticles(ctx) {
    for (const particle of this.particles) {
      ctx.globalAlpha = Math.min(1, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = particle.size * 3;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * Math.max(0.18, particle.life / particle.maxLife), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  drawLightning(ctx) {
    for (const bolt of this.lightning) {
      const alpha = Math.max(0, bolt.life / bolt.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#91baff';
      ctx.shadowColor = '#81c7ff';
      ctx.shadowBlur = 26;
      ctx.lineWidth = 8;
      this.strokeBolt(ctx, bolt.points);
      for (const branch of bolt.branches || []) this.strokeBolt(ctx, branch);
      ctx.strokeStyle = '#eff8ff';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2.4;
      this.strokeBolt(ctx, bolt.points);
      for (const branch of bolt.branches || []) this.strokeBolt(ctx, branch);
      ctx.restore();
    }
  }

  strokeBolt(ctx, points) {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  drawTelekinesis(ctx, time) {
    if (!this.grabbed) return;
    const enemy = this.grabbed;
    ctx.save();
    ctx.strokeStyle = 'rgba(204, 132, 255, 0.84)';
    ctx.shadowColor = COLORS.telekinesis;
    ctx.shadowBlur = 19;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 8]);
    ctx.lineDashOffset = -time * 40;
    ctx.beginPath();
    ctx.moveTo(this.aim.x, this.aim.y);
    ctx.lineTo(enemy.x, enemy.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius + 11 + Math.sin(time * 8) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawAim(ctx, time) {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(time * 4) * 0.1;
    ctx.strokeStyle = '#f3d9a8';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(this.aim.x, this.aim.y, 11, 0, Math.PI * 2);
    ctx.moveTo(this.aim.x - 16, this.aim.y);
    ctx.lineTo(this.aim.x - 5, this.aim.y);
    ctx.moveTo(this.aim.x + 5, this.aim.y);
    ctx.lineTo(this.aim.x + 16, this.aim.y);
    ctx.moveTo(this.aim.x, this.aim.y - 16);
    ctx.lineTo(this.aim.x, this.aim.y - 5);
    ctx.moveTo(this.aim.x, this.aim.y + 5);
    ctx.lineTo(this.aim.x, this.aim.y + 16);
    ctx.stroke();
    ctx.restore();
  }

  enemyName(enemy) {
    return enemy.type === 'brute' ? 'Brute' : enemy.type === 'wisp' ? 'Wisp' : 'Shade';
  }
}

function normalize(x, y) {
  const magnitude = Math.hypot(x, y) || 1;
  return { x: x / magnitude, y: y / magnitude };
}
