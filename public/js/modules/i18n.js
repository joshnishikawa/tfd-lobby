/**
 * The Flying Dutchmen - Lobby i18n Localization Engine
 * Provides multi-language support (English, Spanish, Japanese)
 * with reactivity, parameter interpolation, and DOM auto-translation.
 */

const LOCALES = {
  en: {
    hero: {
      quickMatch: 'Quick Match',
      partyLounge: 'Party Lounge'
    },
    catalog: {
      quickMatch: 'Quick Match',
      createTable: 'Create Table',
      openTables: 'Open Tables',
      noOpenTables: 'No open tables right now. Click Quick Match or Create Table to start one!',
      playersCount: '{{count}} Players',
      playersCountOption: '{{count}} Players',
      mode: 'Mode',
      variant: 'Variant',
      modes: {
        normal: 'Normal',
        ultimate: 'Ultimate'
      },
      descriptions: {
        'tic-tac-toe': 'Classic 3x3 grid game and Ultimate 9-grid variant.'
      }
    },
    tables: {
      seatOpen: 'Seat {{seat}} (Open)',
      seatTaken: 'Seat {{seat}} ({{name}})',
      playersRatio: '{{current}}/{{total}} Players',
      joinBtn: 'Join',
      fullBtn: 'Full',
      inProgress: 'In Progress',
      waiting: 'Waiting',
      createTitle: 'Create Game Table',
      joinTitle: 'Join Game Table',
      gameLabel: 'Game:',
      playerCountLabel: 'Player Count:',
      yourNameLabel: 'Your Name:',
      seatSelectLabel: 'Select Seat / Player Slot:',
      cancel: 'Cancel',
      createAndJoin: 'Create & Join',
      joinTable: 'Join Table',
      joiningTableInfo: 'Joining table #{{id}} ({{current}}/{{total}} players)'
    },
    party: {
      joinTitle: 'Join Existing Party',
      joinDesc: 'Have a party code from a friend? Enter it below to step right into their lounge room.',
      createTitle: 'Host a New Party',
      createDesc: 'Create a private room with a shareable code. Gather your friends first, pick any game, and launch together.',
      yourName: 'Your Name:',
      namePlaceholder: 'Enter your display name',
      partyCode: 'Party Code:',
      codePlaceholder: 'e.g. FD-1234',
      joinBtn: 'Join',
      createBtn: 'Create Party',
      partyBadge: 'PARTY',
      readyUp: 'Ready Up',
      ready: 'Ready',
      notReady: 'Not Ready',
      leaveParty: 'Leave Party',
      partyMembers: 'Party Members ({{count}})',
      waitingReady: 'Waiting for all players to be ready...',
      allReadyHost: 'All players ready! Host can launch.',
      launchGame: 'Launch Game',
      selectGameLabel: 'Select Game:',
      codeCopied: 'Party code copied to clipboard!',
      copyCodeTitle: 'Copy Code',
      hostTag: 'HOST',
      youTag: 'YOU',
      playerJoined: '{{name}} joined the party',
      playerLeft: '{{name}} left the party',
      launchHintWaiting: 'Waiting for all players to be ready ({{ready}}/{{total}} ready)...'
    },
    match: {
      toLobby: 'To Lobby',
      playAgain: 'Play Again',
      rematchRequested: 'Rematch Requested ({{current}}/{{total}})',
      gameBoard: 'Game Board',
      activeMatchBanner: 'You have an active match in progress! ({{game}} - Match #{{matchId}})',
      resumeMatch: 'Resume Match',
      abandonMatch: 'Abandon'
    },
    game: {
      connecting: 'Connecting to match...',
      waitingOpponent: 'Waiting for opponent to join match... (1/2 Players)',
      yourTurn: 'Your Turn! (You are {{symbol}})',
      opponentsTurn: "Opponent's Turn (You are {{symbol}})",
      victory: 'Victory! You Won!',
      gameOverWinner: 'Game Over. Player {{winner}} won.',
      draw: 'Draw Game!',
      notYourTurn: "It's not your turn!",
      freeMoveAnyGrid: ' (Free Move in ANY Grid)',
      playInGrid: ' (Play in Grid #{{grid}})',
      mustPlayInGrid: 'Must play in Grid #{{grid}}!'
    },
    common: {
      loading: 'Loading...',
      error: 'Error',
      success: 'Success'
    }
  },
  es: {
    hero: {
      quickMatch: 'Partida Rápida',
      partyLounge: 'Sala de Grupo'
    },
    catalog: {
      quickMatch: 'Partida Rápida',
      createTable: 'Crear Mesa',
      openTables: 'Mesas Abiertas',
      noOpenTables: '¡No hay mesas abiertas ahora! ¡Haz clic en Partida Rápida o Crear Mesa para empezar una!',
      playersCount: '{{count}} Jugadores',
      playersCountOption: '{{count}} Jugadores',
      mode: 'Modo',
      variant: 'Variante',
      modes: {
        normal: 'Normal',
        ultimate: 'Ultimate'
      },
      descriptions: {
        'tic-tac-toe': 'Juego clásico de cuadrícula 3x3 y variante Ultimate de 9 cuadrículas.'
      }
    },
    tables: {
      seatOpen: 'Asiento {{seat}} (Libre)',
      seatTaken: 'Asiento {{seat}} ({{name}})',
      playersRatio: '{{current}}/{{total}} Jugadores',
      joinBtn: 'Unirse',
      fullBtn: 'Llena',
      inProgress: 'En Progreso',
      waiting: 'Esperando',
      createTitle: 'Crear Mesa de Juego',
      joinTitle: 'Unirse a Mesa de Juego',
      gameLabel: 'Juego:',
      playerCountLabel: 'Cantidad de Jugadores:',
      yourNameLabel: 'Tu Nombre:',
      seatSelectLabel: 'Seleccionar Asiento / Posición:',
      cancel: 'Cancelar',
      createAndJoin: 'Crear y Unirse',
      joinTable: 'Unirse a la Mesa',
      joiningTableInfo: 'Uniéndose a la mesa #{{id}} ({{current}}/{{total}} jugadores)'
    },
    party: {
      joinTitle: 'Unirse a Sala Existente',
      joinDesc: '¿Tienes un código de sala de un amigo? Ingrésalo abajo para entrar directamente a su sala.',
      createTitle: 'Crear Nueva Sala',
      createDesc: 'Crea una sala privada con un código para compartir. Reúne a tus amigos, elige cualquier juego y comiencen juntos.',
      yourName: 'Tu Nombre:',
      namePlaceholder: 'Ingresa tu nombre para mostrar',
      partyCode: 'Código de Sala:',
      codePlaceholder: 'ej. FD-1234',
      joinBtn: 'Unirse',
      createBtn: 'Crear Sala',
      partyBadge: 'GRUPO',
      readyUp: 'Listo',
      ready: 'Listo',
      notReady: 'No Listo',
      leaveParty: 'Salir de la Sala',
      partyMembers: 'Miembros de la Sala ({{count}})',
      waitingReady: 'Esperando que todos los jugadores estén listos...',
      allReadyHost: '¡Todos los jugadores listos! El anfitrión puede iniciar.',
      launchGame: 'Iniciar Juego',
      selectGameLabel: 'Seleccionar Juego:',
      codeCopied: '¡Código de sala copiado al portapapeles!',
      copyCodeTitle: 'Copiar Código',
      hostTag: 'ANFITRIÓN',
      youTag: 'TÚ',
      playerJoined: '{{name}} se unió a la sala',
      playerLeft: '{{name}} salió de la sala',
      launchHintWaiting: 'Esperando a que todos los jugadores estén listos ({{ready}}/{{total}} listos)...'
    },
    match: {
      toLobby: 'Al Lobby',
      playAgain: 'Jugar de Nuevo',
      rematchRequested: 'Revancha Solicitada ({{current}}/{{total}})',
      gameBoard: 'Tablero de Juego',
      activeMatchBanner: '¡Tienes una partida activa en curso! ({{game}} - Partida #{{matchId}})',
      resumeMatch: 'Reanudar Partida',
      abandonMatch: 'Abandonar'
    },
    game: {
      connecting: 'Conectando a la partida...',
      waitingOpponent: 'Esperando que el oponente se una a la partida... (1/2 Jugadores)',
      yourTurn: '¡Tu Turno! (Eres {{symbol}})',
      opponentsTurn: 'Turno del Oponente (Eres {{symbol}})',
      victory: '¡Victoria! ¡Has ganado!',
      gameOverWinner: 'Fin del juego. Ganó el jugador {{winner}}.',
      draw: '¡Empate!',
      notYourTurn: '¡No es tu turno!',
      freeMoveAnyGrid: ' (Movimiento libre en CUALQUIER cuadrícula)',
      playInGrid: ' (Juega en la cuadrícula #{{grid}})',
      mustPlayInGrid: '¡Debes jugar en la cuadrícula #{{grid}}!'
    },
    common: {
      loading: 'Cargando...',
      error: 'Error',
      success: 'Éxito'
    }
  },
  ja: {
    hero: {
      quickMatch: 'クイックマッチ',
      partyLounge: 'パーティラウンジ'
    },
    catalog: {
      quickMatch: 'クイックマッチ',
      createTable: 'テーブル作成',
      openTables: '公開テーブル',
      noOpenTables: '現在公開テーブルはありません。「クイックマッチ」または「テーブル作成」で開始しましょう！',
      playersCount: '{{count}}人プレイ',
      playersCountOption: '{{count}}人プレイ',
      mode: 'モード',
      variant: 'バリアント',
      modes: {
        normal: '通常',
        ultimate: 'アルティメット'
      },
      descriptions: {
        'tic-tac-toe': 'クラシックな3x3グリッドゲームと9マスのアルティメットバリアント。'
      }
    },
    tables: {
      seatOpen: '座席 {{seat}} (空き)',
      seatTaken: '座席 {{seat}} ({{name}})',
      playersRatio: '{{current}}/{{total}}人',
      joinBtn: '参加',
      fullBtn: '満員',
      inProgress: '対戦中',
      waiting: '待機中',
      createTitle: 'ゲームテーブルを作成',
      joinTitle: 'ゲームテーブルに参加',
      gameLabel: 'ゲーム:',
      playerCountLabel: 'プレイヤー数:',
      yourNameLabel: 'あなたの名前:',
      seatSelectLabel: '座席 / スロットを選択:',
      cancel: 'キャンセル',
      createAndJoin: '作成して参加',
      joinTable: 'テーブルに参加',
      joiningTableInfo: 'テーブル #{{id}} に参加中 ({{current}}/{{total}} プレイヤー)'
    },
    party: {
      joinTitle: '既存のパーティに参加',
      joinDesc: '友達からパーティコードをもらいましたか？以下に入力してラウンジルームに入室しましょう。',
      createTitle: '新しいパーティを主催',
      createDesc: '共有可能なコードでプライベートルームを作成します。友達を集めてゲームを選び、一緒に開始しましょう。',
      yourName: 'あなたの名前:',
      namePlaceholder: '表示名を入力してください',
      partyCode: 'パーティコード:',
      codePlaceholder: '例: FD-1234',
      joinBtn: '参加',
      createBtn: 'パーティ作成',
      partyBadge: 'パーティ',
      readyUp: '準備完了',
      ready: '準備OK',
      notReady: '未準備',
      leaveParty: 'パーティ退出',
      partyMembers: 'パーティメンバー ({{count}})',
      waitingReady: '全員の準備完了を待っています...',
      allReadyHost: '全員の準備が完了しました！ホストがゲームを開始できます。',
      launchGame: 'ゲーム開始',
      selectGameLabel: 'ゲームを選択:',
      codeCopied: 'パーティコードをクリップボードにコピーしました！',
      copyCodeTitle: 'コードをコピー',
      hostTag: 'ホスト',
      youTag: 'あなた',
      playerJoined: '{{name}}がパーティに参加しました',
      playerLeft: '{{name}}がパーティを退出しました',
      launchHintWaiting: '全員の準備完了を待機中 ({{ready}}/{{total}} 準備完了)...'
    },
    match: {
      toLobby: 'ロビーへ戻る',
      playAgain: 'もう一度プレイ',
      rematchRequested: '再戦リクエスト ({{current}}/{{total}})',
      gameBoard: 'ゲーム盤',
      activeMatchBanner: '進行中のマッチがあります！ ({{game}} - マッチ #{{matchId}})',
      resumeMatch: 'マッチに戻る',
      abandonMatch: '放棄する'
    },
    game: {
      connecting: 'マッチに接続中...',
      waitingOpponent: '対戦相手の参加を待っています... (1/2 プレイヤー)',
      yourTurn: 'あなたの番です！ (あなたは {{symbol}})',
      opponentsTurn: '相手の番です (あなたは {{symbol}})',
      victory: '勝利！あなたの勝ちです！',
      gameOverWinner: 'ゲーム終了。プレイヤー{{winner}}の勝利です。',
      draw: '引き分け！',
      notYourTurn: 'あなたの番ではありません！',
      freeMoveAnyGrid: ' (任意のグリッドで自由に配置可能)',
      playInGrid: ' (グリッド #{{grid}} でプレイ)',
      mustPlayInGrid: 'グリッド #{{grid}} でプレイしてください！'
    },
    common: {
      loading: '読み込み中...',
      error: 'エラー',
      success: '成功'
    }
  }
};

