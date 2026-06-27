// ============================================================
//  ENCLAVE TURF WAR: MEGA vs. The Entrance Weeds
//  game.js — Vanilla JS / Canvas
// ============================================================
'use strict';

// ── CONSTANTS ────────────────────────────────────────────────
const COLS        = 9;
const ROWS        = 5;
const SL_DROP_MS  = 5000;   // sunlight token drops every 5s

// Speed values are in cells/second — converted to px/ms at spawn time
const UNIT_DEFS = {
  sunscreen: { name:'Sunscreen Cooler', cost:50,  hp:80,   icon:'🧴', color:'#63BFFF', isPassive:true,  genSL:25, genMs:10000 },
  note:      { name:'Note Launcher',    cost:100, hp:100,  icon:'📜', color:'#A8E6A3', isPassive:false, ranged:true,  damage:20, fireMs:2000, projSpeed:6 },
  bruiser:   { name:'Bro-Tank Bruiser', cost:150, hp:300,  icon:'💪', color:'#F4A261', isPassive:false, melee:true,   damage:30, meleeMs:1200 },
  gate:      { name:'Vinyl Gate',       cost:50,  hp:600,  icon:'🚧', color:'#F0F0F0', isPassive:true  },
};

const ENEMY_DEFS = {
  //                                  cells/sec
  dandelion: { name:'Dandelion Spore',   hp:60,  speed:0.35, icon:'🌼', color:'#FFE566', damage:10, dmgMs:1200, points:10 },
  crabgrass: { name:'Crabgrass Crawler', hp:250, speed:0.15, icon:'🦀', color:'#88AA44', damage:25, dmgMs:1000, points:25 },
  charlie:   { name:'Creeping Charlie',  hp:80,  speed:0.50, icon:'🌿', color:'#66BB66', damage:10, dmgMs:1000, points:20, erratic:true },
  boss:      { name:'Grand Dandelion',   hp:900, speed:0.10, icon:'🌻', color:'#FF9900', damage:40, dmgMs:1400, points:200, isBoss:true },
};

// Wave definitions — [enemyType, delayMs after wave start]
const WAVES = [
  [ // Wave 1 — introductory
    ['dandelion',  0],    ['dandelion',  4000], ['dandelion',  8000],
    ['dandelion', 12000], ['crabgrass', 16000], ['dandelion', 20000],
    ['dandelion', 24000], ['dandelion', 28000],
  ],
  [ // Wave 2 — mixed + charlies
    ['dandelion',  0],   ['charlie',   3000],  ['dandelion',  6000],
    ['crabgrass',  8000],['charlie',  11000],  ['dandelion', 14000],
    ['crabgrass', 17000],['charlie',  20000],  ['dandelion', 23000],
    ['crabgrass', 26000],['dandelion',29000],
  ],
  [ // Wave 3 — heavy + BOSS
    ['dandelion',  0],   ['crabgrass',  2000], ['charlie',   4000],
    ['dandelion',  7000],['crabgrass',  9000], ['charlie',  12000],
    ['dandelion', 15000],['crabgrass', 17000], ['charlie',  20000],
    ['boss',      24000],
    ['dandelion', 27000],['crabgrass', 30000], ['dandelion', 33000],
  ],
];

// ── STATE ────────────────────────────────────────────────────
let gameState;
let rafId = null;
let gameRunning = false; // guard against stale loops

function freshState() {
  return {
    sunlight: 150,
    score: 0,
    wave: 1,
    lives: 5,
    phase: 'idle',
    waveStartTime: null,
    waveSchedule: [],
    waveEnemiesLeft: 0,
    grid: Array.from({length: ROWS}, () => Array(COLS).fill(null)),
    defenders: [],
    enemies: [],
    projectiles: [],
    slTokens: [],
    particles: [],
    selectedUnit: null,
    nextSlDrop: 0,
    lastTick: 0,
    idCounter: 0,
    stunMessages: [],
    _hoverCell: null,
  };
}

