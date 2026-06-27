// ============================================================
//  ENCLAVE TURF WAR: MEGA vs. The Entrance Weeds
//  game.js — Vanilla JS / Canvas
// ============================================================

'use strict';

// ── CONSTANTS ────────────────────────────────────────────────
const COLS       = 9;
const ROWS       = 5;
const SL_DROP_MS = 5000;   // sunlight token drops every 5s
const GAME_TICK  = 50;     // ms per frame (~20fps for logic)

const UNIT_DEFS = {
  sunscreen: { name:'Sunscreen Cooler', cost:50,  hp:40,   icon:'🧴', color:'#63BFFF', isPassive:true,  genSL:25, genMs:10000 },
  note:      { name:'Note Launcher',    cost:100, hp:80,   icon:'📜', color:'#A8E6A3', isPassive:false, ranged:true, damage:20, fireMs:2000, projSpeed:3 },
  bruiser:   { name:'Bro-Tank Bruiser', cost:150, hp:250,  icon:'💪', color:'#F4A261', isPassive:false, melee:true, damage:30, meleeMs:1200 },
  gate:      { name:'Vinyl Gate',       cost:50,  hp:500,  icon:'🚧', color:'#F0F0F0', isPassive:true  },
};

const ENEMY_DEFS = {
  dandelion: { name:'Dandelion Spore',   hp:60,  speed:0.4, icon:'🌼', color:'#FFE566', damage:10, dmgMs:1200, points:10 },
  crabgrass: { name:'Crabgrass Crawler', hp:250, speed:0.18, icon:'🦀', color:'#88AA44', damage:25, dmgMs:1000, points:25 },
  charlie:   { name:'Creeping Charlie',  hp:80,  speed:0.6, icon:'🌿', color:'#66BB66', damage:10, dmgMs:1000, points:20, erratic:true },
  boss:      { name:'Grand Dandelion',   hp:900, speed:0.12, icon:'🌻', color:'#FF9900', damage:40, dmgMs:1400, points:200, isBoss:true },
};

// Wave definitions — each element is [enemyType, delayMs after wave start]
const WAVES = [
  [ // Wave 1 — introductory
    ['dandelion', 0],   ['dandelion', 3000],  ['dandelion', 6000],
    ['dandelion', 9000], ['crabgrass', 12000], ['dandelion', 15000],
    ['dandelion', 18000],['dandelion', 21000],
  ],
  [ // Wave 2 — mixed + charlies
    ['dandelion', 0],   ['charlie', 2000],    ['dandelion', 4000],
    ['crabgrass', 5000],['charlie', 7000],    ['dandelion', 9000],
    ['crabgrass', 10000],['charlie', 12000],  ['dandelion', 14000],
    ['crabgrass', 16000],['dandelion', 18000],
  ],
  [ // Wave 3 — heavy + BOSS
    ['dandelion', 0],   ['crabgrass', 1000],  ['charlie', 2000],
    ['dandelion', 4000],['crabgrass', 5000],  ['charlie', 6000],
    ['dandelion', 8000],['crabgrass', 9000],  ['charlie', 11000],
    ['boss',      14000],
    ['dandelion',16000],['crabgrass', 18000], ['dandelion', 20000],
  ],
];

// ── STATE ────────────────────────────────────────────────────
let gameState;

function freshState() {
  return {
    sunlight: 150,
    score: 0,
    wave: 1,
    lives: 5,
    phase: 'idle',          // idle | wave | intermission | boss_dead | won | lost
    waveStartTime: null,
    waveSchedule: [],       // remaining spawns [ [type, absoluteTime], ... ]
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
    stunMessages: [],       // { x, y, text, ttl }
  };
}

// ── CANVAS SETUP ─────────────────────────────────────────────
const canvas   = document.getElementById('game-canvas');
const ctx      = canvas.getContext('2d');
let CW, CH, CELL_W, CELL_H, GRID_X, GRID_Y;

function resizeCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const ww   = wrap.clientWidth;
  const wh   = wrap.clientHeight;

  // Maintain a 9:5.4 ratio (9 cols × rows with header row)
  const maxW = Math.min(ww, 900);
  const maxH = wh;

  CELL_W = Math.floor(Math.min(maxW / COLS, maxH / (ROWS + 1)));
  CELL_H = CELL_W;
  CW = CELL_W * COLS;
  CH = CELL_H * (ROWS + 1); // +1 for sun-fall zone at top

  canvas.width  = CW;
  canvas.height = CH;
  canvas.style.width  = CW + 'px';
  canvas.style.height = CH + 'px';

  GRID_X = 0;
  GRID_Y = CELL_H; // row 0 is the sky
}

// ── ID HELPER ────────────────────────────────────────────────
function uid() { return ++gameState.idCounter; }

// ── SCREEN HELPERS ───────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── UI UPDATES ───────────────────────────────────────────────
function updateUI() {
  const g = gameState;
  document.getElementById('ui-sunlight').textContent = g.sunlight;
  document.getElementById('ui-score').textContent    = g.score;
  document.getElementById('ui-wave').textContent     = g.wave;
  document.getElementById('ui-lives').textContent    = '🏠'.repeat(Math.max(0, g.lives));

  // Dim un-affordable buttons
  document.querySelectorAll('.unit-btn[data-unit]').forEach(btn => {
    const type = btn.dataset.unit;
    if (!type) return;
    const cost = UNIT_DEFS[type].cost;
    btn.classList.toggle('disabled-unit', g.sunlight < cost);
  });
}

// ── WAVE BANNER ──────────────────────────────────────────────
function showWaveBanner(text, durationMs = 2000) {
  const banner = document.getElementById('wave-banner');
  document.getElementById('wave-banner-text').textContent = text;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), durationMs);
}

// ── GAME INIT ────────────────────────────────────────────────
function initGame() {
  gameState = freshState();
  resizeCanvas();

  // Clear toolbar selection
  document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
  gameState.selectedUnit = null;

  showScreen('game-screen');
  updateUI();

  gameState.nextSlDrop    = Date.now() + SL_DROP_MS;
  gameState.phase         = 'intermission';
  gameState.waveStartTime = Date.now() + 3000; // 3s grace before wave 1

  showWaveBanner('WAVE 1 — INCOMING!', 2500);

  requestAnimationFrame(gameLoop);
}

// ── START WAVE ───────────────────────────────────────────────
function startWave(waveIdx) {
  const schedule = WAVES[waveIdx];
  const now = Date.now();
  gameState.waveSchedule    = schedule.map(([type, delay]) => [type, now + delay]);
  gameState.waveEnemiesLeft = schedule.length;
  gameState.phase           = 'wave';
}

function waveCleared() {
  if (gameState.wave >= 3) {
    // Final wave boss must be dead — check
    const bossAlive = gameState.enemies.some(e => e.type === 'boss');
    if (bossAlive) return; // still going
    gameState.phase = 'won';
    endGame(true);
  } else {
    gameState.phase = 'intermission';
    gameState.wave++;
    updateUI();
    const delay = gameState.wave === 3 ? 6000 : 5000;
    showWaveBanner(`WAVE ${gameState.wave} — INCOMING!`, 2500);
    gameState.waveStartTime = Date.now() + delay;
  }
}

// ── SPAWN ENEMY ──────────────────────────────────────────────
function spawnEnemy(type) {
  const def  = ENEMY_DEFS[type];
  const row  = type === 'boss'
    ? Math.floor(ROWS / 2)           // boss enters mid
    : Math.floor(Math.random() * ROWS);
  const startX = CW + CELL_W;

  gameState.enemies.push({
    id:        uid(),
    type,
    row,
    x:         startX,
    y:         GRID_Y + row * CELL_H + CELL_H / 2,
    hp:        def.hp,
    maxHp:     def.hp,
    speed:     def.speed * CELL_W / 60, // px per tick (at 20fps)
    icon:      def.icon,
    color:     def.color,
    damage:    def.damage,
    dmgTimer:  0,
    dmgMs:     def.dmgMs,
    stunned:   0,               // ms remaining
    erratic:   def.erratic || false,
    erraticTimer: 0,
    isBoss:    def.isBoss || false,
    attackTarget: null,
    points:    def.points,
    spitTimer: def.isBoss ? 3000 : 0,
  });
}

