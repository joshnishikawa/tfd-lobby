const crypto = require('crypto');

class GroupManager {
  constructor() {
    this.groups = new Map();
    this.cleanInterval = setInterval(() => this.cleanup(), 10 * 60 * 1000);
  }

  generateCode() {
    let code;
    do {
      code = 'FD-' + Math.floor(1000 + Math.random() * 9000);
    } while (this.groups.has(code));
    return code;
  }

  createGroup({ hostName, hostUserId = null, hostAvatar = null }) {
    const code = this.generateCode();
    const hostMember = {
      id: crypto.randomBytes(8).toString('hex'),
      name: hostName || 'Captain',
      userId: hostUserId,
      avatar: hostAvatar,
      isHost: true,
      isReady: true,
      joinedAt: Date.now()
    };

    const group = {
      code,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      selectedGameId: 'tic-tac-toe',
      status: 'LOBBY',
      matchId: null,
      members: [hostMember]
    };

    this.groups.set(code, group);
    return { group, hostMember };
  }

  getGroup(code) {
    if (!code) return null;
    const formatted = code.trim().toUpperCase();
    return this.groups.get(formatted) || null;
  }

  joinGroup(code, { memberName, userId = null, avatar = null }) {
    const group = this.getGroup(code);
    if (!group) {
      throw new Error('Group room not found');
    }

    if (group.status === 'IN_GAME') {
      throw new Error('Game is already in progress in this group');
    }

    const member = {
      id: crypto.randomBytes(8).toString('hex'),
      name: memberName || `Player ${group.members.length + 1}`,
      userId,
      avatar,
      isHost: false,
      isReady: false,
      joinedAt: Date.now()
    };

    group.members.push(member);
    group.updatedAt = Date.now();
    return { group, member };
  }

  leaveGroup(code, memberId) {
    const group = this.getGroup(code);
    if (!group) return null;

    group.members = group.members.filter(m => m.id !== memberId);
    group.updatedAt = Date.now();

    if (group.members.length === 0) {
      this.groups.delete(group.code);
      return null;
    }

    if (!group.members.some(m => m.isHost)) {
      group.members[0].isHost = true;
      group.members[0].isReady = true;
    }

    return group;
  }

  selectGame(code, memberId, gameId) {
    const group = this.getGroup(code);
    if (!group) throw new Error('Group room not found');
    const member = group.members.find(m => m.id === memberId);
    if (!member || !member.isHost) {
      throw new Error('Only the group host can change the selected game');
    }
    group.selectedGameId = gameId;
    group.updatedAt = Date.now();
    return group;
  }

  toggleReady(code, memberId, isReady) {
    const group = this.getGroup(code);
    if (!group) throw new Error('Group room not found');
    const member = group.members.find(m => m.id === memberId);
    if (!member) throw new Error('Member not found in group');
    member.isReady = typeof isReady === 'boolean' ? isReady : !member.isReady;
    group.updatedAt = Date.now();
    return group;
  }

  launchGame(code, memberId, matchId) {
    const group = this.getGroup(code);
    if (!group) throw new Error('Group room not found');
    const member = group.members.find(m => m.id === memberId);
    if (!member || !member.isHost) {
      throw new Error('Only the group host can launch the game');
    }
    group.status = 'IN_GAME';
    group.matchId = matchId;
    group.updatedAt = Date.now();
    return group;
  }

  cleanup() {
    const maxAge = 4 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [code, group] of this.groups.entries()) {
      if (now - group.updatedAt > maxAge) {
        this.groups.delete(code);
      }
    }
  }
}

module.exports = GroupManager;
