// ---------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------
const SP_ROUNDS = 5;   // Singleplayer
const MP_ROUNDS = 10;  // Multiplayer
const MAX_POINTS = 5000;
const SCORE_DECAY_KM = 2000;        // Länder-Runden: grosszügiger Massstab
const SCORE_DECAY_KM_SWISS = 40;    // Schweiz-Runden: kleines Land, engerer Massstab

// ---------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------
let mapsReady = false;
let locations = [];
let centroids = {};
let swissPlaceCoords = {};   // { Ortsname: {lat, lng} }, aus locations mit place-Feld gebaut
let countryOptionsHtml = '';
let swissOptionsHtml = '';
let currentRoundIsSwiss = false;
let panorama = null;
let streetViewService = null;

let playerName = localStorage.getItem('weltraten_name') || '';
let roundsTotal = SP_ROUNDS;
let roundPool = [];
let currentRoundIndex = 0;
let totalScore = 0;
let roundResults = [];
let currentRequestToken = 0; // erkennt/verwirft veraltete Panorama-Antworten aus früheren Runden

let isMultiplayer = false;
let currentGameCode = null;      // Code des gerade laufenden/zuletzt gespielten MP-Spiels
let currentLeaderboardCode = null; // Code, dessen Rangliste gerade angezeigt wird (kann ein anderes Spiel sein)
let pendingLoginContext = { type: 'sp' }; // steuert, was der Namen-Screen nach "weiter" tut

// ---------------------------------------------------------------
// DOM-Referenzen
// ---------------------------------------------------------------
const landingScreen = document.getElementById('landing-screen');
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');
const finalScreen = document.getElementById('final-screen');
const inviteScreen = document.getElementById('invite-screen');
const mpLockedScreen = document.getElementById('mp-locked-screen');
const leaderboardScreen = document.getElementById('leaderboard-screen');
const adminScreen = document.getElementById('admin-screen');
const profileScreen = document.getElementById('profile-screen');

const allScreens = [
  landingScreen, loginScreen, gameScreen, resultScreen, finalScreen,
  inviteScreen, mpLockedScreen, leaderboardScreen, adminScreen, profileScreen,
];