let currentLang = 'en';

export function getLanguage() {
  const stored = localStorage.getItem('site-language') || localStorage.getItem('fly-on-language');
  if (stored && LOCALES[stored]) return stored;
  return currentLang;
}

export function setLanguage(lang) {
  if (LOCALES[lang]) {
    currentLang = lang;
    localStorage.setItem('site-language', lang);
    localStorage.setItem('fly-on-language', lang);
    document.documentElement.lang = lang;
  }
}

export function t(key, params = {}) {
  const lang = getLanguage();
  const keys = key.split('.');
  let val = LOCALES[lang];

  for (const k of keys) {
    if (val && typeof val === 'object' && k in val) {
      val = val[k];
    } else {
      // Fallback to English
      val = null;
      break;
    }
  }

  if (val === null || val === undefined) {
    val = LOCALES['en'];
    for (const k of keys) {
      if (val && typeof val === 'object' && k in val) {
        val = val[k];
      } else {
        return params.defaultValue || key;
      }
    }
  }

  if (typeof val === 'string') {
    return val.replace(/\{\{(\w+)\}\}/g, (match, pName) => {
      return params[pName] !== undefined ? params[pName] : match;
    });
  }

  return val || key;
}

/**
 * Automatically translates all DOM nodes containing data-i18n or data-i18n-placeholder
 */
export function translateDOM(container = document) {
  const elements = container.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
    }
  });

  const inputs = container.querySelectorAll('[data-i18n-placeholder]');
  inputs.forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.setAttribute('placeholder', t(key));
    }
  });

  const titles = container.querySelectorAll('[data-i18n-title]');
  titles.forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.setAttribute('title', t(key));
    }
  });
}

// Initial setup on module load
currentLang = getLanguage();
document.documentElement.lang = currentLang;

// Expose globally for vanilla scripts
window.lobbyI18n = {
  getLanguage,
  setLanguage,
  t,
  translateDOM
};
