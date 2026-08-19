const fs = require('fs');
const path = require('path');

class GameLoader {
  constructor(gameModulesDir, configPath) {
    this.gameModulesDir = gameModulesDir || path.join(__dirname, '../game_modules');
    this.configPath = configPath || path.join(__dirname, '../games.config.json');
    this.games = [];
    this.gameMetadata = [];
  }

  loadConfig() {
    if (this.configPath && fs.existsSync(this.configPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      } catch (err) {
        console.error(`[GAME-LOADER] Error reading config file ${this.configPath}:`, err.message);
      }
    }
    return {};
  }

  isGameEnabled(config, dirName, manifestId) {
    if (!config || typeof config !== 'object') return true;

    const keysToCheck = [
      manifestId,
      manifestId ? manifestId.toLowerCase() : null,
      dirName,
      dirName.toLowerCase()
    ].filter(Boolean);

    for (const key of keysToCheck) {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        const val = config[key];
        if (typeof val === 'boolean') return val;
        if (typeof val === 'object' && val !== null && typeof val.enabled === 'boolean') {
          return val.enabled;
        }
      }
    }

    for (const [confKey, val] of Object.entries(config)) {
      const lowerConfKey = confKey.toLowerCase();
      if (keysToCheck.some(k => k.toLowerCase() === lowerConfKey)) {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'object' && val !== null && typeof val.enabled === 'boolean') {
          return val.enabled;
        }
      }
    }

    return true;
  }

  loadAll() {
    this.games = [];
    this.gameMetadata = [];

    const config = this.loadConfig();

    if (!fs.existsSync(this.gameModulesDir)) {
      console.warn(`[GAME-LOADER] Directory ${this.gameModulesDir} does not exist`);
      return { games: [], metadata: [] };
    }

    const entries = fs.readdirSync(this.gameModulesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dirName = entry.name;
      const gameDir = path.join(this.gameModulesDir, dirName);
      const manifestPath = path.join(gameDir, 'game.json');

      if (!fs.existsSync(manifestPath)) {
        console.warn(`[GAME-LOADER] Skipping ${dirName}: No game.json found`);
        continue;
      }

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        if (manifest.status === 'inactive') {
          console.log(`[GAME-LOADER] Skipping ${manifest.name || dirName}: marked inactive`);
          continue;
        }

        if (!this.isGameEnabled(config, dirName, manifest.id)) {
          console.log(`[GAME-LOADER] Skipping ${manifest.name || dirName}: disabled in games.config.json`);
          continue;
        }

        let gameDef = null;
        const gameJsPath = path.join(gameDir, 'game.js');
        const indexJsPath = path.join(gameDir, 'index.js');

        if (fs.existsSync(gameJsPath)) {
          gameDef = require(gameJsPath);
        } else if (fs.existsSync(indexJsPath)) {
          gameDef = require(indexJsPath);
        }

        if (!gameDef) {
          console.warn(`[GAME-LOADER] Skipping ${manifest.name || dirName}: No game.js or index.js found`);
          continue;
        }

        const game = gameDef.default || gameDef;
        
        if (!game.name && manifest.id) {
          game.name = manifest.id;
        }

        this.games.push(game);
        this.gameMetadata.push({
          id: manifest.id || game.name || dirName,
          name: manifest.name || dirName,
          description: manifest.description || '',
          playerCounts: manifest.playerCounts || (manifest.minPlayers ? [manifest.minPlayers] : [2]),
          minPlayers: manifest.minPlayers || (manifest.playerCounts ? manifest.playerCounts[0] : 2),
          maxPlayers: manifest.maxPlayers || (manifest.playerCounts ? manifest.playerCounts[manifest.playerCounts.length - 1] : 2),
          icon: manifest.icon || 'bi-dice-5',
          tags: manifest.tags || [],
          version: manifest.version || '1.0.0',
          modes: manifest.modes || []
        });

        console.log(`[GAME-LOADER] Successfully loaded game: ${manifest.name} (${manifest.id || game.name})`);
      } catch (err) {
        console.error(`[GAME-LOADER] Error loading game module ${dirName}:`, err.message);
      }
    }

    return {
      games: this.games,
      metadata: this.gameMetadata
    };
  }

  getGames() {
    return this.games;
  }

  getMetadata() {
    return this.gameMetadata;
  }
}

module.exports = GameLoader;