function showScreen(screen) {
  allScreens.forEach((s) => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

const landingSingleplayerButton = document.getElementById('landing-singleplayer-button');
const landingMultiplayerButton = document.getElementById('landing-multiplayer-button');
const landingMpList = document.getElementById('landing-mp-list');
const landingUser = document.getElementById('landing-user');

const loginSubtitle = document.getElementById('login-subtitle');
const usernameInput = document.getElementById('username-input');
const startButton = document.getElementById('start-button');
const loginNameNote = document.getElementById('login-name-note');

const profileName = document.getElementById('profile-name');
const profileStats = document.getElementById('profile-stats');
const profileGames = document.getElementById('profile-games');
const profileBackButton = document.getElementById('profile-back-button');
const profileRenameButton = document.getElementById('profile-rename-button');

const inviteCodeLabel = document.getElementById('invite-code');
const inviteLinkInput = document.getElementById('invite-link-input');
const inviteShareButton = document.getElementById('invite-share-button');
const invitePlayButton = document.getElementById('invite-play-button');
const inviteBackButton = document.getElementById('invite-back-button');

const mpLockedDetail = document.getElementById('mp-locked-detail');
const mpLockedLeaderboardButton = document.getElementById('mp-locked-leaderboard-button');
const mpLockedBackButton = document.getElementById('mp-locked-back-button');

const leaderboardCodeLabel = document.getElementById('leaderboard-code');
const leaderboardList = document.getElementById('leaderboard-list');
const leaderboardShareButton = document.getElementById('leaderboard-share-button');
const leaderboardBackButton = document.getElementById('leaderboard-back-button');

const adminList = document.getElementById('admin-list');
const adminOutput = document.getElementById('admin-output');
const adminCopyButton = document.getElementById('admin-copy-button');
const adminBackButton = document.getElementById('admin-back-button');

const guessForm = document.getElementById('guess-form');
const guessSelect = document.getElementById('guess-select');
const guessSubmit = document.getElementById('guess-submit');
const panoLoading = document.getElementById('pano-loading');

const reportButton = document.getElementById('report-button');
const reportModal = document.getElementById('report-modal');
const reportTooEasyButton = document.getElementById('report-too-easy');
const reportImpossibleButton = document.getElementById('report-impossible');
const reportCancelButton = document.getElementById('report-cancel');

const hudPlayer = document.getElementById('hud-player');
const hudRound = document.getElementById('hud-round');
const hudScore = document.getElementById('hud-score');

const resultHeadline = document.getElementById('result-headline');
const resultDetail = document.getElementById('result-detail');
const resultPoints = document.getElementById('result-points');
const nextRoundButton = document.getElementById('next-round-button');

const finalSummary = document.getElementById('final-summary');
const playAgainButton = document.getElementById('play-again-button');
const finalShareButton = document.getElementById('final-share-button');
const finalLeaderboardButton = document.getElementById('final-leaderboard-button');
const finalLandingButton = document.getElementById('final-landing-button');

// ---------------------------------------------------------------
// Google Maps Callback (wird per ?callback=initApp aus index.html aufgerufen)
// ---------------------------------------------------------------
function initApp() {
  mapsReady = true;
}
window.initApp = initApp;

// ---------------------------------------------------------------
// Setup
// ---------------------------------------------------------------
async function loadData() {
  const [locRes, centRes] = await Promise.all([
    fetch('locations.json?v=8'),
    fetch('country-centroids.json?v=8'),
  ]);
  locations = await locRes.json();
  centroids = await centRes.json();

  locations.forEach((l) => {
    if (l.place) swissPlaceCoords[l.place] = { lat: l.lat, lng: l.lng };
  });

  const countryNames = Object.keys(centroids).sort((a, b) => a.localeCompare(b, 'de'));
  countryOptionsHtml =
    '<option value="" disabled selected>Land wählen …</option>' +
    countryNames.map((n) => `<option value="${n}">${n}</option>`).join('');

  const swissNames = Object.keys(swissPlaceCoords).sort((a, b) => a.localeCompare(b, 'de'));
  swissOptionsHtml =
    '<option value="" disabled selected>Ort wählen …</option>' +
    swissNames.map((n) => `<option value="${n}">${n}</option>`).join('');

  guessSelect.innerHTML = countryOptionsHtml;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalize(name) {
  return name.trim().toLowerCase();
}

// Escaped auch Anfuehrungszeichen - noetig, weil escapeHtml() teils in
// HTML-Attributen verwendet wird (data-id, data-code). Ein reines
// textContent/innerHTML-Escaping laesst " und ' stehen und erlaubt damit
// Attribut-Injection wie: x" onmouseover="...
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------
// Deterministisches Mischen: gleicher Code -> exakt dieselbe
// Reihenfolge/Auswahl auf jedem Gerät. Basis fuer den Multiplayer-
// Modus, der ohne gemeinsame Datenbank auskommt.
// ---------------------------------------------------------------
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicShuffle(array, seedStr) {
  const rnd = seededRandom(hashString(seedStr));
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function deterministicLocations(code, count) {
  return deterministicShuffle(locations, code).slice(0, count);
}

function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O und 1/I
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Codes aus der URL kommen von aussen (manipulierbarer Link) und werden an
// mehreren Stellen als Text angezeigt bzw. als localStorage-Key verwendet.
// Nur unser eigenes, bekanntes Format zulassen, statt beliebigen Text.
function isValidGameCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{4,12}$/i.test(code);
}

// ---------------------------------------------------------------
// Firebase/Firestore: gemeinsame Rangliste. games/{code}/players/{autoId}
// mit {name, score, ts}. Regeln in der Firebase-Konsole erlauben nur
// lesen + einmal anlegen (kein Ueberschreiben) - siehe README.
// ---------------------------------------------------------------
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Wird beim Erstellen eines MP-Spiels geschrieben, damit die Startseite
// spaeter ALLE existierenden Spiele auflisten kann - nicht nur die, deren
// Link man selbst zugeschickt bekommen hat.
// ---------------------------------------------------------------
// Spielerprofile: players/{nameKey} mit dem angezeigten Namen.
// Bewusst ohne Passwort - der Eintrag dient der Wiedererkennung und
// der Statistik, nicht als Zugriffsschutz. Wer denselben Namen
// eingibt, landet im selben Profil.
// ---------------------------------------------------------------
function playerKey(name) {
  return normalize(name).replace(/[^a-z0-9._-]/g, '_').slice(0, 40);
}

// Legt das Profil an, falls es noch nicht existiert.
// Rueckgabe: true = Name war neu, false = Profil bestand bereits.
async function registerPlayer(name) {
  const ref = db.collection('players').doc(playerKey(name));
  const doc = await ref.get();
  if (doc.exists) return false;
  await ref.set({
    displayName: name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return true;
}

async function playerExists(name) {
  const doc = await db.collection('players').doc(playerKey(name)).get();
  return doc.exists;
}

async function createGameRecord(code, hostName) {
  // Kompletten Orts-Datensatz (inkl. Koordinaten) JETZT einfrieren und
  // speichern - nicht nur die ID. Sonst wuerden spaetere Koordinaten-
  // Korrekturen an locations.json (z.B. Ersatz eines gemeldeten Bilds) dazu
  // fuehren, dass Spieler A und Spieler B im selben, noch offenen Spiel
  // unterschiedliche Panoramen fuer dieselbe Runde sehen.
  const rounds = deterministicLocations(code, MP_ROUNDS).map((l) => ({
    id: l.id,
    lat: l.lat,
    lng: l.lng,
    country: l.country,
    place: l.place || null,
  }));
  await db.collection('games').doc(code).set({
    createdBy: hostName,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    rounds,
  });
}

// Liest die beim Erstellen eingefrorenen Orte eines Spiels - unabhaengig
// davon, was seither an locations.json geaendert wurde. Faellt fuer sehr
// alte Spiele (vor diesem Update erstellt, nur locationIds statt rounds
// gespeichert) auf die ID-basierte bzw. Live-Berechnung zurueck.
// Prueft einen einzelnen Runden-Eintrag aus Firestore. Das Dokument
// games/{code} kann von jedem angelegt werden und die Firestore-Regeln
// koennen den Inhalt einer Liste nicht pruefen - die Validierung MUSS
// also hier passieren. Land/Ort werden gegen unsere eigenen Datensaetze
// abgeglichen (Allowlist), Koordinaten auf gueltige Bereiche geprueft.
function sanitizeRound(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const lat = Number(entry.lat);
  const lng = Number(entry.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;

  // Nur Laender, die wir selbst kennen - verhindert eingeschleuste Strings.
  if (typeof entry.country !== 'string' || !(entry.country in centroids)) return null;

  let place = null;
  if (entry.place != null) {
    if (typeof entry.place !== 'string' || !(entry.place in swissPlaceCoords)) return null;
    place = entry.place;
  }

  return {
    id: typeof entry.id === 'string' ? entry.id : '',
    lat,
    lng,
    country: entry.country,
    place,
  };
}

async function resolveRoundLocations(code) {
  try {
    const doc = await db.collection('games').doc(code).get();
    const data = doc.data();
    if (data && Array.isArray(data.rounds) && data.rounds.length === MP_ROUNDS) {
      // Ungueltige/manipulierte Eintraege werden deterministisch ersetzt,
      // damit alle Spieler trotzdem dasselbe sehen.
      return data.rounds.map(
        (entry, index) =>
          sanitizeRound(entry) ||
          deterministicShuffle(locations, `${code}-invalid-${index}`)[0]
      );
    }
    if (data && Array.isArray(data.locationIds) && data.locationIds.length === MP_ROUNDS) {
      return data.locationIds.map((id, index) => {
        const found = typeof id === 'string' ? locations.find((l) => l.id === id) : null;
        return found || deterministicShuffle(locations, `${code}-missing-${index}`)[0];
      });
    }
  } catch (e) {
    console.error('Spiel-Orte konnten nicht geladen werden, verwende Fallback:', e);
  }
  return deterministicLocations(code, MP_ROUNDS);
}

async function fetchAllGames() {
  const snap = await db.collection('games').orderBy('createdAt', 'desc').limit(50).get();
  return snap.docs.map((d) => ({ code: d.id, ...d.data() }));
}

async function submitResult(code, name, score) {
  await db.collection('games').doc(code).collection('players').add({
    name,
    score,
    ts: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function fetchLeaderboard(code) {
  const snap = await db
    .collection('games')
    .doc(code)
    .collection('players')
    .orderBy('score', 'desc')
    .limit(50)
    .get();
  return snap.docs.map((d) => d.data());
}

// "Bild melden": Panoramen als zu einfach oder unmoeglich markieren, damit
// sie sich spaeter in der Firestore-Konsole (Sammlung "flags") gezielt
// nachschauen und aus locations.json ersetzen lassen.
async function reportLocation(location, reason) {
  await db.collection('flags').add({
    locationId: location.id,
    country: location.country,
    place: location.place || null,
    reason, // 'too_easy' | 'impossible'
    ts: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// ---------------------------------------------------------------
// Admin-Auswertung der gemeldeten Bilder (nur ueber ?admin=flags
// erreichbar, nicht verlinkt). Fasst alle Meldungen pro Ort
// zusammen und stellt sie als kopierbaren Text dar.
// ---------------------------------------------------------------
async function markResolved(locationId) {
  await db.collection('resolved').doc(locationId).set({
    ts: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function showAdminFlagsScreen() {
  showScreen(adminScreen);
  adminList.innerHTML = 'Lade …';
  adminOutput.value = '';

  try {
    const [flagsSnap, resolvedSnap] = await Promise.all([
      db.collection('flags').get(),
      db.collection('resolved').get(),
    ]);

    const resolvedIds = new Set(resolvedSnap.docs.map((d) => d.id));

    const byLocation = new Map();
    flagsSnap.forEach((doc) => {
      const d = doc.data();
      // locationId wird von den Firestore-Regeln nur als String geprueft,
      // nicht auf Format - hier gegen unser eigenes Schema absichern.
      const raw = typeof d.locationId === 'string' ? d.locationId : '';
      const key = /^[a-z0-9-]{2,40}$/i.test(raw) ? raw : '(ungültig)';
      if (!byLocation.has(key)) {
        byLocation.set(key, {
          locationId: key,
          label: d.place || d.country || key,
          too_easy: 0,
          impossible: 0,
        });
      }
      const entry = byLocation.get(key);
      if (d.reason === 'too_easy') entry.too_easy += 1;
      else if (d.reason === 'impossible') entry.impossible += 1;
    });

    const all = [...byLocation.values()].sort(
      (a, b) => b.too_easy + b.impossible - (a.too_easy + a.impossible)
    );
    const active = all.filter((r) => !resolvedIds.has(r.locationId));
    const done = all.filter((r) => resolvedIds.has(r.locationId));

    const renderRow = (r, withButton) =>
      `<div class="admin-entry${withButton ? '' : ' admin-entry-done'}"><div><strong>${escapeHtml(
        r.locationId
      )}</strong> – ${escapeHtml(r.label)}<br><span class="admin-entry-status">zu einfach: ${
        r.too_easy
      } · unmöglich: ${r.impossible}</span></div>${
        withButton ? `<button data-id="${escapeHtml(r.locationId)}">Erledigt</button>` : '<span class="admin-done-tag">✓</span>'
      }</div>`;

    let html = '<p class="mp-list-heading">Neu / offen</p>';
    html += active.length
      ? active.map((r) => renderRow(r, true)).join('')
      : '<p class="mp-list-empty">Keine offenen Meldungen.</p>';

    if (done.length) {
      html += '<p class="mp-list-heading">Bereits erledigt</p>';
      html += done.map((r) => renderRow(r, false)).join('');
    }

    adminList.innerHTML = html;

    adminOutput.value = active.length
      ? active
          .map(
            (r) =>
              `${r.locationId} | ${r.label} | zu einfach: ${r.too_easy} | unmöglich: ${r.impossible}`
          )
          .join('\n')
      : '';
  } catch (e) {
    console.error('Meldungen konnten nicht geladen werden:', e);
    adminList.innerHTML = '<p class="mp-list-empty">Fehler beim Laden. Firestore-Regeln geprüft?</p>';
  }
}

adminList.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-id]');
  if (!btn) return;
  const locationId = btn.dataset.id;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await markResolved(locationId);
    showAdminFlagsScreen();
  } catch (e) {
    console.error('Konnte nicht als erledigt markiert werden:', e);
    btn.disabled = false;
    btn.textContent = 'Erledigt';
  }
});

adminCopyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(adminOutput.value);
    flashButtonFeedback(adminCopyButton, 'Kopiert!');
  } catch {
    adminOutput.focus();
    adminOutput.select();
  }
});

adminBackButton.addEventListener('click', goToLanding);

// ---------------------------------------------------------------
// Lokaler Zustand: Fortschritt/Sperre pro Spielcode auf diesem
// Geraet, plus Liste bekannter Spiele fuer die Startseite.
// ---------------------------------------------------------------
function mpCompletedKey(code) { return `weltraten_mp_completed:${code}`; }

function getCompletedInfo(code) {
  try {
    const raw = localStorage.getItem(mpCompletedKey(code));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function buildInviteLink(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('game', code);
  return url.toString();
}

function clearUrlParams() {
  window.history.replaceState(null, '', window.location.pathname);
}

async function shareLink(link, title, buttonEl) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url: link });
      return;
    } catch {
      // Abgebrochen/nicht unterstuetzt -> Clipboard-Fallback unten versuchen
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    flashButtonFeedback(buttonEl, 'Link kopiert!');
  } catch {
    window.prompt('Link kopieren:', link);
  }
}

function flashButtonFeedback(buttonEl, message) {
  if (!buttonEl) return;
  const original = buttonEl.textContent;
  buttonEl.textContent = message;
  buttonEl.disabled = true;
  setTimeout(() => {
    buttonEl.textContent = original;
    buttonEl.disabled = false;
  }, 1800);
}

// ---------------------------------------------------------------
// Startseite
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// Profil: Statistik ueber alle Multiplayer-Spiele dieses Namens.
// ---------------------------------------------------------------
async function showProfileScreen() {
  showScreen(profileScreen);
  profileName.textContent = playerName || '–';
  profileStats.innerHTML = '<p class="mp-list-empty">Lade …</p>';
  profileGames.innerHTML = '';

  try {
    const games = await fetchAllGames();
    const allEntries = await Promise.all(
      games.map((g) => fetchLeaderboard(g.code).catch(() => []))
    );

    const mine = [];
    games.forEach((g, i) => {
      const entries = allEntries[i];
      const idx = entries.findIndex(
        (e) => normalize(String(e.name ?? '')) === normalize(playerName)
      );
      if (idx >= 0) {
        mine.push({
          code: g.code,
          score: Number(entries[idx].score) || 0,
          rank: idx + 1,
          of: entries.length,
        });
      }
    });

    const total = mine.reduce((sum, m) => sum + m.score, 0);
    const best = mine.reduce((max, m) => Math.max(max, m.score), 0);
    const avg = mine.length ? Math.round(total / mine.length) : 0;
    const wins = mine.filter((m) => m.rank === 1 && m.of > 1).length;

    const stat = (value, label) =>
      `<div class="profile-stat"><span class="profile-stat-value">${value}</span><span class="profile-stat-label">${label}</span></div>`;

    profileStats.innerHTML =
      '<div class="profile-stats-grid">' +
      stat(mine.length, 'Spiele') +
      stat(total.toLocaleString('de-CH'), 'Punkte total') +
      stat(avg.toLocaleString('de-CH'), 'Schnitt pro Spiel') +
      stat(best.toLocaleString('de-CH'), 'Bestes Spiel') +
      stat(wins, wins === 1 ? 'Sieg' : 'Siege') +
      stat(MP_ROUNDS * MAX_POINTS, 'Maximum möglich') +
      '</div>';

    profileGames.innerHTML = mine.length
      ? mine
          .map(
            (m) =>
              `<div class="profile-game"><div><strong>${escapeHtml(
                m.code
              )}</strong><br><span class="profile-game-rank">Platz ${m.rank} von ${
                m.of
              }</span></div><span class="profile-game-score">${m.score.toLocaleString(
                'de-CH'
              )}</span></div>`
          )
          .join('')
      : '<p class="mp-list-empty">Noch keine Multiplayer-Spiele gespielt.</p>';
  } catch (e) {
    console.error('Profil konnte nicht geladen werden:', e);
    profileStats.innerHTML = '<p class="mp-list-empty">Profil konnte nicht geladen werden.</p>';
  }
}

profileBackButton.addEventListener('click', goToLanding);

profileRenameButton.addEventListener('click', () => {
  pendingLoginContext = { type: 'change' };
  loginSubtitle.textContent = 'Neuer Spielername – bisherige Ergebnisse bleiben beim alten Namen.';
  loginNameNote.classList.add('hidden');
  usernameInput.value = playerName;
  showScreen(loginScreen);
});

landingUser.addEventListener('click', (event) => {
  if (event.target.closest('button')) showProfileScreen();
});

async function showLandingScreen() {
  showScreen(landingScreen);
  landingUser.innerHTML = `<span>Angemeldet als <strong>${escapeHtml(
    playerName
  )}</strong></span><button type="button">Profil</button>`;
  landingMpList.innerHTML = '<p class="mp-list-heading">Lade Spiele …</p>';

  let games = [];
  try {
    games = await fetchAllGames();
  } catch (e) {
    console.error('Spiele-Liste konnte nicht geladen werden:', e);
    landingMpList.innerHTML = '<p class="mp-list-empty">Spiele-Liste konnte nicht geladen werden.</p>';
    return;
  }

  // Wer schon gespielt hat, steht in Firestore - nicht nur im localStorage.
  // Sonst gilt ein Spiel nach dem Leeren der Browserdaten oder auf einem
  // anderen Geraet faelschlich wieder als offen.
  const allEntries = await Promise.all(
    games.map((g) => fetchLeaderboard(g.code).catch(() => []))
  );

  const open = [];
  const completed = [];
  games.forEach((g, i) => {
    const entries = allEntries[i];
    const mine = playerName
      ? entries.find((e) => normalize(String(e.name ?? '')) === normalize(playerName))
      : null;
    const local = getCompletedInfo(g.code);
    const score = mine ? Number(mine.score) || 0 : local ? Number(local.score) || 0 : null;

    if (score !== null) {
      // Firestore ist die Wahrheit -> lokale Sperre wieder herstellen
      if (mine && !local) {
        localStorage.setItem(mpCompletedKey(g.code), JSON.stringify({ score, ts: Date.now() }));
      }
      completed.push({ ...g, score, players: entries.length });
    } else {
      open.push({ ...g, players: entries.length });
    }
  });

  const renderEntry = (g, statusText, action, dataAction) =>
    `<div class="mp-list-entry"><div><strong>${escapeHtml(g.code)}</strong><br><span class="mp-list-status">von ${escapeHtml(
      g.createdBy || '?'
    )} · ${statusText}</span></div><button data-code="${escapeHtml(g.code)}" data-action="${dataAction}">${action}</button></div>`;

  const playersLabel = (n) => (n === 1 ? '1 Ergebnis' : `${n} Ergebnisse`);

  let html = '<p class="mp-list-heading">Offene Spiele</p>';
  html += open.length
    ? open
        .map((g) =>
          renderEntry(
            g,
            g.players ? `noch offen · ${playersLabel(g.players)}` : 'noch offen',
            'Spielen',
            'play'
          )
        )
        .join('')
    : '<p class="mp-list-empty">Keine offenen Spiele.</p>';

  html += '<p class="mp-list-heading">Abgeschlossene Spiele</p>';
  html += completed.length
    ? completed
        .map((g) => renderEntry(g, `${g.score} Punkte · ${playersLabel(g.players)}`, 'Rangliste', 'lb'))
        .join('')
    : '<p class="mp-list-empty">Noch keine abgeschlossenen Spiele.</p>';

  landingMpList.innerHTML = html;
}

landingMpList.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-code]');
  if (!btn) return;
  const code = btn.dataset.code;
  if (btn.dataset.action === 'lb') {
    showLeaderboardScreen(code);
  } else {
    startMultiplayerRounds(code);
  }
});

landingSingleplayerButton.addEventListener('click', () => {
  startGame();
});

landingMultiplayerButton.addEventListener('click', async () => {
  const code = generateGameCode();
  landingMultiplayerButton.disabled = true;
  try {
    await createGameRecord(code, playerName);
    showInviteScreen(code);
  } catch (e) {
    console.error('Spiel-Eintrag konnte nicht angelegt werden:', e);
    alert('Spiel konnte nicht erstellt werden. Bitte nochmal versuchen.');
  }
  landingMultiplayerButton.disabled = false;
});

function goToLanding() {
  clearUrlParams();
  showLandingScreen();
}

// ---------------------------------------------------------------
// Namen-Screen (SP-Start, MP-Erstellung, MP-Beitritt)
// ---------------------------------------------------------------
startButton.addEventListener('click', async () => {
  const name = usernameInput.value.trim();
  if (!name) {
    usernameInput.focus();
    return;
  }

  startButton.disabled = true;
  loginNameNote.classList.add('hidden');

  // Bestehendes Profil? Dann nur Hinweis, kein Blockieren - der Name ist
  // bewusst keine geschuetzte Identitaet.
  let known = false;
  try {
    known = await playerExists(name);
    if (!known) await registerPlayer(name);
  } catch (e) {
    console.error('Profil konnte nicht angelegt/geprueft werden:', e);
  }

  playerName = name;
  localStorage.setItem('weltraten_name', playerName);
  startButton.disabled = false;

  if (known && !pendingLoginContext.acknowledgedExisting) {
    // Einmal darauf hinweisen, dass der Name schon existiert.
    loginNameNote.textContent = `„${name}“ gibt es schon – ihr teilt euch dann dasselbe Profil. Mit vorname.nachname bleibt es eindeutig. Nochmal „Weiter“ tippen, wenn das so gewollt ist.`;
    loginNameNote.classList.remove('hidden');
    pendingLoginContext = { ...pendingLoginContext, acknowledgedExisting: true };
    return;
  }

  const ctx = pendingLoginContext;
  pendingLoginContext = { type: 'sp' };

  if (ctx.type === 'mp-join' && ctx.code) {
    startMultiplayerRounds(ctx.code);
  } else {
    goToLanding();
  }
});

// ---------------------------------------------------------------
// Einladungs-Screen
// ---------------------------------------------------------------
function showInviteScreen(code) {
  currentGameCode = code;
  const link = buildInviteLink(code);
  inviteCodeLabel.textContent = code;
  inviteLinkInput.value = link;
  showScreen(inviteScreen);
}

inviteShareButton.addEventListener('click', () => {
  shareLink(inviteLinkInput.value, `Weltraten – Multiplayer-Spiel ${currentGameCode}`, inviteShareButton);
});

invitePlayButton.addEventListener('click', () => {
  startMultiplayerRounds(currentGameCode);
});

inviteBackButton.addEventListener('click', goToLanding);

// ---------------------------------------------------------------
// Spielablauf: Singleplayer
// ---------------------------------------------------------------
function startGame() {
  isMultiplayer = false;
  currentGameCode = null;
  roundsTotal = SP_ROUNDS;
  totalScore = 0;
  currentRoundIndex = 0;
  roundResults = [];
  roundPool = drawLocations(roundsTotal);

  hudPlayer.textContent = playerName;
  showScreen(gameScreen);
  startRound();
}

// ---------------------------------------------------------------
// Spielablauf: Multiplayer
// ---------------------------------------------------------------
async function startMultiplayerRounds(code) {
  // Auch gegen Firestore pruefen, nicht nur gegen den localStorage: sonst
  // koennte man nach dem Leeren der Browserdaten (oder auf einem zweiten
  // Geraet) dasselbe Spiel ein zweites Mal spielen.
  try {
    const entries = await fetchLeaderboard(code);
    const mine = entries.find((e) => normalize(String(e.name ?? '')) === normalize(playerName));
    if (mine) {
      const score = Number(mine.score) || 0;
      localStorage.setItem(mpCompletedKey(code), JSON.stringify({ score, ts: Date.now() }));
      showMpLockedScreen(code, { score });
      return;
    }
  } catch (e) {
    console.error('Konnte bestehendes Ergebnis nicht pruefen:', e);
  }

  isMultiplayer = true;
  currentGameCode = code;
  roundsTotal = MP_ROUNDS;
  totalScore = 0;
  currentRoundIndex = 0;
  roundResults = [];
  roundPool = await resolveRoundLocations(code);

  hudPlayer.textContent = playerName;
  showScreen(gameScreen);
  startRound();
}

// ---------------------------------------------------------------
// Anti-Wiederholung (nur Singleplayer): "Kartenstapel", der erst
// neu gemischt wird, wenn alle Orte einmal gezogen wurden. Der
// Fortschritt bleibt via localStorage auch über Sessions hinweg
// erhalten, damit sich Panoramen möglichst lange nicht wiederholen.
// ---------------------------------------------------------------
const DECK_STORAGE_KEY = 'weltraten_deck';

function loadDeck() {
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    const deck = raw ? JSON.parse(raw) : [];
    const validIds = new Set(locations.map((l) => l.id));
    return deck.filter((id) => validIds.has(id));
  } catch {
    return [];
  }
}

function saveDeck(deck) {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deck));
}

