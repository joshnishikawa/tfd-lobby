require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Server, Origins } = require('boardgame.io/server');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const serve = require('koa-static');
const send = require('koa-send');

const GameLoader = require('./lib/game-loader');
const GroupManager = require('./lib/group-manager');
const MySQLAdapter = require('./lib/mysql-adapter');
const MatchRecorder = require('./lib/match-recorder');

const port = parseInt(process.env.PORT, 10) || 4002;

// Load all self-contained game modules
const gameLoader = new GameLoader(path.join(__dirname, 'game_modules'));
const { games, metadata: gamesMetadata } = gameLoader.loadAll();

const groupManager = new GroupManager();
const mysqlAdapter = new MySQLAdapter();
const matchRecorder = new MatchRecorder();

// Configure boardgame.io Server with Origins and MySQL DB Adapter
const server = Server({
  games,
  db: mysqlAdapter,
  origins: [
    Origins.LOCALHOST,
    'https://theflyingdutchmen.games',
    'https://www.theflyingdutchmen.games',
    'https://lobby.theflyingdutchmen.games',
    'https://forum.theflyingdutchmen.games',
    'https://stats.theflyingdutchmen.games',
    /^https:\/\/.*\.theflyingdutchmen\.games$/,
    'http://localhost:4000',
    'http://localhost:4002'
  ],
});

// Custom API Router
const router = new Router();
const apiBodyParser = bodyParser();

// Middleware: parse request body for custom /api routes
server.app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/api') && ['POST', 'PUT', 'PATCH'].includes(ctx.method)) {
    return apiBodyParser(ctx, next);
  }
  return next();
});

// API: Health Check
router.get('/api/health', (ctx) => {
  ctx.body = {
    status: 'ok',
    service: 'tfd-lobby',
    port,
    gamesCount: games.length,
    timestamp: new Date().toISOString()
  };
});

// API: Discovered Games Metadata
// API: GitHub Webhook for KRED auto-update
try {
  const KredWebhookHandler = require('./game_modules/KRED/scripts/webhook-handler.cjs');
  const kredWebhook = new KredWebhookHandler();
  router.post('/api/webhooks/kred', (ctx) => kredWebhook.handleRequest(ctx));
  router.post('/api/webhooks/github', (ctx) => kredWebhook.handleRequest(ctx));
  router.get('/api/webhooks/kred/logs', (ctx) => kredWebhook.getLogs(ctx));
  console.log('[SERVER] GitHub webhook endpoints registered at /api/webhooks/kred');
} catch (e) {
  console.warn('[SERVER] Could not initialize KRED webhook:', e.message);
}

router.get('/api/games', (ctx) => {
  const isAdmin = ctx.query.admin === 'true' || ctx.query.admin === '1' || ctx.query.all === 'true' || ctx.query.all === '1';
  ctx.body = {
    games: gameLoader.getMetadata({ isAdmin })
  };
});

// Helper function to wipe orphaned and stale matches
async function cleanOrphanedMatches() {
  if (!server.db) return [];
  const wiped = [];
  try {
    const matchIds = await server.db.listMatches();
    const now = Date.now();
    for (const matchId of matchIds) {
      const { metadata } = await server.db.fetch(matchId, { metadata: true });
      if (!metadata) {
        await server.db.wipe(matchId);
        wiped.push(matchId);
        continue;
      }
      const players = Object.values(metadata.players || {});
      const namedPlayers = players.filter(p => p && p.name);
      const connectedPlayers = players.filter(p => p && p.isConnected);
      const age = now - (metadata.updatedAt || metadata.createdAt || 0);

      // 1. Matches with 0 named players
      if (namedPlayers.length === 0) {
        console.log(`[CLEANUP] Wiping empty match ${matchId} (${metadata.gameName})`);
        await server.db.wipe(matchId);
        wiped.push(matchId);
        continue;
      }

      // 2. Matches where all players are disconnected (abandoned) and inactive
      if (connectedPlayers.length === 0 && age > 5 * 60 * 1000) {
        console.log(`[CLEANUP] Wiping abandoned match ${matchId} (${metadata.gameName}, age: ${Math.round(age / 60000)}m)`);
        await server.db.wipe(matchId);
        wiped.push(matchId);
        continue;
      }

      // 3. Completed matches older than 15 minutes
      if (metadata.gameover && age > 15 * 60 * 1000) {
        console.log(`[CLEANUP] Wiping completed match ${matchId} (${metadata.gameName})`);
        const { state } = await server.db.fetch(matchId, { state: true });
        await matchRecorder.recordCompletedMatch(matchId, metadata, state);
        await server.db.wipe(matchId);
        wiped.push(matchId);
        continue;
      }
    }
  } catch (err) {
    console.error('[CLEANUP] Error cleaning matches:', err.message);
  }
  return wiped;
}