// ── CANVAS SETUP ─────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
let CW, CH, CELL_W, CELL_H, GRID_X, GRID_Y;

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const ww   = wrap.clientWidth;
  const wh   = wrap.clientHeight;
  const maxW = Math.min(ww, 900);
  CELL_W = Math.floor(Math.min(maxW / COLS, wh / (ROWS + 1)));
  CELL_H = CELL_W;
  CW = CELL_W * COLS;
  CH = CELL_H * (ROWS + 1);
  canvas.width  = CW;
  canvas.height = CH;
  canvas.style.width  = CW + 'px';
  canvas.style.height = CH + 'px';
  GRID_X = 0;
  GRID_Y = CELL_H; // top row is sky
}

// ── HELPERS ──────────────────────────────────────────────────
function uid()    { return ++gameState.idCounter; }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function updateUI() {
  const g = gameState;
  document.getElementById('ui-sunlight').textContent = g.sunlight;
  document.getElementById('ui-score').textContent    = g.score;
  document.getElementById('ui-wave').textContent     = g.wave;
  document.getElementById('ui-lives').textContent    = '🏠'.repeat(Math.max(0, g.lives));
  document.querySelectorAll('.unit-btn[data-unit]').forEach(btn => {
    const cost = UNIT_DEFS[btn.dataset.unit]?.cost ?? Infinity;
    btn.classList.toggle('disabled-unit', g.sunlight < cost);
  });
}

function showWaveBanner(text, durationMs = 2000) {
  const banner = document.getElementById('wave-banner');
  document.getElementById('wave-banner-text').textContent = text;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), durationMs);
}

// ── GAME INIT ────────────────────────────────────────────────
function initGame() {
  // Stop any running loop
  gameRunning = false;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

  gameState = freshState();
  resizeCanvas();
  document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
  showScreen('game-screen');
  updateUI();

  // Use performance.now() throughout — matches rAF timestamps
  const t0 = performance.now();
  gameState.lastTick   = t0;
  gameState.nextSlDrop = t0 + SL_DROP_MS;
  gameState.phase      = 'intermission';
  gameState.waveStartTime = t0 + 3000;

  showWaveBanner('WAVE 1 — INCOMING!', 2500);
  gameRunning = true;
  rafId = requestAnimationFrame(gameLoop);
}

// ── WAVE MANAGEMENT ──────────────────────────────────────────
function startWave(waveIdx) {
  const now = performance.now();
  const schedule = WAVES[waveIdx];
  gameState.waveSchedule    = schedule.map(([type, delay]) => [type, now + delay]);
  gameState.waveEnemiesLeft = schedule.length;
  gameState.phase = 'wave';
}

function checkWaveCleared() {
  const g = gameState;
  if (g.waveSchedule.length > 0) return;       // still spawning
  if (g.enemies.length > 0) return;            // still alive
  if (g.waveEnemiesLeft > 0) return;           // count mismatch safety

  if (g.wave >= 3) {
    endGame(true);
  } else {
    g.phase = 'intermission';
    g.wave++;
    updateUI();
    const delay = g.wave === 3 ? 6000 : 5000;
    showWaveBanner(`WAVE ${g.wave} — INCOMING!`, 2500);
    g.waveStartTime = performance.now() + delay;
  }
}

function killEnemy(idx) {
  const g = gameState;
  const e = g.enemies[idx];
  g.score += e.points;
  g.waveEnemiesLeft = Math.max(0, g.waveEnemiesLeft - 1);
  spawnParticles(e.x, e.y, e.color, 8);
  g.enemies.splice(idx, 1);
  updateUI();
}

// ── SPAWN ────────────────────────────────────────────────────
function spawnEnemy(type) {
  const def = ENEMY_DEFS[type];
  const row = type === 'boss' ? Math.floor(ROWS / 2) : Math.floor(Math.random() * ROWS);
  // speed: cells/sec → px/ms
  const pxPerMs = (def.speed * CELL_W) / 1000;

  gameState.enemies.push({
    id: uid(), type, row,
    x: CW + CELL_W,
    y: GRID_Y + row * CELL_H + CELL_H / 2,
    hp: def.hp, maxHp: def.hp,
    speed: pxPerMs,
    icon: def.icon, color: def.color,
    damage: def.damage, dmgMs: def.dmgMs, dmgTimer: 0,
    stunned: 0,
    erratic: def.erratic || false, erraticTimer: 0,
    isBoss: def.isBoss || false,
    points: def.points,
    spitTimer: def.isBoss ? 3000 : 0,
  });
}