function drawLocations(count) {
  let deck = loadDeck();
  const drawn = [];

  while (drawn.length < count) {
    if (deck.length === 0) {
      const excludeIds = new Set(drawn.map((l) => l.id));
      let pool = locations.filter((l) => !excludeIds.has(l.id));
      if (pool.length === 0) pool = locations;
      deck = shuffle(pool).map((l) => l.id);
    }
    const id = deck.shift();
    const loc = locations.find((l) => l.id === id);
    if (loc) drawn.push(loc);
  }

  saveDeck(deck);
  return drawn;
}

// ---------------------------------------------------------------
// Runde anzeigen
// ---------------------------------------------------------------
function startRound() {
  const location = roundPool[currentRoundIndex];
  currentRoundIsSwiss = Boolean(location.place);
  hudRound.textContent = isMultiplayer
    ? `Runde ${currentRoundIndex + 1} / ${roundsTotal} · ${currentGameCode}`
    : `Runde ${currentRoundIndex + 1} / ${roundsTotal}`;
  hudScore.textContent = `${totalScore} Punkte`;
  guessSelect.innerHTML = currentRoundIsSwiss ? swissOptionsHtml : countryOptionsHtml;
  guessSelect.selectedIndex = 0;

  if (!panorama) {
    panorama = new google.maps.StreetViewPanorama(document.getElementById('streetview'), {
      pov: { heading: Math.random() * 360, pitch: 0 },
      zoom: 1,
      addressControl: false,      // keine Adresse einblenden, sonst zu einfach
      linksControl: false,        // keine Pfeile zum Nachbar-Panorama
      clickToGo: false,           // auch per Klick/Doppeltipp kein Weiterlaufen
      panControl: true,
      zoomControl: true,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
    });
  }
  if (!streetViewService) {
    streetViewService = new google.maps.StreetViewService();
  }

  placeOutdoorPanorama(location);
  showScreen(gameScreen);
}

