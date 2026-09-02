// ---------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------
const ROUNDS_PER_GAME = 5;
const MAX_POINTS = 5000;
const SCORE_DECAY_KM = 2000; // je kleiner, desto strenger die Punkteverteilung

// ---------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------
let mapsReady = false;
let locations = [];
let centroids = {};
let panorama = null;

let playerName = localStorage.getItem('weltraten_name') || '';
let roundPool = [];
let currentRoundIndex = 0;
let totalScore = 0;
let roundResults = [];

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
const guessInput = document.getElementById('guess-input');
const countryList = document.getElementById('country-list');

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

  const names = Object.keys(centroids).sort((a, b) => a.localeCompare(b, 'de'));
  countryList.innerHTML = names.map((n) => `<option value="${n}"></option>`).join('');
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
  roundPool = shuffle(locations).slice(0, ROUNDS_PER_GAME);

  loginScreen.classList.add('hidden');
  finalScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  hudPlayer.textContent = playerName;

  startRound();
}

function startRound() {
  const location = roundPool[currentRoundIndex];
  hudRound.textContent = `Runde ${currentRoundIndex + 1} / ${ROUNDS_PER_GAME}`;
  hudScore.textContent = `${totalScore} Punkte`;
  guessInput.value = '';

  const position = { lat: location.lat, lng: location.lng };

  if (!panorama) {
    panorama = new google.maps.StreetViewPanorama(document.getElementById('streetview'), {
      position,
      pov: { heading: Math.random() * 360, pitch: 0 },
      zoom: 1,
      addressControl: false,      // keine Adresse einblenden, sonst zu einfach
      linksControl: false,        // kein Wechsel auf benachbarte Panoramen
      panControl: true,
      zoomControl: true,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
    });
  } else {
    panorama.setPosition(position);
    panorama.setPov({ heading: Math.random() * 360, pitch: 0 });
  }

  resultScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

guessForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const guess = guessInput.value.trim();
  if (!guess) return;

  const actual = roundPool[currentRoundIndex].country;
  const { points, distanceKm } = scoreGuess(guess, actual);

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

function scoreGuess(guess, actual) {
  // Exakt richtiges Land -> volle Punktzahl, unabhängig von der Landesgröße.
  if (normalize(guess) === normalize(actual)) {
    return { points: MAX_POINTS, distanceKm: 0 };
  }

  const guessCentroid = centroids[Object.keys(centroids).find((n) => normalize(n) === normalize(guess))];
  const actualCentroid = centroids[actual];

  // Unbekanntes/falsch geschriebenes Land -> keine Punkte, aber kein Absturz.
  if (!guessCentroid || !actualCentroid) {
    return { points: 0, distanceKm: null };
  }

  const distanceKm = haversineKm(guessCentroid, actualCentroid);
  const points = Math.round(MAX_POINTS * Math.exp(-distanceKm / SCORE_DECAY_KM));
  return { points, distanceKm };
}

function showRoundResult(guess, actual, points, distanceKm) {
  gameScreen.classList.add('hidden');
  resultScreen.classList.remove('hidden');

  const correct = normalize(guess) === normalize(actual);
  resultHeadline.textContent = correct ? 'Richtig!' : `Es war ${actual}`;
  resultDetail.textContent =
    distanceKm === null
      ? `„${guess}“ kennt die Länderliste nicht – prüfe die Schreibweise.`
      : correct
      ? 'Du hast das Land exakt getroffen.'
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
