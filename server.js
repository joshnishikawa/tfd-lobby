require('dotenv').config();
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

router.get('/game_modules/:gameId/:filename', async (ctx) => {
  const { gameId, filename } = ctx.params;
  const gameDir = path.join(__dirname, 'game_modules', gameId);
  if (require('fs').existsSync(path.join(gameDir, filename))) {
    await send(ctx, filename, { root: gameDir });
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