// Sucht gezielt ein Aussen-Panorama in der Nähe (schliesst Innenaufnahmen wie
// Museen, Bibliotheken, Läden aus). Falls im Umkreis nichts gefunden wird,
// wird der Suchradius schrittweise vergrössert.
//
// `token` markiert, zu welcher Runde diese Suche gehört: kommt die Antwort
// zurück, nachdem längst die nächste Runde gestartet wurde, wird sie
// verworfen statt das falsche Panorama über die neue Runde zu legen.
function placeOutdoorPanorama(location, radius = 50, token = ++currentRequestToken, swapAttempts = 0) {
  if (radius === 50) {
    panoLoading.classList.remove('hidden');
    guessSubmit.disabled = true;
    guessSelect.disabled = true;
  }

  const target = { lat: location.lat, lng: location.lng };
  streetViewService.getPanorama(
    { location: target, radius, source: google.maps.StreetViewSource.OUTDOOR },
    (data, status) => {
      if (token !== currentRequestToken) return; // veraltete Antwort einer vorherigen Runde

      if (status === google.maps.StreetViewStatus.OK) {
        panorama.setPano(data.location.pano);
        panorama.setPov({ heading: Math.random() * 360, pitch: 0 });
        finishPanoramaLoad();
        return;
      }

      if (radius < 5000) {
        placeOutdoorPanorama(location, radius * 4, token, swapAttempts);
        return;
      }

      if (swapAttempts < 3) {
        // Selbst im 5-km-Umkreis kein Aussen-Panorama -> anderen Ort
        // nachziehen statt ein moegliches Innenraum-Bild zu riskieren.
        // Im Multiplayer MUSS der Ersatz deterministisch (vom Spielcode
        // abgeleitet) sein, sonst sehen Mitspieler ein anderes Bild.
        const replacement = isMultiplayer
          ? deterministicShuffle(locations, `${currentGameCode}-swap-${currentRoundIndex}-${swapAttempts}`).find(
              (l) => l.id !== location.id
            )
          : drawLocations(1)[0];

        roundPool[currentRoundIndex] = replacement;
        currentRoundIsSwiss = Boolean(replacement.place);
        guessSelect.innerHTML = currentRoundIsSwiss ? swissOptionsHtml : countryOptionsHtml;
        guessSelect.selectedIndex = 0;
        placeOutdoorPanorama(replacement, 50, ++currentRequestToken, swapAttempts + 1);
        return;
      }

      // Letzter Ausweg nach mehreren Ersatz-Versuchen: irgendein Panorama an der Position.
      panorama.setPosition(target);
      panorama.setPov({ heading: Math.random() * 360, pitch: 0 });
      finishPanoramaLoad();
    }
  );
}

