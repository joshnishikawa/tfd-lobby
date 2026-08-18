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

  createGroup({ hostName, hostUserId = null, hostAvatar = null, selectedGameId = 'tic-tac-toe', setupData = {} }) {
    const code = this.generateCode();
    const hostMember = {
      id: crypto.randomBytes(8).toString('hex'),
      name: hostName || 'Captain',
      userId: hostUserId,
      avatar: hostAvatar,
      isHost: true,
      isReady: true,
      playAgain: false,
      joinedAt: Date.now()
    };

    const group = {
      code,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      selectedGameId,
      setupData,
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

  getOrCreateMatchGroup(matchId, { memberName, userId = null, avatar = null, gameId = 'tic-tac-toe', setupData = {}, playerSeat = null }) {
    if (!matchId) throw new Error('Match ID required');
    const code = 'M-' + matchId.trim().toUpperCase();
    let group = this.groups.get(code);

    if (!group) {
      const hostMember = {
        id: crypto.randomBytes(8).toString('hex'),
        name: memberName || 'Player 1',
        userId,
        avatar,
        playerSeat: playerSeat !== null ? String(playerSeat) : '0',
        isHost: true,
        isReady: true,
        playAgain: false,
        joinedAt: Date.now()
      };

      group = {
        code,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        selectedGameId: gameId,
        setupData,
        status: 'IN_GAME',
        matchId,
        members: [hostMember]
      };
      this.groups.set(code, group);
      return { group, member: hostMember };
    }

    // Existing group: find member by playerSeat first, then userId, then name
    let member = null;
    if (playerSeat !== null && playerSeat !== undefined) {
      member = group.members.find(m => m.playerSeat === String(playerSeat));
    }
    if (!member && userId) {
      member = group.members.find(m => m.userId === userId);
    }
    if (!member && memberName) {
      member = group.members.find(m => m.name === memberName);
    }

    if (!member) {
      const isHost = group.members.length === 0;
      member = {
        id: crypto.randomBytes(8).toString('hex'),
        name: memberName || `Player ${group.members.length + 1}`,
        userId,
        avatar,
        playerSeat: playerSeat !== null ? String(playerSeat) : String(group.members.length),
        isHost,
        isReady: true,
        playAgain: false,
        joinedAt: Date.now()
      };
      group.members.push(member);
    } else {
      if (memberName) member.name = memberName;
      if (userId) member.userId = userId;
      if (avatar) member.avatar = avatar;
      if (playerSeat !== null) member.playerSeat = String(playerSeat);
    }

    group.selectedGameId = gameId || group.selectedGameId;
    if (setupData && Object.keys(setupData).length > 0) {
      group.setupData = setupData;
    }
    group.updatedAt = Date.now();
    return { group, member };
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
      playAgain: false,
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

  votePlayAgain(code, memberId, isPlayAgain = true) {
    const group = this.getGroup(code);
    if (!group) throw new Error('Group room not found');
    const member = group.members.find(m => m.id === memberId);
    if (!member) throw new Error('Member not found in group');

    member.playAgain = typeof isPlayAgain === 'boolean' ? isPlayAgain : !member.playAgain;
    group.updatedAt = Date.now();

    const allPlayAgain = group.members.length > 0 && group.members.every(m => m.playAgain);
    return { group, allPlayAgain };
  }

  launchGame(code, memberId, matchId, resetPlayAgain = true) {
    const group = this.getGroup(code);
    if (!group) throw new Error('Group room not found');
    const member = group.members.find(m => m.id === memberId);
    if (!member) {
      throw new Error('Member not found in group');
    }
    if (!resetPlayAgain && !member.isHost) {
      throw new Error('Only the group host can launch the game');
    }
    group.status = 'IN_GAME';
    group.matchId = matchId;
    if (resetPlayAgain) {
      group.members.forEach(m => {
        m.playAgain = false;
        m.isReady = true;
      });
    }
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
