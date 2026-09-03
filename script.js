// ---------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------
const SP_ROUNDS = 5;   // Singleplayer
const MP_ROUNDS = 10;  // Multiplayer
const MAX_POINTS = 5000;
const SCORE_DECAY_KM = 2000;        // Länder-Runden: grosszügiger Massstab
const SCORE_DECAY_KM_SWISS = 40;    // Schweiz-Runden: kleines Land, engerer Massstab

const KNOWN_GAMES_KEY = 'weltraten_mp_known_games';

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

const allScreens = [
  landingScreen, loginScreen, gameScreen, resultScreen, finalScreen,
  inviteScreen, mpLockedScreen, leaderboardScreen,
];

function showScreen(screen) {
  allScreens.forEach((s) => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

const landingSingleplayerButton = document.getElementById('landing-singleplayer-button');
const landingMultiplayerButton = document.getElementById('landing-multiplayer-button');
const landingMpList = document.getElementById('landing-mp-list');

const loginSubtitle = document.getElementById('login-subtitle');
const usernameInput = document.getElementById('username-input');
const startButton = document.getElementById('start-button');

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
    fetch('locations.json'),
    fetch('country-centroids.json'),
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

function rememberKnownGame(code) {
  try {
    const raw = localStorage.getItem(KNOWN_GAMES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const filtered = list.filter((c) => c !== code);
    filtered.unshift(code);
    localStorage.setItem(KNOWN_GAMES_KEY, JSON.stringify(filtered.slice(0, 30)));
  } catch {
    // localStorage evtl. nicht verfuegbar -> einfach ignorieren
  }
}

function getKnownGames() {
  try {
    const raw = localStorage.getItem(KNOWN_GAMES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
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
function showLandingScreen() {
  const known = getKnownGames();
  if (known.length === 0) {
    landingMpList.innerHTML = '';
  } else {
    landingMpList.innerHTML =
      '<p class="mp-list-heading">Deine Multiplayer-Spiele</p>' +
      known
        .map((code) => {
          const info = getCompletedInfo(code);
          const statusText = info ? `gespielt: ${info.score} Punkte` : 'noch offen';
          const action = info ? 'Rangliste' : 'Weiter';
          const dataAction = info ? 'lb' : 'play';
          return `<div class="mp-list-entry"><div><strong>${escapeHtml(code)}</strong><br><span class="mp-list-status">${statusText}</span></div><button data-code="${escapeHtml(code)}" data-action="${dataAction}">${action}</button></div>`;
        })
        .join('');
  }
  showScreen(landingScreen);
}

landingMpList.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-code]');
  if (!btn) return;
  const code = btn.dataset.code;
  if (btn.dataset.action === 'lb') {
    showLeaderboardScreen(code);
  } else {
    pendingLoginContext = { type: 'mp-join', code };
    loginSubtitle.textContent = `Multiplayer-Spiel ${code} beitreten – wie heisst du?`;
    usernameInput.value = playerName;
    showScreen(loginScreen);
  }
});

landingSingleplayerButton.addEventListener('click', () => {
  pendingLoginContext = { type: 'sp' };
  loginSubtitle.textContent = 'Du landest irgendwo auf der Welt. Schau dich um und errate das Land.';
  usernameInput.value = playerName;
  showScreen(loginScreen);
});

landingMultiplayerButton.addEventListener('click', () => {
  const code = generateGameCode();
  pendingLoginContext = { type: 'mp-create', code };
  loginSubtitle.textContent = `Multiplayer-Spiel ${code} erstellen – wie heisst du?`;
  usernameInput.value = playerName;
  showScreen(loginScreen);
});

function goToLanding() {
  clearUrlParams();
  showLandingScreen();
}

// ---------------------------------------------------------------
// Namen-Screen (SP-Start, MP-Erstellung, MP-Beitritt)
// ---------------------------------------------------------------
startButton.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  if (!name) {
    usernameInput.focus();
    return;
  }
  playerName = name;
  localStorage.setItem('weltraten_name', playerName);

  if (pendingLoginContext.type === 'mp-create') {
    rememberKnownGame(pendingLoginContext.code);
    showInviteScreen(pendingLoginContext.code);
  } else if (pendingLoginContext.type === 'mp-join') {
    rememberKnownGame(pendingLoginContext.code);
    startMultiplayerRounds(pendingLoginContext.code);
  } else {
    startGame();
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
function startMultiplayerRounds(code) {
  isMultiplayer = true;
  currentGameCode = code;
  roundsTotal = MP_ROUNDS;
  totalScore = 0;
  currentRoundIndex = 0;
  roundResults = [];
  roundPool = deterministicLocations(code, roundsTotal);

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
    .map((r, i) => `Runde ${i + 1}: ${r.actual} – ${r.points} Punkte`)
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
  rememberKnownGame(code);
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
  mpLockedDetail.textContent = `Du hast Spiel ${code} auf diesem Gerät bereits gespielt: ${info.score} Punkte. Nochmal spielen geht nicht (sonst wäre die Rangliste unfair).`;
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
          .map((e) => `<li><span>${escapeHtml(e.name)}</span><span class="lb-score">${e.score} Punkte</span></li>`)
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
  const rawCode = params.get('game');
  const code = isValidGameCode(rawCode) ? rawCode.toUpperCase() : null;

  if (code) {
    const info = getCompletedInfo(code);
    if (info) {
      showMpLockedScreen(code, info);
    } else {
      rememberKnownGame(code);
      pendingLoginContext = { type: 'mp-join', code };
      loginSubtitle.textContent = `Multiplayer-Spiel ${code} beitreten – wie heisst du?`;
      usernameInput.value = playerName;
      showScreen(loginScreen);
    }
  } else {
    showLandingScreen();
  }
}

boot();