function finishPanoramaLoad() {
  panoLoading.classList.add('hidden');
  guessSubmit.disabled = false;
  guessSelect.disabled = false;
}

// ---------------------------------------------------------------
// "Bild melden"-Popup
// ---------------------------------------------------------------
reportButton.addEventListener('click', () => {
  reportModal.classList.remove('hidden');
});

reportCancelButton.addEventListener('click', () => {
  reportModal.classList.add('hidden');
});

async function handleReportClick(reason) {
  reportTooEasyButton.disabled = true;
  reportImpossibleButton.disabled = true;
  try {
    await reportLocation(roundPool[currentRoundIndex], reason);
  } catch (e) {
    console.error('Meldung fehlgeschlagen:', e);
  }
  reportTooEasyButton.disabled = false;
  reportImpossibleButton.disabled = false;
  reportModal.classList.add('hidden');
  flashButtonFeedback(reportButton, 'Gemeldet ✓');
}

reportTooEasyButton.addEventListener('click', () => handleReportClick('too_easy'));
reportImpossibleButton.addEventListener('click', () => handleReportClick('impossible'));

// ---------------------------------------------------------------
// Raten & Scoring
// ---------------------------------------------------------------
guessForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const guess = guessSelect.value;
  if (!guess) return;

  const location = roundPool[currentRoundIndex];
  const actual = currentRoundIsSwiss ? location.place : location.country;
  const { points, distanceKm } = scoreGuess(guess, actual, currentRoundIsSwiss);

  totalScore += points;
  roundResults.push({ guess, actual, points, distanceKm });

  showRoundResult(guess, actual, points, distanceKm);
});

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function scoreGuess(guess, actual, isSwiss) {
  if (normalize(guess) === normalize(actual)) {
    return { points: MAX_POINTS, distanceKm: 0 };
  }

  const coordLookup = isSwiss ? swissPlaceCoords : centroids;
  const decayKm = isSwiss ? SCORE_DECAY_KM_SWISS : SCORE_DECAY_KM;

  const guessCoord = coordLookup[Object.keys(coordLookup).find((n) => normalize(n) === normalize(guess))];
  const actualCoord = coordLookup[actual];

  if (!guessCoord || !actualCoord) {
    return { points: 0, distanceKm: null };
  }

  const distanceKm = haversineKm(guessCoord, actualCoord);
  const points = Math.round(MAX_POINTS * Math.exp(-distanceKm / decayKm));
  return { points, distanceKm };
}

