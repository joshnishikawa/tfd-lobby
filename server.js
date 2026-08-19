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

const port = parseInt(process.env.PORT, 10) || 4002;

// Load all self-contained game modules
const gameLoader = new GameLoader(path.join(__dirname, 'game_modules'));
const { games, metadata: gamesMetadata } = gameLoader.loadAll();

const groupManager = new GroupManager();

// Configure boardgame.io Server with Origins
const server = Server({
  games,
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
router.get('/api/games', (ctx) => {
  const { metadata } = gameLoader.loadAll();
  ctx.body = {
    games: metadata
  };
});

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
  const { memberId, matchId } = ctx.request.body || {};
  try {
    const group = groupManager.launchGame(ctx.params.code, memberId, matchId);
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
router.get('/game_modules/:gameId/(.*)', async (ctx) => {
  const { gameId } = ctx.params;
  const subPath = ctx.params[0] || '';
  if (!subPath) return;

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

  let targetPath = subPath;
  const directPath = path.join(gameDir, targetPath);

  // Check if file exists directly or inside gameDir/public/
  if (!fs.existsSync(directPath)) {
    const publicPath = path.join(gameDir, 'public', targetPath);
    if (fs.existsSync(publicPath)) {
      targetPath = path.join('public', targetPath);
    }
  }

  if (fs.existsSync(path.join(gameDir, targetPath))) {
    await send(ctx, targetPath, { root: gameDir });
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
