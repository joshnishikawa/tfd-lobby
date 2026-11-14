const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool, initSchema } = require('./db');

const ALLOWED_MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
};

const MAX_ASSET_BYTES = 8 * 1024 * 1024; // 8 MB per baked image/SVG asset
const MAX_TOTAL_ASSETS = 500;

class PublishedSandboxStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, '../data');
    this.assetsRoot = options.assetsRoot || path.join(this.dataDir, 'published_assets');
    this.embeddedFile = path.join(this.dataDir, 'published_sandboxes.json');
    this.byId = new Map();
    this.loaded = false;
  }

  ensureDirs() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.assetsRoot)) {
      fs.mkdirSync(this.assetsRoot, { recursive: true });
    }
  }

  async loadAll() {
    this.ensureDirs();
    await initSchema();
    const activeType = await pool.getActiveType();
    this.byId.clear();

    if (activeType === 'mysql') {
      const [rows] = await pool.query('SELECT * FROM published_sandboxes ORDER BY updated_at DESC, sandbox_id DESC');
      for (const row of rows) {
        const record = this._hydrateRow(row);
        if (record) this.byId.set(record.sandboxId, record);
      }
    } else if (fs.existsSync(this.embeddedFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.embeddedFile, 'utf8'));
        const list = Array.isArray(raw) ? raw : Object.values(raw || {});
        for (const item of list) {
          const record = this._hydrateRow(item);
          if (record) this.byId.set(record.sandboxId, record);
        }
      } catch (err) {
        console.warn('[PUBLISHED-SANDBOX] Could not read embedded store:', err.message);
      }
    }

    this.loaded = true;
    console.log(`[PUBLISHED-SANDBOX] Loaded ${this.byId.size} published sandbox game(s) (Admin Only).`);
    return Array.from(this.byId.values());
  }

  _hydrateRow(row) {
    if (!row) return null;
    const sandboxId = Number(row.sandbox_id ?? row.sandboxId);
    if (!Number.isInteger(sandboxId) || sandboxId <= 0) return null;

    let playerCounts = row.player_counts ?? row.playerCounts ?? [1, 2, 3, 4];
    if (typeof playerCounts === 'string') {
      try { playerCounts = JSON.parse(playerCounts); } catch (_) { playerCounts = [1, 2, 3, 4]; }
    }
    if (!Array.isArray(playerCounts) || playerCounts.length === 0) {
      playerCounts = [1, 2, 3, 4];
    }

    let snapshot = row.snapshot_json ?? row.snapshot ?? {};
    if (typeof snapshot === 'string') {
      try { snapshot = JSON.parse(snapshot); } catch (_) { snapshot = {}; }
    }

    const minPlayers = Math.max(1, Number(row.min_players ?? row.minPlayers ?? playerCounts[0]) || 1);
    const maxPlayers = Math.min(6, Math.max(minPlayers, Number(row.max_players ?? row.maxPlayers ?? playerCounts[playerCounts.length - 1]) || 4));

    return {
      sandboxId,
      projectId: Number(row.project_id ?? row.projectId) || 0,
      slug: String(row.slug || `sandbox-${sandboxId}`),
      name: String(row.name || `Sandbox #${sandboxId}`),
      description: String(row.description || ''),
      playerCounts: playerCounts.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 6),
      minPlayers,
      maxPlayers,
      version: Number(row.version) || 1,
      snapshot,
      publishedBy: row.published_by ?? row.publishedBy ?? null,
      publishedAt: row.published_at ?? row.publishedAt ?? new Date().toISOString()
    };
  }

  _saveEmbedded() {
    this.ensureDirs();
    const list = Array.from(this.byId.values());
    fs.writeFileSync(this.embeddedFile, JSON.stringify(list, null, 2), 'utf8');
  }

  /**
   * Persist validated image/SVG assets to disk and return a map of assetKey -> public URL.
   */
  _writeAssets(sandboxId, assetsMap) {
    this.ensureDirs();
    const sandboxAssetDir = path.join(this.assetsRoot, String(sandboxId));
    if (!fs.existsSync(sandboxAssetDir)) {
      fs.mkdirSync(sandboxAssetDir, { recursive: true });
    }

    const urlByKey = {};
    if (!assetsMap || typeof assetsMap !== 'object') {
      return urlByKey;
    }

    const entries = Array.isArray(assetsMap)
      ? assetsMap.slice(0, MAX_TOTAL_ASSETS).map((item) => [item && item.key, item])
      : Object.entries(assetsMap).slice(0, MAX_TOTAL_ASSETS);

    for (const [assetKey, assetData] of entries) {
      if (!assetKey || !assetData) continue;

      let mimeType = '';
      let base64Body = '';

      if (typeof assetData === 'string' && assetData.startsWith('data:')) {
        const match = assetData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
        if (!match) continue;
        mimeType = match[1].toLowerCase();
        base64Body = match[2].replace(/\s+/g, '');
      } else if (typeof assetData === 'object') {
        mimeType = String(assetData.mimeType || '').toLowerCase();
        base64Body = String(assetData.base64 || assetData.dataBase64 || '').replace(/\s+/g, '');
      }

      const ext = ALLOWED_MIME_EXT[mimeType];
      if (!ext || !base64Body) continue;

      const buf = Buffer.from(base64Body, 'base64');
      if (!buf || buf.length === 0 || buf.length > MAX_ASSET_BYTES) continue;

      const digest = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20);
      const filename = `asset_${digest}.${ext}`;
      const targetPath = path.join(sandboxAssetDir, filename);
      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, buf);
      }

      urlByKey[assetKey] = `/published-sandbox-assets/${sandboxId}/${filename}`;
    }

    return urlByKey;
  }

  /**
   * Rewrite asset references inside snapshot objects so the lobby runner only loads local served URLs.
   */
  _rewriteSnapshotAssets(snapshot, urlByKey) {
    if (!snapshot || typeof snapshot !== 'object') return {};
    const cloned = JSON.parse(JSON.stringify(snapshot));

    const resolveUrl = (val, fallbackKey) => {
      if (fallbackKey && urlByKey[fallbackKey]) return urlByKey[fallbackKey];
      if (typeof val === 'string' && urlByKey[val]) return urlByKey[val];
      if (typeof val === 'string' && val.startsWith('assetref:')) {
        const key = val.slice('assetref:'.length);
        if (urlByKey[key]) return urlByKey[key];
      }
      if (typeof val === 'string' && val.startsWith('/published-sandbox-assets/')) return val;
      if (typeof val === 'string' && val.startsWith('data:image/')) return val;
      return null;
    };

    if (cloned.boardObjects && typeof cloned.boardObjects === 'object') {
      for (const obj of Object.values(cloned.boardObjects)) {
        if (!obj || typeof obj !== 'object') continue;
        if (obj.imageUrl !== undefined) {
          obj.imageUrl = resolveUrl(obj.imageUrl, obj._bakedAssetKey || obj.imageUrl) || obj.imageUrl;
        }
        if (obj.frontImageUrl !== undefined || obj._bakedFrontKey) {
          obj.frontImageUrl = resolveUrl(obj.frontImageUrl, obj._bakedFrontKey || obj.frontImageUrl) || obj.frontImageUrl;
        }
        if (obj.backImageUrl !== undefined || obj._bakedBackKey) {
          obj.backImageUrl = resolveUrl(obj.backImageUrl, obj._bakedBackKey || obj.backImageUrl) || obj.backImageUrl;
        }
        delete obj._bakedAssetKey;
        delete obj._bakedFrontKey;
        delete obj._bakedBackKey;
        delete obj.canvasJson;
      }
    }

    return cloned;
  }

  async publishSandbox(payload) {
    const sandboxId = Number(payload.sandboxId);
    if (!Number.isInteger(sandboxId) || sandboxId <= 0) {
      throw new Error('Invalid sandboxId.');
    }

    const projectId = Number(payload.projectId) || 0;
    const name = String(payload.name || `Sandbox #${sandboxId}`).trim().slice(0, 150);
    if (!name) throw new Error('Game name is required.');

    const description = String(payload.description || '').trim().slice(0, 2000);
    const minPlayers = Math.max(1, Math.min(6, Number(payload.minPlayers) || 1));
    const maxPlayers = Math.max(minPlayers, Math.min(6, Number(payload.maxPlayers) || minPlayers));

    let playerCounts = Array.isArray(payload.playerCounts)
      ? payload.playerCounts.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= minPlayers && n <= maxPlayers)
      : [];
    if (playerCounts.length === 0) {
      for (let i = minPlayers; i <= maxPlayers; i++) playerCounts.push(i);
    }

    const existing = this.byId.get(sandboxId);
    const version = existing ? existing.version + 1 : 1;
    const slug = `sandbox-${sandboxId}`;

    const urlByKey = this._writeAssets(sandboxId, payload.assets);
    const cleanSnapshot = this._rewriteSnapshotAssets(payload.snapshot || {}, urlByKey);
    const nowIso = new Date().toISOString();
    const nowMysql = nowIso.slice(0, 19).replace('T', ' ');
    const publishedBy = payload.publishedBy ? String(payload.publishedBy).slice(0, 100) : null;

    await initSchema();
    const activeType = await pool.getActiveType();

    if (activeType === 'mysql') {
      await pool.execute(
        `INSERT INTO published_sandboxes
          (sandbox_id, project_id, slug, name, description, player_counts, min_players, max_players, version, snapshot_json, published_by, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          project_id = VALUES(project_id),
          slug = VALUES(slug),
          name = VALUES(name),
          description = VALUES(description),
          player_counts = VALUES(player_counts),
          min_players = VALUES(min_players),
          max_players = VALUES(max_players),
          version = VALUES(version),
          snapshot_json = VALUES(snapshot_json),
          published_by = VALUES(published_by),
          published_at = VALUES(published_at)`,
        [
          sandboxId,
          projectId,
          slug,
          name,
          description,
          JSON.stringify(playerCounts),
          minPlayers,
          maxPlayers,
          version,
          JSON.stringify(cleanSnapshot),
          publishedBy,
          nowMysql
        ]
      );
    }

    const record = {
      sandboxId,
      projectId,
      slug,
      name,
      description,
      playerCounts,
      minPlayers,
      maxPlayers,
      version,
      snapshot: cleanSnapshot,
      publishedBy,
      publishedAt: nowIso
    };
    this.byId.set(sandboxId, record);

    if (activeType !== 'mysql') {
      this._saveEmbedded();
    }

    return record;
  }

  async unpublishSandbox(sandboxId) {
    const id = Number(sandboxId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Invalid sandboxId.');
    }

    await initSchema();
    const activeType = await pool.getActiveType();
    if (activeType === 'mysql') {
      await pool.execute('DELETE FROM published_sandboxes WHERE sandbox_id = ?', [id]);
    }

    const existed = this.byId.delete(id);
    if (activeType !== 'mysql') {
      this._saveEmbedded();
    }

    const assetDir = path.join(this.assetsRoot, String(id));
    if (fs.existsSync(assetDir)) {
      fs.rmSync(assetDir, { recursive: true, force: true });
    }

    return existed;
  }

  getSandboxSync(sandboxId) {
    const id = Number(sandboxId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return this.byId.get(id) || null;
  }

  getCatalogEntries() {
    return Array.from(this.byId.values()).map((rec) => ({
      id: rec.slug,
      runnerGameId: 'sandbox-runner',
      publishedSandboxId: rec.sandboxId,
      isPublishedSandbox: true,
      name: rec.name,
      dirName: 'sandbox-runner',
      description: rec.description || 'Published 2D tabletop prototype from TFD Board Game Studio.',
      playerCounts: rec.playerCounts,
      minPlayers: rec.minPlayers,
      maxPlayers: rec.maxPlayers,
      icon: 'bi-grid-1x2-fill',
      tags: ['sandbox', 'admin-only'],
      version: `1.0.${rec.version}`,
      modes: [
        {
          id: 'standard',
          name: 'Tabletop Play',
          description: 'Playtest the published tabletop layout with real-time seat sync.',
          isDefault: true
        }
      ],
      enabled: false
    }));
  }

  resolveAssetPath(sandboxId, filename) {
    const id = Number(sandboxId);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!filename || !/^[a-zA-Z0-9_.-]+$/.test(filename)) return null;
    const baseDir = path.resolve(this.assetsRoot, String(id));
    const fullPath = path.resolve(baseDir, filename);
    if (!fullPath.startsWith(baseDir + path.sep)) return null;
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return null;
    return fullPath;
  }
}

module.exports = new PublishedSandboxStore();