function showRoundResult(guess, actual, points, distanceKm) {
  const correct = normalize(guess) === normalize(actual);
  const noun = currentRoundIsSwiss ? 'Ort' : 'Land';
  resultHeadline.textContent = correct ? 'Richtig!' : `Es war ${actual}`;
  resultDetail.textContent =
    distanceKm === null
      ? `„${guess}“ kennt die Liste nicht – prüfe die Schreibweise.`
      : correct
      ? `Du hast den ${noun} exakt getroffen.`
      : `Deine Antwort „${guess}“ liegt rund ${Math.round(distanceKm)} km entfernt.`;
  resultPoints.textContent = `+${points} Punkte`;
  hudScore.textContent = `${totalScore} Punkte`;
  showScreen(resultScreen);
}

nextRoundButton.addEventListener('click', () => {
  currentRoundIndex += 1;
  if (currentRoundIndex >= roundsTotal) {
    showFinalScreen();
  } else {
    startRound();
  }
});

// ---------------------------------------------------------------
// Endstand
// ---------------------------------------------------------------
function showFinalScreen() {
  const lines = roundResults
    .map((r, i) => `Runde ${i + 1}: ${escapeHtml(r.actual)} – ${Number(r.points)} Punkte`)
    .join('<br>');

  finalSummary.innerHTML = isMultiplayer
    ? `${escapeHtml(playerName)}, dein Ergebnis in Spiel ${escapeHtml(currentGameCode)}: <strong>${totalScore} Punkte</strong><br><br>${lines}`
    : `${escapeHtml(playerName)}, dein Ergebnis: <strong>${totalScore} Punkte</strong><br><br>${lines}`;

  if (isMultiplayer) {
    completeMultiplayerGame(currentGameCode, totalScore);
    playAgainButton.classList.add('hidden');
    finalShareButton.classList.remove('hidden');
    finalLeaderboardButton.classList.remove('hidden');
  } else {
    playAgainButton.classList.remove('hidden');
    finalShareButton.classList.add('hidden');
    finalLeaderboardButton.classList.add('hidden');
  }
  finalLandingButton.classList.remove('hidden');

  showScreen(finalScreen);
}

