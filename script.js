// ---------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------
const ROUNDS_PER_GAME = 5;
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

let playerName = localStorage.getItem('weltraten_name') || '';
let roundPool = [];
let currentRoundIndex = 0;
let totalScore = 0;
let roundResults = [];
let currentRequestToken = 0; // erkennt/verwirft veraltete Panorama-Antworten aus früheren Runden

// ---------------------------------------------------------------
// DOM-Referenzen
// ---------------------------------------------------------------
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');
const finalScreen = document.getElementById('final-screen');

const usernameInput = document.getElementById('username-input');
const startButton = document.getElementById('start-button');

const guessForm = document.getElementById('guess-form');
const guessSelect = document.getElementById('guess-select');
const guessSubmit = document.getElementById('guess-submit');
const panoLoading = document.getElementById('pano-loading');

const hudPlayer = document.getElementById('hud-player');
const hudRound = document.getElementById('hud-round');
const hudScore = document.getElementById('hud-score');

const resultHeadline = document.getElementById('result-headline');
const resultDetail = document.getElementById('result-detail');
const resultPoints = document.getElementById('result-points');
const nextRoundButton = document.getElementById('next-round-button');

const finalSummary = document.getElementById('final-summary');
const playAgainButton = document.getElementById('play-again-button');

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

// ---------------------------------------------------------------
// Login
// ---------------------------------------------------------------
if (playerName) usernameInput.value = playerName;

startButton.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  if (!name) {
    usernameInput.focus();
    return;
  }
  playerName = name;
  localStorage.setItem('weltraten_name', playerName);
  startGame();
});

// ---------------------------------------------------------------
// Spielablauf
// ---------------------------------------------------------------
function startGame() {
  totalScore = 0;
  currentRoundIndex = 0;
  roundResults = [];
  roundPool = drawLocations(ROUNDS_PER_GAME);

  loginScreen.classList.add('hidden');
  finalScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  hudPlayer.textContent = playerName;

  startRound();
}

// ---------------------------------------------------------------
// Anti-Wiederholung: "Kartenstapel", der erst neu gemischt wird,
// wenn alle Orte einmal gezogen wurden. Der Fortschritt bleibt via
// localStorage auch über Browser-Neustarts/Sessions hinweg erhalten,
// damit sich Panoramen möglichst lange nicht wiederholen.
// ---------------------------------------------------------------
const DECK_STORAGE_KEY = 'weltraten_deck';

function loadDeck() {
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    const deck = raw ? JSON.parse(raw) : [];
    // Falls sich locations.json seit dem letzten Besuch geändert hat,
    // veraltete IDs aussortieren.
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
      if (pool.length === 0) pool = locations; // Sicherheitsnetz falls count > Gesamtzahl Orte
      deck = shuffle(pool).map((l) => l.id);
    }
    const id = deck.shift();
    const loc = locations.find((l) => l.id === id);
    if (loc) drawn.push(loc);
  }

  saveDeck(deck);
  return drawn;
}

let streetViewService = null;

function startRound() {
  const location = roundPool[currentRoundIndex];
  currentRoundIsSwiss = Boolean(location.place);
  hudRound.textContent = `Runde ${currentRoundIndex + 1} / ${ROUNDS_PER_GAME}`;
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

  resultScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

// Sucht gezielt ein Aussen-Panorama in der Nähe (schliesst Innenaufnahmen wie
// Museen, Bibliotheken, Läden aus). Falls im Umkreis nichts gefunden wird,
// wird der Suchradius schrittweise vergrössert.
//
// `token` markiert, zu welcher Runde diese Suche gehört: kommt die Antwort
// zurück, nachdem längst die nächste Runde gestartet wurde (z. B. weil
// mehrere Radius-Versuche nötig waren), wird sie verworfen statt das falsche
// Panorama über die neue Runde zu legen.
function placeOutdoorPanorama(location, radius = 50, token = ++currentRequestToken) {
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
      } else if (radius < 1000) {
        placeOutdoorPanorama(location, radius * 4, token);
      } else {
        // Letzter Ausweg, falls wirklich nichts Passendes existiert
        panorama.setPosition(target);
        panorama.setPov({ heading: Math.random() * 360, pitch: 0 });
        finishPanoramaLoad();
      }
    }
  );
}

function finishPanoramaLoad() {
  panoLoading.classList.add('hidden');
  guessSubmit.disabled = false;
  guessSelect.disabled = false;
}

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

function normalize(name) {
  return name.trim().toLowerCase();
}

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
  // Exakter Treffer -> volle Punktzahl, unabhängig von Landes-/Kantonsgrösse.
  if (normalize(guess) === normalize(actual)) {
    return { points: MAX_POINTS, distanceKm: 0 };
  }

  const coordLookup = isSwiss ? swissPlaceCoords : centroids;
  const decayKm = isSwiss ? SCORE_DECAY_KM_SWISS : SCORE_DECAY_KM;

  const guessCoord = coordLookup[Object.keys(coordLookup).find((n) => normalize(n) === normalize(guess))];
  const actualCoord = coordLookup[actual];

  // Unbekannter/falsch geschriebener Eintrag -> keine Punkte, aber kein Absturz.
  if (!guessCoord || !actualCoord) {
    return { points: 0, distanceKm: null };
  }

  const distanceKm = haversineKm(guessCoord, actualCoord);
  const points = Math.round(MAX_POINTS * Math.exp(-distanceKm / decayKm));
  return { points, distanceKm };
}

function showRoundResult(guess, actual, points, distanceKm) {
  gameScreen.classList.add('hidden');
  resultScreen.classList.remove('hidden');

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
}

nextRoundButton.addEventListener('click', () => {
  currentRoundIndex += 1;
  if (currentRoundIndex >= ROUNDS_PER_GAME) {
    showFinalScreen();
  } else {
    startRound();
  }
});

function showFinalScreen() {
  resultScreen.classList.add('hidden');
  finalScreen.classList.remove('hidden');

  const lines = roundResults
    .map((r, i) => `Runde ${i + 1}: ${r.actual} – ${r.points} Punkte`)
    .join('<br>');
  finalSummary.innerHTML = `${playerName}, dein Ergebnis: <strong>${totalScore} Punkte</strong><br><br>${lines}`;
}

playAgainButton.addEventListener('click', () => {
  finalScreen.classList.add('hidden');
  startGame();
});

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------
loadData();