// ── PLACE DEFENDER ───────────────────────────────────────────
function placeDefender(row, col, type) {
  const def = UNIT_DEFS[type];
  if (gameState.sunlight < def.cost) return;
  if (gameState.grid[row][col] !== null) return;

  const d = {
    id:        uid(),
    type,
    row, col,
    x:         GRID_X + col * CELL_W + CELL_W / 2,
    y:         GRID_Y + row * CELL_H + CELL_H / 2,
    hp:        def.hp,
    maxHp:     def.hp,
    icon:      def.icon,
    color:     def.color,
    stunned:   0,
  };

  if (def.genSL)      { d.slTimer  = 0; d.slMs  = def.genMs; d.genSL = def.genSL; }
  if (def.ranged)     { d.fireTimer= 0; d.fireMs= def.fireMs; d.damage= def.damage; }
  if (def.melee)      { d.meleeTimer=0; d.meleeMs=def.meleeMs; d.damage= def.damage; }

  gameState.grid[row][col] = d.id;
  gameState.defenders.push(d);
  gameState.sunlight -= def.cost;
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
  // Drop 1–2 tokens spread across top of canvas
  const count = Math.random() < 0.3 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    gameState.slTokens.push({
      id: uid(),
      x: CELL_W * 0.5 + Math.random() * (CW - CELL_W),
      y: 8,
      vy: 0.8,
      radius: CELL_W * 0.18,
      ttl: 8000,   // disappears after 8s if not collected
    });
  }
}

// ── PROJECTILE SPAWN ─────────────────────────────────────────
function fireNote(defender) {
  gameState.projectiles.push({
    id:    uid(),
    ownerId: defender.id,
    row:   defender.row,
    x:     defender.x + CELL_W * 0.3,
    y:     defender.y,
    vx:    (UNIT_DEFS.note.projSpeed * CELL_W) / 60,
    damage: defender.damage,
    radius: CELL_W * 0.1,
    hit:   new Set(),
  });
}

// ── BOSS SPIT ────────────────────────────────────────────────
function bossSpitSeed(boss) {
  // targets a random defender/lane area
  const targetRow = Math.floor(Math.random() * ROWS);
  const targetCol = Math.floor(Math.random() * (COLS - 1));
  gameState.projectiles.push({
    id:    uid(),
    isBossSeed: true,
    row:   boss.row,
    x:     boss.x,
    y:     boss.y,
    tx:    GRID_X + targetCol * CELL_W + CELL_W / 2,
    ty:    GRID_Y + targetRow * CELL_H + CELL_H / 2,
    speed: (CELL_W * 1.8) / 60,
    radius: CELL_W * 0.12,
    hit:   new Set(),
  });
}