async function completeMultiplayerGame(code, score) {
  localStorage.setItem(mpCompletedKey(code), JSON.stringify({ score, ts: Date.now() }));
  try {
    await submitResult(code, playerName, score);
  } catch (e) {
    console.error('Ergebnis konnte nicht in die Rangliste geschrieben werden:', e);
    resultDetailNote('Ergebnis lokal gespeichert, aber Übertragung an die Rangliste ist fehlgeschlagen.');
  }
}

function resultDetailNote(msg) {
  // Kleiner, nicht-blockierender Hinweis unter dem Endstand
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = msg;
  finalSummary.after(note);
}

playAgainButton.addEventListener('click', () => {
  startGame();
});

finalShareButton.addEventListener('click', () => {
  shareLink(
    buildInviteLink(currentGameCode),
    `Weltraten – Spiel ${currentGameCode} (mein Ergebnis: ${totalScore} Punkte)`,
    finalShareButton
  );
});

finalLeaderboardButton.addEventListener('click', () => {
  showLeaderboardScreen(currentGameCode);
});

finalLandingButton.addEventListener('click', goToLanding);

// ---------------------------------------------------------------
// "Schon gespielt"-Screen (Aufruf eines MP-Links fuer ein
// abgeschlossenes Spiel dieses Geraets)
// ---------------------------------------------------------------
function showMpLockedScreen(code, info) {
  currentGameCode = code;
  mpLockedDetail.textContent = `Du hast Spiel ${code} bereits gespielt: ${Number(info.score) || 0} Punkte. Nochmal spielen geht nicht (sonst wäre die Rangliste unfair).`;
  showScreen(mpLockedScreen);
}