// ── DEFENDERS ────────────────────────────────────────────────
function placeDefender(row, col, type) {
  const g   = gameState;
  const def = UNIT_DEFS[type];
  if (g.sunlight < def.cost)       return;
  if (g.grid[row][col] !== null)   return;
  if (col === 0)                   return; // houses column

  const d = {
    id: uid(), type, row, col,
    x: GRID_X + col * CELL_W + CELL_W / 2,
    y: GRID_Y + row * CELL_H + CELL_H / 2,
    hp: def.hp, maxHp: def.hp,
    icon: def.icon, color: def.color,
    stunned: 0,
  };
  if (def.genSL)  { d.slTimer = 0;     d.slMs    = def.genMs;  d.genSL   = def.genSL;   }
  if (def.ranged) { d.fireTimer = 0;   d.fireMs  = def.fireMs; d.damage  = def.damage;   }
  if (def.melee)  { d.meleeTimer = 0;  d.meleeMs = def.meleeMs; d.damage = def.damage;   }

  g.grid[row][col] = d.id;
  g.defenders.push(d);
  g.sunlight -= def.cost;
  updateUI();
}

function removeDefender(row, col) {
  const id = gameState.grid[row][col];
  if (!id) return;
  gameState.grid[row][col] = null;
  gameState.defenders = gameState.defenders.filter(d => d.id !== id);
}

// ── SUNLIGHT TOKENS ──────────────────────────────────────────
function dropSlToken() {
  const count = Math.random() < 0.3 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    gameState.slTokens.push({
      id: uid(),
      x: CELL_W * 0.6 + Math.random() * (CW - CELL_W * 1.2),
      y: 10,
      vy: 0.04,   // px/ms — falls ~40px/s
      radius: CELL_W * 0.2,
      ttl: 8000,
    });
  }
}

// ── PROJECTILES ──────────────────────────────────────────────
function fireNote(defender) {
  // speed: cells/sec → px/ms
  const pxPerMs = (UNIT_DEFS.note.projSpeed * CELL_W) / 1000;
  gameState.projectiles.push({
    id: uid(),
    ownerId: defender.id,
    row: defender.row,
    x: defender.x + CELL_W * 0.3,
    y: defender.y,
    vx: pxPerMs,
    damage: defender.damage,
    hit: new Set(),
  });
}

function bossSpitSeed(boss) {
  const targetRow = Math.floor(Math.random() * ROWS);
  const targetCol = 1 + Math.floor(Math.random() * (COLS - 2));
  const pxPerMs   = (CELL_W * 2.5) / 1000;
  gameState.projectiles.push({
    id: uid(),
    isBossSeed: true,
    x: boss.x, y: boss.y,
    tx: GRID_X + targetCol * CELL_W + CELL_W / 2,
    ty: GRID_Y + targetRow * CELL_H + CELL_H / 2,
    speed: pxPerMs,
    hit: new Set(),
  });
}

// ── PARTICLES ────────────────────────────────────────────────
function spawnParticles(x, y, color, count = 6) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 0.05 + Math.random() * 0.15; // px/ms
    gameState.particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      color,
      radius: 3 + Math.random() * 4,
      ttl: 400 + Math.random() * 400,
      life: 0,
    });
  }
}