// ── PARTICLES ────────────────────────────────────────────────
function spawnParticles(x, y, color, count = 6) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 1 + Math.random() * 2.5;
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
let rafId;
function gameLoop(now) {
  const g = gameState;
  if (g.phase === 'won' || g.phase === 'lost') return;

  const dt = Math.min(now - g.lastTick, 100); // cap at 100ms
  g.lastTick = now;

  // ── Sunlight drops
  if (now >= g.nextSlDrop) {
    dropSlToken();
    g.nextSlDrop = now + SL_DROP_MS;
  }

  // ── Intermission → wave start
  if (g.phase === 'intermission' && g.waveStartTime && now >= g.waveStartTime) {
    startWave(g.wave - 1);
  }

  // ── Scheduled enemy spawns
  if (g.phase === 'wave') {
    while (g.waveSchedule.length > 0 && now >= g.waveSchedule[0][1]) {
      const [type] = g.waveSchedule.shift();
      spawnEnemy(type);
    }
  }

  // ── SL tokens drift down & expire
  for (let i = g.slTokens.length - 1; i >= 0; i--) {
    const t = g.slTokens[i];
    t.y   += t.vy;
    t.ttl -= dt;
    if (t.ttl <= 0 || t.y > CH) g.slTokens.splice(i, 1);
  }

  // ── Defenders logic
  for (let di = g.defenders.length - 1; di >= 0; di--) {
    const d = g.defenders[di];

    if (d.hp <= 0) {
      spawnParticles(d.x, d.y, d.color);
      g.grid[d.row][d.col] = null;
      g.defenders.splice(di, 1);
      continue;
    }

    if (d.stunned > 0) { d.stunned -= dt; continue; }

    // Sunscreen Cooler — generate SL
    if (d.slTimer !== undefined) {
      d.slTimer += dt;
      if (d.slTimer >= d.slMs) {
        d.slTimer = 0;
        g.sunlight += d.genSL;
        spawnParticles(d.x, d.y - CELL_H * 0.3, '#FFD700', 4);
        updateUI();
      }
    }

    // Note Launcher — fire
    if (d.fireTimer !== undefined) {
      const hasTarget = g.enemies.some(e => e.row === d.row && e.x > d.x && !e.stunned);
      if (hasTarget) {
        d.fireTimer += dt;
        if (d.fireTimer >= d.fireMs) {
          d.fireTimer = 0;
          fireNote(d);
        }
      }
    }

    // Bro-Tank Bruiser — melee stomp
    if (d.meleeTimer !== undefined) {
      d.meleeTimer += dt;
      if (d.meleeTimer >= d.meleeMs) {
        d.meleeTimer = 0;
        // stomp adjacent enemies in same row within half a cell
        for (const e of g.enemies) {
          if (e.row === d.row && Math.abs(e.x - d.x) < CELL_W * 0.9) {
            e.hp -= d.damage;
            spawnParticles(e.x, e.y, '#FF4444', 4);
            if (e.hp <= 0) {
              g.score += e.points;
              updateUI();
            }
          }
        }
      }
    }
  }

  // ── Projectiles
  for (let pi = g.projectiles.length - 1; pi >= 0; pi--) {
    const p = g.projectiles[pi];

    if (p.isBossSeed) {
      // Move toward target
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < p.speed * 2) {
        // landed — stun all defenders near target
        for (const d of g.defenders) {
          const cx = Math.abs(d.x - p.tx);
          const cy = Math.abs(d.y - p.ty);
          if (cx < CELL_W * 1.5 && cy < CELL_H * 1.5) {
            d.stunned = 3000;
            g.stunMessages.push({ x: d.x, y: d.y - CELL_H*0.6, text:'😵 STUNNED!', ttl:1500 });
          }
        }
        spawnParticles(p.tx, p.ty, '#FF9900', 10);
        g.projectiles.splice(pi, 1);
        continue;
      }
      p.x += (dx / dist) * p.speed;
      p.y += (dy / dist) * p.speed;
    } else {
      // HOA note — flies right
      p.x += p.vx;
      if (p.x > CW + CELL_W) { g.projectiles.splice(pi, 1); continue; }

      // Check collision with enemies
      let removed = false;
      for (let ei = g.enemies.length - 1; ei >= 0; ei--) {
        const e = g.enemies[ei];
        if (e.row !== p.row || p.hit.has(e.id)) continue;
        if (Math.abs(p.x - e.x) < CELL_W * 0.45 && Math.abs(p.y - e.y) < CELL_H * 0.45) {
          p.hit.add(e.id);
          e.hp -= p.damage;
          spawnParticles(e.x, e.y, '#FF4444', 3);
          if (e.hp <= 0) {
            g.score += e.points;
            g.waveEnemiesLeft--;
            spawnParticles(e.x, e.y, e.color, 8);
            g.enemies.splice(ei, 1);
            g.projectiles.splice(pi, 1);
            removed = true;
            updateUI();
            if (g.waveEnemiesLeft <= 0 && g.waveSchedule.length === 0 && g.enemies.length === 0) {
              waveCleared();
            }
          }
          if (removed) break;
        }
      }
    }
  }

  // ── Enemies logic
  for (let ei = g.enemies.length - 1; ei >= 0; ei--) {
    const e = g.enemies[ei];

    if (e.hp <= 0) {
      g.score += e.points;
      g.waveEnemiesLeft--;
      spawnParticles(e.x, e.y, e.color, 8);
      g.enemies.splice(ei, 1);
      updateUI();
      if (g.phase === 'wave' && g.waveEnemiesLeft <= 0 && g.waveSchedule.length === 0 && g.enemies.length === 0) {
        waveCleared();
      }
      continue;
    }

    if (e.stunned > 0) { e.stunned -= dt; continue; }

    // Erratic movement — Creeping Charlie
    if (e.erratic) {
      e.erraticTimer += dt;
      if (e.erraticTimer > 1800 + Math.random() * 1200) {
        e.erraticTimer = 0;
        // try to switch to an adjacent row without a bruiser or gate blocking
        const candidates = [e.row - 1, e.row + 1].filter(r => r >= 0 && r < ROWS);
        if (candidates.length > 0 && Math.random() < 0.4) {
          const newRow = candidates[Math.floor(Math.random() * candidates.length)];
          e.row = newRow;
          e.y   = GRID_Y + e.row * CELL_H + CELL_H / 2;
        }
      }
    }

    // Boss spits seeds
    if (e.isBoss) {
      e.spitTimer -= dt;
      if (e.spitTimer <= 0) {
        e.spitTimer = 4000 + Math.random() * 2000;
        bossSpitSeed(e);
      }
    }

    // Check for blocking defender in same row ahead
    let blocker = null;
    let minDist = Infinity;
    for (const d of g.defenders) {
      if (d.row === e.row && d.x > e.x && d.x - e.x < CELL_W * 1.1) {
        const dist = d.x - e.x;
        if (dist < minDist) { minDist = dist; blocker = d; }
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
    } else if (!blocker) {
      // Move left
      e.x -= e.speed * dt;
    } else {
      // Slow approach to blocker
      e.x -= e.speed * 0.3 * dt;
    }

    // Check if enemy has crossed the left boundary (MEGA houses)
    if (e.x < GRID_X + CELL_W * 0.5) {
      g.lives--;
      spawnParticles(GRID_X + CELL_W * 0.5, e.y, '#E63946', 12);
      g.enemies.splice(ei, 1);
      updateUI();
      if (g.lives <= 0) {
        endGame(false);
        return;
      }
    }
  }

  // ── Particles
  for (let pi = g.particles.length - 1; pi >= 0; pi--) {
    const p = g.particles[pi];
    p.x   += p.vx;
    p.y   += p.vy;
    p.vy  += 0.08;
    p.life += dt;
    if (p.life >= p.ttl) g.particles.splice(pi, 1);
  }

  // ── Stun messages decay
  for (let si = g.stunMessages.length - 1; si >= 0; si--) {
    g.stunMessages[si].ttl -= dt;
    if (g.stunMessages[si].ttl <= 0) g.stunMessages.splice(si, 1);
  }

  // ── Draw
  draw();

  rafId = requestAnimationFrame(gameLoop);
}

