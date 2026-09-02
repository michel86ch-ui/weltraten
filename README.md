# Weltraten – GeoGuessr-Nachbau ohne Account

Statisches Web-Spiel: Street-View-Panorama frei umschauen (360°), Land raten,
Punkte nach Distanz zwischen geratenem und echtem Land. Kein Login, nur ein
lokal gespeicherter Anzeigename.

## 1. Google Maps API Key besorgen

1. Google Cloud Console → neues Projekt → Abrechnungskonto hinterlegen
   (ohne Billing läuft die Street View API nicht, es gibt aber ein
   monatliches Gratis-Guthaben).
2. **Maps JavaScript API** aktivieren.
3. Unter „Anmeldedaten“ einen API-Key erstellen.
4. **Wichtig:** Key unter „Anwendungseinschränkungen“ → HTTP-Referrer auf
   `https://<dein-username>.github.io/*` beschränken. Der Key steht im
   öffentlichen Repo sichtbar im Client-Code – die Referrer-Sperre ist der
   einzige Schutz vor Missbrauch. Zusätzlich in der Cloud Console ein
   Budget-Alert einrichten.
5. Key in `config.js` eintragen.

## 2. Lokal testen

Kein Build-Step nötig, aber `fetch()` auf die JSON-Dateien braucht einen
echten Server (kein `file://`):

```bash
python3 -m http.server 8000
# http://localhost:8000 öffnen
```

## 3. Auf GitHub Pages veröffentlichen

**Per Kommandozeile (Desktop):**

```bash
git init
git add .
git commit -m "Weltraten MVP"
git branch -M main
git remote add origin <dein-repo-url>
git push -u origin main
```

**Ohne Kommandozeile (z. B. vom Handy):** neues, leeres Repository auf
github.com anlegen → auf der Repo-Seite „Add file“ → „Upload files“ →
alle Dateien aus diesem Ordner auf einmal auswählen und hochladen (die
Dateien liegen absichtlich flach, kein Unterordner nötig).

Danach in beiden Fällen: Repo-Settings → Pages → Branch `main`, Ordner
`/ (root)` auswählen → speichern. Nach ein bis zwei Minuten ist die Seite
unter `https://<dein-username>.github.io/<repo-name>/` erreichbar.

## Wie es funktioniert

- **Kein Account:** `index.html` fragt nur einen Anzeigenamen ab, der per
  `localStorage` im Browser bleibt. Es gibt keinen Server, keine
  Passwörter, keine Sessions.
- **Runden:** `locations.json` enthält Koordinaten mit bekannt guter
  Street-View-Abdeckung plus dem tatsächlichen Land. Pro Spiel werden
  zufällig 5 davon gezogen (`ROUNDS_PER_GAME` in `script.js`).
- **Schweiz-Modus:** 60 der Einträge sind Schweizer Städte/Dörfer mit einem
  zusätzlichen `place`-Feld. Landet eine Runde dort, schaltet das Dropdown
  automatisch von der Länderliste auf eine Liste von Schweizer Orten um –
  gefragt ist dann der genaue Ort, nicht "Schweiz". Scoring läuft über einen
  engeren Distanz-Massstab (`SCORE_DECAY_KM_SWISS`), weil die Schweiz
  geografisch viel kleiner ist als ein Land-Vergleich auf Weltniveau.
- **Scoring:** Bei exaktem Treffer gibt's die vollen 5000 Punkte
  (`MAX_POINTS`). Sonst wird die Distanz zwischen den Zentroiden
  (`country-centroids.json`) von geratenem und echtem Land berechnet
  (Haversine-Formel) und über eine e-Funktion in Punkte umgerechnet –
  gleiche Kurve wie im Original: nah dran = viele Punkte, exponentieller
  Abfall mit der Distanz.
- **Bewegung gesperrt:** `linksControl: false` verhindert, dass man im
  Panorama zum Nachbarbild weiterläuft – sonst ließe sich über Ortsschilder
  o. Ä. leicht schummeln.
- **Keine Wiederholungen:** Die Standorte werden wie ein Kartenstapel gezogen
  (`drawLocations()` in `script.js`) – kein Ort kommt zweimal dran, bevor
  nicht alle anderen einmal gezeigt wurden. Der Fortschritt wird in
  `localStorage` gespeichert und bleibt so auch über mehrere Spiele/Browser-
  Sessions hinweg erhalten.

## Bekannte Einschränkungen / nächste Schritte

- Insgesamt 115 Standorte hinterlegt (55 Länder-Runden + 60 Schweizer
  Städte/Dörfer für den Schweiz-Modus) und ~58 Länder-Zentroide
  (`locations.json`, `country-centroids.json`) – für noch mehr Abwechslung
  lohnt sich eine weitere Erweiterung. Jeder Eintrag in `locations.json`
  braucht eine eindeutige `id`, damit das Anti-Wiederholungssystem (siehe
  unten) funktioniert; Schweizer Orte zusätzlich ein `place`-Feld. Die
  Zentroid-Koordinaten sind grobe Näherungswerte; für faireres Scoring lohnt
  sich ein Ersatz durch einen geprüften offenen Datensatz mit echten
  Länder-Centroiden.
- Kein globales Leaderboard: Punkte gelten nur für die laufende
  Browser-Session. Für ein öffentliches Ranking bräuchte es ein simples
  Backend (z. B. Firebase Firestore oder Supabase mit anonymem Zugriff) –
  bewusst weggelassen, um ohne Account/Server auszukommen.
- Der API-Key ist im Client-Code sichtbar. Für höheren Schutz später einen
  kleinen Proxy (z. B. Cloudflare Worker) vorschalten, der den Key serverseitig
  hält.