// ── MAIN GAME LOOP ───────────────────────────────────────────
function gameLoop(now) {
  if (!gameRunning) return;
  const g  = gameState;
  if (g.phase === 'won' || g.phase === 'lost') return;

  const dt = Math.min(now - g.lastTick, 80);
  g.lastTick = now;

  // ── Sunlight drops
  if (now >= g.nextSlDrop) {
    dropSlToken();
    g.nextSlDrop = now + SL_DROP_MS;
  }

  // ── Intermission → wave
  if (g.phase === 'intermission' && g.waveStartTime && now >= g.waveStartTime) {
    startWave(g.wave - 1);
  }

  // ── Scheduled spawns
  if (g.phase === 'wave') {
    while (g.waveSchedule.length > 0 && now >= g.waveSchedule[0][1]) {
      const [type] = g.waveSchedule.shift();
      spawnEnemy(type);
    }
  }

  // ── SL tokens fall
  for (let i = g.slTokens.length - 1; i >= 0; i--) {
    const t = g.slTokens[i];
    t.y   += t.vy * dt;
    t.ttl -= dt;
    if (t.ttl <= 0 || t.y > CH + 20) g.slTokens.splice(i, 1);
  }

  // ── Defenders
  for (let di = g.defenders.length - 1; di >= 0; di--) {
    const d = g.defenders[di];
    if (d.hp <= 0) {
      spawnParticles(d.x, d.y, d.color);
      g.grid[d.row][d.col] = null;
      g.defenders.splice(di, 1);
      continue;
    }
    if (d.stunned > 0) { d.stunned = Math.max(0, d.stunned - dt); continue; }

    // Sunscreen Cooler
    if (d.slTimer !== undefined) {
      d.slTimer += dt;
      if (d.slTimer >= d.slMs) {
        d.slTimer = 0;
        g.sunlight += d.genSL;
        spawnParticles(d.x, d.y - CELL_H * 0.3, '#FFD700', 4);
        updateUI();
      }
    }

    // Note Launcher — fire when enemy in lane ahead
    if (d.fireTimer !== undefined) {
      const hasTarget = g.enemies.some(e => e.row === d.row && e.x > d.x);
      if (hasTarget) {
        d.fireTimer += dt;
        if (d.fireTimer >= d.fireMs) {
          d.fireTimer = 0;
          fireNote(d);
        }
      } else {
        // Reset timer so it fires quickly when next enemy enters lane
        d.fireTimer = Math.min(d.fireTimer, d.fireMs * 0.8);
      }
    }

    // Bro-Tank Bruiser — melee stomp
    if (d.meleeTimer !== undefined) {
      d.meleeTimer += dt;
      if (d.meleeTimer >= d.meleeMs) {
        d.meleeTimer = 0;
        for (let ei = g.enemies.length - 1; ei >= 0; ei--) {
          const e = g.enemies[ei];
          if (e.row === d.row && Math.abs(e.x - d.x) < CELL_W * 0.85) {
            e.hp -= d.damage;
            spawnParticles(e.x, e.y, '#FF4444', 4);
          }
        }
      }
    }
  }

  // ── Projectiles
  for (let pi = g.projectiles.length - 1; pi >= 0; pi--) {
    const p = g.projectiles[pi];

    if (p.isBossSeed) {
      const dx   = p.tx - p.x;
      const dy   = p.ty - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < p.speed * dt * 2) {
        // Landed — stun nearby defenders
        for (const d of g.defenders) {
          if (Math.abs(d.x - p.tx) < CELL_W * 1.5 && Math.abs(d.y - p.ty) < CELL_H * 1.5) {
            d.stunned = 3000;
            g.stunMessages.push({ x: d.x, y: d.y - CELL_H * 0.6, text: '😵 STUNNED!', ttl: 1500 });
          }
        }
        spawnParticles(p.tx, p.ty, '#FF9900', 10);
        g.projectiles.splice(pi, 1);
        continue;
      }
      const nx = dx / dist;
      const ny = dy / dist;
      p.x += nx * p.speed * dt;
      p.y += ny * p.speed * dt;

    } else {
      // HOA note flies rightward
      p.x += p.vx * dt;
      if (p.x > CW + CELL_W) { g.projectiles.splice(pi, 1); continue; }

      let projRemoved = false;
      for (let ei = g.enemies.length - 1; ei >= 0; ei--) {
        const e = g.enemies[ei];
        if (e.row !== p.row || p.hit.has(e.id)) continue;
        if (Math.abs(p.x - e.x) < CELL_W * 0.45 && Math.abs(p.y - e.y) < CELL_H * 0.45) {
          p.hit.add(e.id);
          e.hp -= p.damage;
          spawnParticles(e.x, e.y, '#FF4444', 3);
          if (e.hp <= 0) {
            killEnemy(ei);
            g.projectiles.splice(pi, 1);
            projRemoved = true;
            checkWaveCleared();
          }
          break;
        }
      }
      if (projRemoved) continue;
    }
  }

  // ── Enemies
  for (let ei = g.enemies.length - 1; ei >= 0; ei--) {
    const e = g.enemies[ei];

    if (e.hp <= 0) {
      killEnemy(ei);
      checkWaveCleared();
      continue;
    }
    if (e.stunned > 0) { e.stunned = Math.max(0, e.stunned - dt); continue; }

    // Creeping Charlie erratic lane switch
    if (e.erratic) {
      e.erraticTimer += dt;
      if (e.erraticTimer > 2000 + Math.random() * 1500) {
        e.erraticTimer = 0;
        const candidates = [e.row - 1, e.row + 1].filter(r => r >= 0 && r < ROWS);
        if (candidates.length && Math.random() < 0.45) {
          e.row = candidates[Math.floor(Math.random() * candidates.length)];
          e.y   = GRID_Y + e.row * CELL_H + CELL_H / 2;
        }
      }
    }

    // Boss spit
    if (e.isBoss) {
      e.spitTimer -= dt;
      if (e.spitTimer <= 0) {
        e.spitTimer = 4000 + Math.random() * 2000;
        bossSpitSeed(e);
      }
    }

    // Find closest blocker in this row
    let blocker  = null;
    let minDist  = Infinity;
    for (const d of g.defenders) {
      if (d.row !== e.row) continue;
      const dist = d.x - e.x;
      if (dist > 0 && dist < CELL_W * 1.2 && dist < minDist) {
        minDist = dist; blocker = d;
      }
    }

    if (blocker && minDist < CELL_W * 0.55) {
      // Attack blocker
      e.dmgTimer += dt;
      if (e.dmgTimer >= e.dmgMs) {
        e.dmgTimer = 0;
        blocker.hp -= e.damage;
        spawnParticles(blocker.x, blocker.y, '#FF4444', 3);
      }
    } else {
      // Move left (slow approach if blocker nearby but not touching)
      const factor = blocker ? 0.25 : 1;
      e.x -= e.speed * dt * factor;
    }

    // Crossed left boundary — lose a life
    if (e.x < GRID_X + CELL_W * 0.5) {
      g.lives--;
      spawnParticles(GRID_X + CELL_W * 0.5, e.y, '#E63946', 12);
      // Don't count this toward waveEnemiesLeft — enemy escaped, not killed
      g.enemies.splice(ei, 1);
      updateUI();
      if (g.lives <= 0) { endGame(false); return; }
    }
  }

  // ── Particles
  for (let pi = g.particles.length - 1; pi >= 0; pi--) {
    const p = g.particles[pi];
    p.x    += p.vx * dt;
    p.y    += p.vy * dt;
    p.vy   += 0.0003 * dt; // gravity
    p.life += dt;
    if (p.life >= p.ttl) g.particles.splice(pi, 1);
  }

  // ── Stun messages decay
  for (let si = g.stunMessages.length - 1; si >= 0; si--) {
    g.stunMessages[si].ttl -= dt;
    if (g.stunMessages[si].ttl <= 0) g.stunMessages.splice(si, 1);
  }

  draw(now);
  rafId = requestAnimationFrame(gameLoop);
}