// API: Recent Match History Stats
router.get('/api/stats/recent', async (ctx) => {
  const limit = parseInt(ctx.query.limit, 10) || 50;
  const gameName = ctx.query.game || null;
  const history = await matchRecorder.getRecentMatches(limit, gameName);
  ctx.body = { history };
});

router.get('/api/stats/game/:gameId', async (ctx) => {
  const limit = parseInt(ctx.query.limit, 10) || 50;
  const history = await matchRecorder.getRecentMatches(limit, ctx.params.gameId);
  ctx.body = { gameId: ctx.params.gameId, history };
});

// API: Manual / Client Match Wipe
router.delete('/api/matches/:matchId', async (ctx) => {
  const { matchId } = ctx.params;
  try {
    if (server.db) {
      const { metadata, state } = await server.db.fetch(matchId, { metadata: true, state: true });
      if (metadata && (metadata.gameover || (state && state.ctx && state.ctx.gameover))) {
        await matchRecorder.recordCompletedMatch(matchId, metadata, state);
      }
      await server.db.wipe(matchId);
    }
    ctx.body = { success: true, wiped: matchId };
  } catch (err) {
    ctx.status = 500;
    ctx.body = { error: err.message };
  }
});

// API: Trigger Stale Match Cleanup
router.post('/api/matches/cleanup', async (ctx) => {
  const wiped = await cleanOrphanedMatches();
  ctx.body = { success: true, count: wiped.length, wiped };
});

// Run cleanup periodically every 3 minutes
setInterval(cleanOrphanedMatches, 3 * 60 * 1000);

// API: Group-First Matchmaking Endpoints
router.post('/api/groups/create', (ctx) => {
  const { hostName, hostUserId, hostAvatar } = ctx.request.body || {};
  const { group, hostMember } = groupManager.createGroup({ hostName, hostUserId, hostAvatar });
  ctx.body = { group, member: hostMember };
});

router.get('/api/groups/:code', (ctx) => {
  const group = groupManager.getGroup(ctx.params.code);
  if (!group) {
    ctx.status = 404;
    ctx.body = { error: 'Group room not found' };
    return;
  }
  ctx.body = { group };
});

router.post('/api/groups/:code/join', (ctx) => {
  const { memberName, userId, avatar } = ctx.request.body || {};
  try {
    const { group, member } = groupManager.joinGroup(ctx.params.code, { memberName, userId, avatar });
    ctx.body = { group, member };
  } catch (err) {
    ctx.status = 400;
    ctx.body = { error: err.message };
  }
});

router.post('/api/groups/:code/leave', (ctx) => {
  const { memberId } = ctx.request.body || {};
  const group = groupManager.leaveGroup(ctx.params.code, memberId);
  ctx.body = { success: true, group };
});

router.post('/api/groups/:code/select-game', (ctx) => {
  const { memberId, gameId } = ctx.request.body || {};
  try {
    const group = groupManager.selectGame(ctx.params.code, memberId, gameId);
    ctx.body = { group };
  } catch (err) {
    ctx.status = 400;
    ctx.body = { error: err.message };
  }
});

router.post('/api/groups/:code/ready', (ctx) => {
  const { memberId, isReady } = ctx.request.body || {};
  try {
    const group = groupManager.toggleReady(ctx.params.code, memberId, isReady);
    ctx.body = { group };
  } catch (err) {
    ctx.status = 400;
    ctx.body = { error: err.message };
  }
});

router.post('/api/groups/:code/launch', (ctx) => {
  const { memberId, matchId, isPlayAgain } = ctx.request.body || {};
  try {
    const group = groupManager.launchGame(ctx.params.code, memberId, matchId, Boolean(isPlayAgain));
    ctx.body = { group };
  } catch (err) {
    ctx.status = 400;
    ctx.body = { error: err.message };
  }
});