mpLockedLeaderboardButton.addEventListener('click', () => {
  showLeaderboardScreen(currentGameCode);
});
mpLockedBackButton.addEventListener('click', goToLanding);

// ---------------------------------------------------------------
// Rangliste
// ---------------------------------------------------------------
async function showLeaderboardScreen(code) {
  currentLeaderboardCode = code;
  leaderboardCodeLabel.textContent = code;
  leaderboardList.innerHTML = '<li>Lade Rangliste …</li>';
  showScreen(leaderboardScreen);

  try {
    const entries = await fetchLeaderboard(code);
    leaderboardList.innerHTML = entries.length
      ? entries
          .map((e) => `<li><span>${escapeHtml(String(e.name ?? '?'))}</span><span class="lb-score">${Number(e.score) || 0} Punkte</span></li>`)
          .join('')
      : '<li>Noch keine Ergebnisse.</li>';
  } catch (e) {
    console.error('Rangliste konnte nicht geladen werden:', e);
    leaderboardList.innerHTML = '<li>Rangliste konnte nicht geladen werden.</li>';
  }
}

leaderboardShareButton.addEventListener('click', () => {
  shareLink(
    buildInviteLink(currentLeaderboardCode),
    `Weltraten – Spiel ${currentLeaderboardCode}`,
    leaderboardShareButton
  );
});

leaderboardBackButton.addEventListener('click', goToLanding);

// ---------------------------------------------------------------
// Start: Daten laden, dann anhand der URL entscheiden, was zu
// zeigen ist (normale Startseite oder MP-Einstieg via Link).
// ---------------------------------------------------------------
async function boot() {
  await loadData();

  const params = new URLSearchParams(window.location.search);

  if (params.get('admin') === 'flags') {
    showAdminFlagsScreen();
    return;
  }

  const rawCode = params.get('game');
  const code = isValidGameCode(rawCode) ? rawCode.toUpperCase() : null;

  // Beim ersten Besuch zuerst den Spielernamen waehlen lassen. Danach
  // wird nie wieder danach gefragt (aenderbar ueber das Profil).
  if (!playerName) {
    pendingLoginContext = code ? { type: 'mp-join', code } : { type: 'sp' };
    loginSubtitle.textContent = code
      ? `Spiel ${code} beitreten – wähle zuerst deinen Spielernamen.`
      : 'Wähle deinen Spielernamen – er wird für alle Ranglisten verwendet.';
    usernameInput.value = '';
    showScreen(loginScreen);
    return;
  }

  if (code) {
    const info = getCompletedInfo(code);
    if (info) {
      showMpLockedScreen(code, info);
    } else {
      startMultiplayerRounds(code);
    }
  } else {
    showLandingScreen();
  }
}

boot();
