const WIDTH = 1280;

export class ArenaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
  }

  resize(game) {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const scale = bounds.width / WIDTH;
    game.height = bounds.height / scale;
    game.center = { x: WIDTH / 2, y: game.height / 2 };
    this.canvas.width = Math.round(bounds.width * pixelRatio);
    this.canvas.height = Math.round(bounds.height * pixelRatio);
    this.context.setTransform(scale * pixelRatio, 0, 0, scale * pixelRatio, 0, 0);
  }

  render(game, time) {
    const ctx = this.context;
    ctx.clearRect(0, 0, game.width, game.height);
    game.drawBackground(ctx, time);
    game.drawArena(ctx, time);
    game.drawParticles(ctx);
    game.drawProjectiles(ctx);
    game.drawEnemies(ctx, time);
    game.drawPlayer(ctx, time);
    game.drawLightning(ctx);
    game.drawAim(ctx, time);
  }
}