router.post('/api/groups/sync-match', (ctx) => {
  const { matchId, memberName, userId, avatar, gameId, setupData, playerSeat } = ctx.request.body || {};
  try {
    const { group, member } = groupManager.getOrCreateMatchGroup(matchId, { memberName, userId, avatar, gameId, setupData, playerSeat });
    ctx.body = { group, member };
  } catch (err) {
    ctx.status = 400;
    ctx.body = { error: err.message };
  }
});

router.post('/api/groups/:code/play-again', async (ctx) => {
  const { memberId, isPlayAgain } = ctx.request.body || {};
  try {
    const result = groupManager.votePlayAgain(ctx.params.code, memberId, isPlayAgain);
    let group = result.group;

    if (result.allPlayAgain && group && group.selectedGameId) {
      const numPlayers = group.members.length || 2;
      const setupData = group.setupData || {};
      try {
        const createRes = await fetch(`http://127.0.0.1:${port}/games/${group.selectedGameId}/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ numPlayers, setupData })
        });
        if (createRes.ok) {
          const createData = await createRes.json();
          const hostMember = group.members.find(m => m.isHost) || group.members[0];
          group = groupManager.launchGame(ctx.params.code, hostMember.id, createData.matchID, true);
        }
      } catch (e) {
        console.error('[PLAY AGAIN] Error auto-creating match:', e.message);
      }
    }

    ctx.body = { group, allPlayAgain: result.allPlayAgain };
  } catch (err) {
    ctx.status = 400;
    ctx.body = { error: err.message };
  }
});

// Dynamic static asset serving for self-contained game modules (client.js, style.css, images, etc.)
router.get('/game_modules/:gameId', async (ctx) => {
  ctx.redirect(`/game_modules/${ctx.params.gameId}/`);
});

router.get('/game_modules/:gameId/(.*)', async (ctx) => {
  const { gameId } = ctx.params;
  let subPath = ctx.params[0] || '';

  const modulesDir = path.join(__dirname, 'game_modules');
  let gameDir = path.join(modulesDir, gameId);

  // If exact folder does not exist, check case-insensitive match (e.g. 'kred' -> 'KRED')
  if (!fs.existsSync(gameDir)) {
    if (fs.existsSync(modulesDir)) {
      const entries = fs.readdirSync(modulesDir);
      const match = entries.find(e => e.toLowerCase() === gameId.toLowerCase());
      if (match) {
        gameDir = path.join(modulesDir, match);
      }
    }
  }

  if (!fs.existsSync(gameDir)) return;

  if (!subPath || subPath === '/') {
    subPath = fs.existsSync(path.join(gameDir, 'dist', 'index.html')) ? 'dist/index.html' : 'index.html';
  }

  const directPath = path.join(gameDir, subPath);

  // Check direct -> dist/ -> public/
  if (fs.existsSync(directPath) && !fs.statSync(directPath).isDirectory()) {
    await send(ctx, subPath, { root: gameDir });
  } else if (fs.existsSync(path.join(gameDir, 'dist', subPath)) && !fs.statSync(path.join(gameDir, 'dist', subPath)).isDirectory()) {
    await send(ctx, path.join('dist', subPath), { root: gameDir });
  } else if (fs.existsSync(path.join(gameDir, 'public', subPath)) && !fs.statSync(path.join(gameDir, 'public', subPath)).isDirectory()) {
    await send(ctx, path.join('public', subPath), { root: gameDir });
  } else if (fs.existsSync(path.join(directPath, 'index.html'))) {
    await send(ctx, path.join(subPath, 'index.html'), { root: gameDir });
  }
});

server.app.use(router.routes()).use(router.allowedMethods());

// Serve static assets from public/
const publicDir = path.join(__dirname, 'public');
server.app.use(serve(publicDir));

// Fallback to index.html for SPA client navigation
server.app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && !ctx.path.startsWith('/api') && !ctx.path.startsWith('/games') && !ctx.path.startsWith('/game_modules')) {
    await send(ctx, 'index.html', { root: publicDir });
  } else {
    await next();
  }
});

// Run server
server.run(port, () => {
  console.log(`======================================================`);
  console.log(`🎲 The Flying Dutchmen Game Lobby & Matchmaking Server`);
  console.log(`🚀 Running on: http://localhost:${port}`);
  console.log(`🌐 Public domain: https://lobby.theflyingdutchmen.games`);
  console.log(`📦 Active Games Loaded: ${games.map(g => g.name).join(', ')}`);
  console.log(`======================================================`);
});
