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
- **Multiplayer (10 Runden):** Ein neues MP-Spiel bekommt einen zufälligen
  6-stelligen Code. Aus diesem Code wird deterministisch
  (`deterministicShuffle()`) dieselbe Liste von 10 Orten berechnet – jedes
  Gerät, das den Code kennt, zieht exakt dieselben Orte, ganz ohne dass die
  Orte selbst irgendwo gespeichert werden müssen.
  Nach den 10 Runden wird das Spiel für dieses Gerät lokal gesperrt (kein
  Neuspielen für einen besseren Score, per `localStorage`).
  **Spiele auffindbar ohne Link:** Beim Erstellen wird zusätzlich ein
  Dokument `games/{code}` mit Ersteller und Zeitstempel angelegt. Die
  Startseite lädt darüber **alle** existierenden Spiele (`fetchAllGames()`)
  und zeigt sie in zwei Abschnitten – offene oben, abgeschlossene unten,
  beides scrollbar. Der Einladungslink bleibt als Abkürzung nutzbar, ist
  aber nicht mehr zwingend nötig, um ein Spiel zu finden.
  **Rangliste über Firebase/Firestore:** Das Ergebnis (Name + Punktzahl)
  wird nach Abschluss in dieselbe Datenbank geschrieben
  (`games/{code}/players/{autoId}`), die Rangliste liest live von dort –
  echt gemeinsam für alle Spieler.
  Setup-Anleitung dafür: Abschnitt "4. Firebase einrichten" unten.

## 4. Firebase einrichten (für die Multiplayer-Rangliste)

1. In der [Firebase-Konsole](https://console.firebase.google.com) das
   bestehende Google-Cloud-Projekt (dasselbe wie für die Maps API) als
   Firebase-Projekt hinzufügen, Analytics kann deaktiviert bleiben.
2. **Firestore Database** aktivieren (Menü → Datenbanken und Speicher →
   Firestore), Region z. B. `europe-west6` (Zürich), im **Testmodus**
   starten.
3. Web-App registrieren (Projektübersicht → App hinzufügen → `</>`-Symbol),
   Firebase Hosting dabei **nicht** aktivieren (wir bleiben bei GitHub
   Pages). Die angezeigte `firebaseConfig` in `firebase-config.js` eintragen.
4. **Sicherheitsregeln setzen** (Firestore → Regeln-Tab), damit nach den
   30 Tagen Testmodus nicht plötzlich alles gesperrt ist bzw. damit von
   Anfang an nur sinnvolle Daten reinkommen:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /games/{gameCode} {
         allow read: if true;
         allow create: if gameCode.matches('^[A-Za-z0-9]{4,12}$')
                       && request.resource.data.keys().hasOnly(['createdBy', 'createdAt', 'rounds'])
                       && request.resource.data.createdBy is string
                       && request.resource.data.createdBy.size() > 0
                       && request.resource.data.createdBy.size() <= 20
                       && request.resource.data.rounds is list
                       && request.resource.data.rounds.size() == 10;
         allow update, delete: if false;

         match /players/{playerId} {
           allow read: if true;
           allow create: if request.resource.data.keys().hasOnly(['name', 'score', 'ts'])
                         && request.resource.data.name is string
                         && request.resource.data.name.size() > 0
                         && request.resource.data.name.size() <= 20
                         && request.resource.data.score is int
                         && request.resource.data.score >= 0
                         && request.resource.data.score <= 50000;
           allow update, delete: if false;
         }
       }
       match /flags/{flagId} {
         allow read: if true;
         allow create: if request.resource.data.keys().hasOnly(['locationId', 'country', 'place', 'reason', 'ts'])
                       && request.resource.data.locationId is string
                       && request.resource.data.reason in ['too_easy', 'impossible'];
         allow update, delete: if false;
       }
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```

   Neu dabei: `games/{gameCode}` selbst (wer hat's erstellt, wann, und ein
   **kompletter, eingefrorener Snapshot** der 10 Orte inkl. Koordinaten unter
   `rounds`). Zwei Gründe dafür: erstens braucht es das für die Startseite,
   die jetzt **alle** existierenden Spiele auflistet, nicht nur die auf dem
   eigenen Gerät bekannten. Zweitens – wichtiger – macht ein einmal
   erstelltes Spiel komplett unabhängig von späteren Änderungen an
   `locations.json`: Nicht nur die Auswahl der 10 Orte steht fest, sondern
   auch ihre exakten Koordinaten. Würde man nur die `id` referenzieren und
   die Koordinaten live nachladen, könnten zwei Spieler desselben noch
   offenen Spiels unterschiedliche Panoramen für dieselbe Runde sehen, falls
   dazwischen ein gemeldetes Bild korrigiert wurde. Mit dem vollen Snapshot
   passiert das nicht mehr (`resolveRoundLocations()` in `script.js`).

   **Workflow fürs Bereinigen gemeldeter Bilder:** Koordinaten eines
   gemeldeten Orts einfach direkt in seinem bestehenden Eintrag in
   `locations.json` überschreiben (gleiche `id` behalten). Das wirkt sich
   nur auf **neu erstellte** Spiele ab diesem Zeitpunkt aus – bereits
   erstellte Spiele (offen oder abgeschlossen) bleiben durch ihren Snapshot
   exakt so, wie sie beim Erstellen waren.
   Nur falls eine `id` komplett wegfallen muss, greift für alte, davon
   betroffene Spiele ein deterministischer Ersatz-Ort als Fallback.

   Rest wie gehabt: jeder darf lesen und **einmal** plausible Daten anlegen
   (Name ≤ 20 Zeichen, Score 0–50'000, Meldegrund nur
   "too_easy"/"impossible"), nichts nachträglich ändern oder löschen. Alles
   ausserhalb dieser Pfade ist komplett gesperrt.

   **"Bild melden"-Funktion:** Im Spiel gibt's oben rechts einen Button
   "⚑ Bild melden" (nur während einer laufenden Runde sichtbar). Meldungen
   landen in der Sammlung `flags` (Firestore → Daten → `flags`) mit
   Orts-ID, Land/Ort und Grund ("zu einfach" / "unmöglich") – dort
   regelmässig reinschauen und auffällige Orte in `locations.json` ersetzen.



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