// ── DRAW ─────────────────────────────────────────────────────
function draw(now) {
  const g = gameState;
  ctx.clearRect(0, 0, CW, CH);

  // Sky strip
  ctx.fillStyle = '#FFE033';
  ctx.fillRect(0, 0, CW, CELL_H);

  // Grid lanes
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = GRID_X + col * CELL_W;
      const y = GRID_Y + row * CELL_H;
      if (row === 2) {
        ctx.fillStyle = col % 2 === 0 ? '#383838' : '#2e2e2e';
      } else {
        const dark = row % 2 === 0;
        ctx.fillStyle = dark
          ? (col % 2 === 0 ? '#5DBB63' : '#56B35A')
          : (col % 2 === 0 ? '#4EAA54' : '#48A24D');
      }
      ctx.fillRect(x, y, CELL_W, CELL_H);
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(x, y, CELL_W, CELL_H);
    }
  }

  // MEGA Houses column highlight
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(GRID_X, GRID_Y, CELL_W, CELL_H * ROWS);

  // House icons (dim if lost)
  ctx.font = `${CELL_W * 0.42}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const houseEmojis = ['🏠','🏡','🏠','🏡','🏠'];
  for (let row = 0; row < ROWS; row++) {
    ctx.globalAlpha = row < g.lives ? 0.75 : 0.12;
    ctx.fillText(houseEmojis[row], GRID_X + CELL_W / 2, GRID_Y + row * CELL_H + CELL_H / 2);
  }
  ctx.globalAlpha = 1;

  // Entrance island highlight
  ctx.fillStyle = 'rgba(120,180,60,0.22)';
  ctx.fillRect(GRID_X + 8 * CELL_W, GRID_Y, CELL_W, CELL_H * ROWS);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.font = `bold ${CELL_W * 0.13}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('ENTRANCE', GRID_X + 8.5 * CELL_W, GRID_Y + CELL_H * ROWS * 0.5);

  // Danger boundary line
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(230,57,70,0.55)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(GRID_X + CELL_W, GRID_Y);
  ctx.lineTo(GRID_X + CELL_W, GRID_Y + CELL_H * ROWS);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Defenders
  for (const d of g.defenders) {
    const x = GRID_X + d.col * CELL_W;
    const y = GRID_Y + d.row * CELL_H;
    ctx.fillStyle = d.stunned > 0 ? 'rgba(180,180,255,0.28)' : 'rgba(255,255,255,0.13)';
    ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);

    // HP bar
    const hpPct = d.hp / d.maxHp;
    ctx.fillStyle = '#222';
    ctx.fillRect(x + 4, y + CELL_H - 9, CELL_W - 8, 5);
    ctx.fillStyle = hpPct > 0.5 ? '#3CB371' : hpPct > 0.25 ? '#FFA500' : '#E63946';
    ctx.fillRect(x + 4, y + CELL_H - 9, (CELL_W - 8) * hpPct, 5);

    ctx.font = `${CELL_W * 0.46}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = d.stunned > 0 ? 0.45 : 1;
    ctx.fillText(d.icon, d.x, d.y - 3);
    ctx.globalAlpha = 1;

    if (d.stunned > 0) {
      ctx.font = `${CELL_W * 0.22}px serif`;
      ctx.fillText('⭐', d.x + CELL_W * 0.28, d.y - CELL_H * 0.36);
    }
  }

  // ── Enemies
  for (const e of g.enemies) {
    const size = e.isBoss ? CELL_W * 0.82 : CELL_W * 0.52;

    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + size * 0.42, size * 0.44, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = e.stunned > 0 ? 0.45 : 1;
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(e.icon, e.x, e.y);
    ctx.globalAlpha = 1;

    // HP bar
    const hpPct = e.hp / e.maxHp;
    const barW  = e.isBoss ? CELL_W * 1.7 : CELL_W * 0.72;
    ctx.fillStyle = '#222';
    ctx.fillRect(e.x - barW / 2, e.y - size * 0.56, barW, 5);
    ctx.fillStyle = hpPct > 0.5 ? '#E63946' : hpPct > 0.25 ? '#FFA500' : '#FF4444';
    ctx.fillRect(e.x - barW / 2, e.y - size * 0.56, barW * hpPct, 5);
  }

  // ── Projectiles
  for (const p of g.projectiles) {
    ctx.font = `${p.isBossSeed ? CELL_W * 0.28 : CELL_W * 0.24}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.isBossSeed ? '🌱' : '📄', p.x, p.y);
  }

  // ── Sunlight tokens
  const pulse = 0.88 + 0.12 * Math.sin((now || 0) / 280);
  for (const t of g.slTokens) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, t.ttl / 900);
    ctx.font = `${CELL_W * 0.34 * pulse}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('☀️', t.x, t.y);
    ctx.restore();
  }

  // ── Particles
  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.ttl);
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.radius * (1 - p.life / p.ttl)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Stun messages
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const sm of g.stunMessages) {
    ctx.globalAlpha = Math.min(1, sm.ttl / 500);
    ctx.font        = `bold ${CELL_W * 0.17}px sans-serif`;
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
    ctx.strokeText(sm.text, sm.x, sm.y);
    ctx.fillStyle = '#fff';
    ctx.fillText(sm.text, sm.x, sm.y);
  }
  ctx.globalAlpha = 1;

  // ── Sky hint text
  ctx.fillStyle   = 'rgba(100,60,0,0.28)';
  ctx.font        = `bold ${CELL_W * 0.14}px sans-serif`;
  ctx.textAlign   = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('☀️ CLICK SUNLIGHT TOKENS TO COLLECT', CELL_W * 0.15, CELL_H / 2);

  // ── Hover highlight
  if (g.selectedUnit && g._hoverCell) {
    const { row, col } = g._hoverCell;
    if (col > 0) {
      const x = GRID_X + col * CELL_W;
      const y = GRID_Y + row * CELL_H;
      const occupied = g.grid[row][col] !== null;
      ctx.fillStyle   = occupied ? 'rgba(230,57,70,0.28)' : 'rgba(255,215,0,0.28)';
      ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
      ctx.strokeStyle = occupied ? '#E63946' : '#FFD700';
      ctx.lineWidth   = 2;
      ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
    }
  }
}

// ── CANVAS EVENTS ────────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  if (!gameState) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx  = (e.clientX - rect.left)  * scaleX;
  const my  = (e.clientY - rect.top)   * scaleY;
  const col = Math.floor((mx - GRID_X) / CELL_W);
  const row = Math.floor((my - GRID_Y) / CELL_H);
  gameState._hoverCell = (col >= 0 && col < COLS && row >= 0 && row < ROWS)
    ? { row, col } : null;
});

canvas.addEventListener('mouseleave', () => { if (gameState) gameState._hoverCell = null; });

canvas.addEventListener('click', e => {
  if (!gameState) return;
  const g    = gameState;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx  = (e.clientX - rect.left)  * scaleX;
  const my  = (e.clientY - rect.top)   * scaleY;

  // SL token click — generous hit radius
  for (let i = g.slTokens.length - 1; i >= 0; i--) {
    const t  = g.slTokens[i];
    const dx = mx - t.x, dy = my - t.y;
    if (dx * dx + dy * dy < (t.radius * 3) ** 2) {
      g.sunlight += 25;
      spawnParticles(t.x, t.y, '#FFD700', 6);
      g.slTokens.splice(i, 1);
      updateUI();
      return;
    }
  }

  // Grid placement / removal
  const col = Math.floor((mx - GRID_X) / CELL_W);
  const row = Math.floor((my - GRID_Y) / CELL_H);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;

  if (g.selectedUnit === 'shovel') { removeDefender(row, col); return; }
  if (g.selectedUnit) {
    const def = UNIT_DEFS[g.selectedUnit];
    if (!def || g.sunlight < def.cost) return;
    placeDefender(row, col, g.selectedUnit);
  }
});

// Touch support
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  canvas.dispatchEvent(new MouseEvent('click', {
    clientX: e.touches[0].clientX,
    clientY: e.touches[0].clientY,
  }));
}, { passive: false });

// ── TOOLBAR ──────────────────────────────────────────────────
// Single unified handler — no duplicate listeners
function selectUnit(type) {
  if (!gameState) return;
  if (gameState.selectedUnit === type) {
    gameState.selectedUnit = null;
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
    return;
  }
  if (type !== 'shovel' && UNIT_DEFS[type] && gameState.sunlight < UNIT_DEFS[type].cost) return;
  gameState.selectedUnit = type;
  document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
  const sel = type === 'shovel'
    ? document.getElementById('btn-shovel')
    : document.querySelector(`.unit-btn[data-unit="${type}"]`);
  if (sel) sel.classList.add('selected');
}

document.querySelectorAll('.unit-btn[data-unit]').forEach(btn => {
  btn.addEventListener('click', () => selectUnit(btn.dataset.unit));
});
document.getElementById('btn-shovel').addEventListener('click', () => selectUnit('shovel'));

// ── END GAME ─────────────────────────────────────────────────
function endGame(won) {
  gameRunning = false;
  gameState.phase = won ? 'won' : 'lost';
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  setTimeout(() => {
    const scoreEl = document.getElementById(won ? 'win-score' : 'loss-score');
    if (scoreEl) scoreEl.textContent = gameState.score;
    showScreen(won ? 'win-screen' : 'loss-screen');
  }, 1200);
}

// ── RESTART ──────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click',        initGame);
document.getElementById('btn-win-restart').addEventListener('click',  initGame);
document.getElementById('btn-loss-restart').addEventListener('click', initGame);

// ── RESIZE ───────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (!gameState) return;
  resizeCanvas();
  for (const d of gameState.defenders) {
    d.x = GRID_X + d.col * CELL_W + CELL_W / 2;
    d.y = GRID_Y + d.row * CELL_H + CELL_H / 2;
  }
  // Recompute enemy speeds for new cell size
  for (const e of gameState.enemies) {
    const def = ENEMY_DEFS[e.type];
    if (def) e.speed = (def.speed * CELL_W) / 1000;
  }
});

// ── BOOT ─────────────────────────────────────────────────────
showScreen('start-screen');