// ── DRAW ─────────────────────────────────────────────────────
function draw() {
  const g   = gameState;
  const now = Date.now();

  ctx.clearRect(0, 0, CW, CH);

  // Sky strip (sun-fall zone)
  ctx.fillStyle = '#FFE033';
  ctx.fillRect(0, 0, CW, CELL_H);

  // Grid — alternating lawn lanes + asphalt center
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = GRID_X + col * CELL_W;
      const y = GRID_Y + row * CELL_H;

      // Center row (row 2) is asphalt
      if (row === 2) {
        ctx.fillStyle = col % 2 === 0 ? '#383838' : '#2e2e2e';
      } else {
        ctx.fillStyle = row % 2 === 0
          ? (col % 2 === 0 ? '#5DBB63' : '#56B35A')
          : (col % 2 === 0 ? '#4EAA54' : '#48A24D');
      }
      ctx.fillRect(x, y, CELL_W, CELL_H);

      // Grid lines
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(x, y, CELL_W, CELL_H);
    }
  }

  // MEGA Houses column (col 0 overlay)
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(GRID_X, GRID_Y, CELL_W, CELL_H * ROWS);

  // House icons in col 0
  const houseEmojis = ['🏠','🏡','🏠','🏡','🏠'];
  ctx.font         = `${CELL_W * 0.4}px serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < ROWS; row++) {
    if (row < g.lives) {
      ctx.globalAlpha = 0.7;
    } else {
      ctx.globalAlpha = 0.15;
    }
    ctx.fillText(houseEmojis[row], GRID_X + CELL_W / 2, GRID_Y + row * CELL_H + CELL_H / 2);
  }
  ctx.globalAlpha = 1;

  // Entrance Island (col 8 overlay)
  ctx.fillStyle = 'rgba(120,180,60,0.25)';
  ctx.fillRect(GRID_X + 8 * CELL_W, GRID_Y, CELL_W, CELL_H * ROWS);

  // "ENTRANCE" label
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.font      = `bold ${CELL_W * 0.14}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('ENTRANCE', GRID_X + 8.5 * CELL_W, GRID_Y + CELL_H * ROWS * 0.5);

  // Dashed boundary line on left of col 1
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(230,57,70,0.5)';
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

    // Cell highlight
    ctx.fillStyle = d.stunned > 0 ? 'rgba(150,150,255,0.3)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);

    // HP bar
    const hpPct = d.hp / d.maxHp;
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 4, y + CELL_H - 10, CELL_W - 8, 6);
    ctx.fillStyle = hpPct > 0.5 ? '#3CB371' : hpPct > 0.25 ? '#FFA500' : '#E63946';
    ctx.fillRect(x + 4, y + CELL_H - 10, (CELL_W - 8) * hpPct, 6);

    // Icon
    ctx.font         = `${CELL_W * 0.45}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha  = d.stunned > 0 ? 0.5 : 1;
    ctx.fillText(d.icon, d.x, d.y - 4);
    ctx.globalAlpha = 1;

    // Stun star
    if (d.stunned > 0) {
      ctx.font      = `${CELL_W * 0.22}px serif`;
      ctx.fillText('⭐', d.x + CELL_W * 0.28, d.y - CELL_H * 0.35);
    }
  }

  // ── Enemies
  for (const e of g.enemies) {
    const size = e.isBoss ? CELL_W * 0.8 : CELL_W * 0.5;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + size * 0.4, size * 0.45, size * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stun
    ctx.globalAlpha = e.stunned > 0 ? 0.5 : 1;
    ctx.font        = `${size}px serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.fillText(e.icon, e.x, e.y);
    ctx.globalAlpha = 1;

    // HP bar
    const hpPct = e.hp / e.maxHp;
    const barW  = e.isBoss ? CELL_W * 1.6 : CELL_W * 0.7;
    ctx.fillStyle = '#333';
    ctx.fillRect(e.x - barW/2, e.y - size * 0.55, barW, 5);
    ctx.fillStyle = hpPct > 0.5 ? '#E63946' : hpPct > 0.25 ? '#FFA500' : '#FF4444';
    ctx.fillRect(e.x - barW/2, e.y - size * 0.55, barW * hpPct, 5);
  }

  // ── Projectiles
  for (const p of g.projectiles) {
    if (p.isBossSeed) {
      ctx.font         = `${CELL_W * 0.28}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🌱', p.x, p.y);
    } else {
      // HOA note
      ctx.font         = `${CELL_W * 0.22}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('📄', p.x, p.y);
    }
  }

  // ── Sunlight tokens
  const pulse = 0.9 + 0.1 * Math.sin(now / 300);
  for (const t of g.slTokens) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, t.ttl / 1000);
    ctx.font        = `${CELL_W * 0.32 * pulse}px serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.fillText('☀️', t.x, t.y);
    ctx.restore();
  }

  // ── Particles
  for (const p of g.particles) {
    const alpha = 1 - p.life / p.ttl;
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Stun messages
  for (const sm of g.stunMessages) {
    ctx.globalAlpha = Math.min(1, sm.ttl / 600);
    ctx.font        = `bold ${CELL_W * 0.18}px sans-serif`;
    ctx.fillStyle   = '#fff';
    ctx.strokeStyle = '#333';
    ctx.lineWidth   = 3;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.strokeText(sm.text, sm.x, sm.y);
    ctx.fillText(sm.text, sm.x, sm.y);
  }
  ctx.globalAlpha = 1;

  // ── Sky label
  ctx.fillStyle   = 'rgba(100,60,0,0.3)';
  ctx.font        = `bold ${CELL_W * 0.14}px sans-serif`;
  ctx.textAlign   = 'left';
  ctx.textBaseline= 'middle';
  ctx.fillText('☀️ CLICK SUNLIGHT TOKENS TO COLLECT', CELL_W * 0.2, CELL_H / 2);

  // ── Hover cell highlight
  if (gameState.selectedUnit && gameState._hoverCell) {
    const { row, col } = gameState._hoverCell;
    const x = GRID_X + col * CELL_W;
    const y = GRID_Y + row * CELL_H;
    const occupied = g.grid[row][col] !== null;
    ctx.fillStyle = occupied ? 'rgba(230,57,70,0.3)' : 'rgba(255,215,0,0.3)';
    ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
    ctx.strokeStyle= occupied ? '#E63946' : '#FFD700';
    ctx.lineWidth  = 2;
    ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
  }
}

// ── CANVAS INTERACTION ───────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  if (!gameState) return;
  const rect  = canvas.getBoundingClientRect();
  const mx    = e.clientX - rect.left;
  const my    = e.clientY - rect.top;
  const col   = Math.floor((mx - GRID_X) / CELL_W);
  const row   = Math.floor((my - GRID_Y) / CELL_H);
  if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
    gameState._hoverCell = { row, col };
  } else {
    gameState._hoverCell = null;
  }
});

canvas.addEventListener('mouseleave', () => {
  if (gameState) gameState._hoverCell = null;
});

canvas.addEventListener('click', e => {
  if (!gameState) return;
  const g    = gameState;
  const rect = canvas.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;

  // Check sunlight token clicks first
  for (let i = g.slTokens.length - 1; i >= 0; i--) {
    const t = g.slTokens[i];
    const dx = mx - t.x, dy = my - t.y;
    if (dx*dx + dy*dy < (t.radius * 2.5) ** 2) {
      g.sunlight += 25;
      spawnParticles(t.x, t.y, '#FFD700', 6);
      g.slTokens.splice(i, 1);
      updateUI();
      return;
    }
  }

  // Grid placement
  const col = Math.floor((mx - GRID_X) / CELL_W);
  const row = Math.floor((my - GRID_Y) / CELL_H);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;

  if (g.selectedUnit === 'shovel') {
    removeDefender(row, col);
    return;
  }

  if (g.selectedUnit) {
    const def = UNIT_DEFS[g.selectedUnit];
    if (!def) return;
    if (g.sunlight < def.cost) {
      // Flash toolbar cost
      return;
    }
    if (col === 0) return; // don't place on houses column
    placeDefender(row, col, g.selectedUnit);
  }
});

// ── TOOLBAR BUTTONS ──────────────────────────────────────────
document.querySelectorAll('.unit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!gameState) return;
    const type = btn.dataset.unit || 'shovel';

    if (gameState.selectedUnit === type) {
      // Deselect
      gameState.selectedUnit = null;
      document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
      return;
    }

    // Check affordability
    if (type !== 'shovel' && UNIT_DEFS[type] && gameState.sunlight < UNIT_DEFS[type].cost) return;

    gameState.selectedUnit = type === 'shovel' ? 'shovel' : type;
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

document.getElementById('btn-shovel').addEventListener('click', () => {
  if (!gameState) return;
  if (gameState.selectedUnit === 'shovel') {
    gameState.selectedUnit = null;
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
  } else {
    gameState.selectedUnit = 'shovel';
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('btn-shovel').classList.add('selected');
  }
});

// ── END GAME ─────────────────────────────────────────────────
function endGame(won) {
  if (rafId) cancelAnimationFrame(rafId);
  gameState.phase = won ? 'won' : 'lost';

  setTimeout(() => {
    if (won) {
      document.getElementById('win-score').textContent  = gameState.score;
      showScreen('win-screen');
    } else {
      document.getElementById('loss-score').textContent = gameState.score;
      showScreen('loss-screen');
    }
  }, 1200);
}

// ── SCREEN BUTTONS ───────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click',        initGame);
document.getElementById('btn-win-restart').addEventListener('click',  initGame);
document.getElementById('btn-loss-restart').addEventListener('click', initGame);

// ── RESIZE ───────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (gameState && gameState.phase !== 'won' && gameState.phase !== 'lost') {
    resizeCanvas();
    // Recompute all x/y positions based on new cell size
    for (const d of gameState.defenders) {
      d.x = GRID_X + d.col * CELL_W + CELL_W / 2;
      d.y = GRID_Y + d.row * CELL_H + CELL_H / 2;
    }
  }
});

// ── INITIAL SCREEN ───────────────────────────────────────────
showScreen('start-screen');
