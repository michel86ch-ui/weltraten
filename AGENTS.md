# Agent-Briefing: Weltraten

Technische Dokumentation und Kontext für einen Coding-Agenten. Die
Spielbeschreibung für Mitspieler steht im `README.md` – hier steht alles
andere: Aufbau, Betrieb, Cloud-Konfiguration, Fallstricke.

Stand: 3. September 2026

---

## 1. Was das Projekt ist

Statisches Browserspiel im Stil von GeoGuessr. Der Spieler bekommt ein
Street-View-Panorama und rät das Land – bei Schweizer Standorten den
konkreten Ort. Kein Build-Step, kein Framework, kein Server.

- **Hosting:** GitHub Pages, Repo `michel86ch-ui/weltraten`, Branch `main`
- **Live:** https://michel86ch-ui.github.io/weltraten/
- **Panoramen:** Google Maps JavaScript API (`StreetViewPanorama`)
- **Datenbank:** Firebase Firestore (Ranglisten, Spiele, Meldungen, Profile)

| Datei | Zweck |
|---|---|
| `index.html` | alle Screens als `<section class="screen">` |
| `script.js` | gesamte Spiellogik |
| `style.css` | Styling |
| `locations.json` | 248 Standorte (`id`, `lat`, `lng`, `country`, optional `place`) |
| `country-centroids.json` | 58 Länder-Zentroide fürs Distanz-Scoring |
| `config.js` | Google-Maps-API-Key |
| `firebase-config.js` | Firebase-Konfiguration |

Datenbestand: 165 Länder-Runden aus 55 Ländern, 83 Schweizer Standorte in
62 Ortschaften. Jeder Eintrag braucht eine eindeutige `id`, damit
Anti-Wiederholung und Meldefunktion funktionieren; Schweizer Orte
zusätzlich ein `place`-Feld.

Konstanten oben in `script.js`: `SP_ROUNDS = 5`, `MP_ROUNDS = 10`,
`MAX_POINTS = 5000`, `SCORE_DECAY_KM = 2000`, `SCORE_DECAY_KM_SWISS = 40`.

---

## 2. Wie es funktioniert

- **Kein Account:** `index.html` fragt nur einen Anzeigenamen ab, der per
  `localStorage` im Browser bleibt. Kein Server, keine Passwörter, keine
  Sessions.
- **Runden:** `locations.json` enthält Koordinaten mit bekannt guter
  Street-View-Abdeckung plus dem tatsächlichen Land.
- **Schweiz-Modus:** Einträge mit `place`-Feld schalten das Dropdown von der
  Länderliste auf Schweizer Orte um – gefragt ist der genaue Ort, nicht
  "Schweiz". Scoring über `SCORE_DECAY_KM_SWISS`, weil die Schweiz
  geografisch viel kleiner ist als ein Ländervergleich auf Weltniveau.
- **Scoring:** Exakter Treffer = `MAX_POINTS`. Sonst Distanz zwischen den
  Zentroiden (`country-centroids.json`) von geratenem und echtem Land per
  Haversine, umgerechnet über eine e-Funktion – nah dran = viele Punkte,
  exponentieller Abfall mit der Distanz.
- **Bewegung gesperrt:** `linksControl: false` verhindert das Weiterlaufen
  zum Nachbarbild – sonst liesse sich über Ortsschilder leicht schummeln.
- **Keine Wiederholungen:** `drawLocations()` zieht wie aus einem
  Kartenstapel – kein Ort kommt zweimal, bevor nicht alle anderen einmal
  dran waren. Fortschritt liegt im `localStorage`.
- **Multiplayer:** Ein neues Spiel bekommt einen zufälligen sechsstelligen
  Code. Aus dem Code wird per `deterministicShuffle()` dieselbe Liste von
  10 Orten berechnet – jedes Gerät mit dem Code zieht exakt dieselben Orte.
  Nach 10 Runden wird das Spiel pro Gerät lokal gesperrt.
- **Spiele ohne Link auffindbar:** Beim Erstellen entsteht zusätzlich ein
  Dokument `games/{code}` mit Ersteller, Zeitstempel und den Runden. Die
  Startseite lädt über `fetchAllGames()` alle existierenden Spiele und zeigt
  offene oben, abgeschlossene darunter.
- **Rangliste:** Ergebnis (Name + Punktzahl) landet nach Abschluss in
  `games/{code}/players/{autoId}`, die Rangliste liest live von dort.

---

## 3. Einrichtung von Grund auf

Nur nötig, wenn das Projekt neu aufgesetzt oder der Key ersetzt wird.

### 3.1 Google-Maps-Key

1. Cloud Console → Projekt → **Maps JavaScript API** *und* **Street View
   Static API** aktivieren. Beide werden gebraucht (siehe 5.1).
2. Anmeldedaten → API-Key erstellen.
3. Anwendungseinschränkung: HTTP-Referrer `https://<username>.github.io/*`
4. API-Einschränkung: genau die beiden APIs aus Schritt 1.
5. Key in `config.js` eintragen.

### 3.2 Firebase

1. Firebase-Konsole → bestehendes Google-Cloud-Projekt als Firebase-Projekt
   hinzufügen. Analytics kann deaktiviert bleiben.
2. **Firestore Database** aktivieren, Region `europe-west6` (Zürich).
3. Web-App registrieren, Firebase Hosting dabei **nicht** aktivieren –
   gehostet wird auf GitHub Pages. Die angezeigte `firebaseConfig` in
   `firebase-config.js` eintragen.
4. Sicherheitsregeln aus Abschnitt 7 setzen.

### 3.3 GitHub Pages

Repo-Settings → Pages → Branch `main`, Ordner `/ (root)`. Nach ein bis zwei
Minuten unter `https://<username>.github.io/<repo>/` erreichbar.

### 3.4 Lokal testen

Kein Build-Step, aber `fetch()` auf die JSON-Dateien braucht einen echten
Server, kein `file://`:

```bash
python3 -m http.server 8000
```

Achtung: Die Referrer-Beschränkung des Keys erlaubt nur die
GitHub-Pages-Domain. Für lokales Testen mit Panoramen muss
`http://localhost:*/*` als zweiter Referrer am Key eingetragen werden.

---

## 4. Cloud-Landschaft

Drei Google-Cloud-Projekte, historisch gewachsen:

| Projekt | Rolle | Aktion |
|---|---|---|
| `weltenraten` | Maps JavaScript API + Street View Static API, API-Key (endet auf `…LsW0Pg`) | behalten |
| `weltquiz-ebfcd` | Firebase/Firestore – **alle Spieldaten** | behalten, niemals löschen |
| `weltquiz` | vermutlich leer, Namensrest | prüfen, dann löschen |

Abrechnung: Google-Cloud-Testguthaben (300 USD / 241 CHF, 90 Tage ab Anfang
September 2026). Firebase läuft auf dem Spark-Tarif ohne Zahlungsmittel und
kann keine Kosten verursachen.

Gratis-Kontingent Dynamic Street View: 5'000 Events pro Monat, danach
14 USD pro 1'000. Verbrauch am 3.9.2026: 25 Map loads.

**Der eigentliche Kostendeckel ist das Testkonto.** Ein Testkonto rechnet
nicht automatisch ab: Ist das Guthaben aufgebraucht oder sind die 90 Tage
um, wird das Konto geschlossen und die Dienste werden gestoppt – belastet
wird nur, wer selbst auf ein kostenpflichtiges Konto hochstuft. Solange das
nicht geschieht, ist der maximale finanzielle Schaden null. Das Upgrade also
bewusst nicht durchführen.

---

## 5. Offene Aufgaben

### 5.1 API-Key einschränken – ERLEDIGT (3.9.2026)

Der Key steht im öffentlichen Repo in `config.js`. Gesetzt sind:

1. Anwendungseinschränkung: HTTP-Referrer `https://michel86ch-ui.github.io/*`
2. API-Einschränkung: **Maps JavaScript API** *und* **Street View Static API**

**Wichtig, teuer gelernt:** Eine Einschränkung auf nur die Maps JavaScript
API reicht nicht. Google meldete beim Speichern aktive Nutzung von
`street-view-image-backend.googleapis.com` – das ist der Dienstname der
Street View Static API, über die `StreetViewPanorama` seine Kacheln holt.
Ohne diese zweite Freigabe bleibt das Panorama voraussichtlich schwarz. Der
ebenfalls gemeldete Dienst `mapsbilling-pa.googleapis.com` ist Googles
interne Nutzungsmeldung, steht nicht in der Auswahlliste und kann nicht
freigegeben werden; die Warnung wird mit dem Bestätigungswort
`AKTUALISIEREN` quittiert.

Verifiziert: Live-Seite lädt Panoramen, Konsole ohne
`RefererNotAllowedMapError` oder `ApiNotActivatedMapError`.

Grenze dieser Massnahme: Der `Referer` ist ein vom Client gesetzter Header
und grundsätzlich fälschbar. Die Beschränkung schützt gegen die Übernahme
des Keys aus dem öffentlichen Repo, nicht gegen einen gezielten Angreifer.

### 5.2 Hartes Tageslimit – NICHT MÖGLICH (geprüft 3.9.2026)

Nicht weiter suchen, der Weg existiert nicht mehr:

- *APIs und Dienste → Kontingente* und *Google Maps Platform → Kontingente*
  zeigen dieselben 9 Kontingente, alle mit **Anpassbar: Nein**.
  "Map loads per day" steht auf *Unbegrenzt* und lässt sich nicht setzen;
  "Kontingent bearbeiten" ist ausgegraut. Der Reiter "Increase Requests"
  dient nur Erhöhungen.
- Die Budget-Funktion **Erzwingung der Ausgabenobergrenze** pausiert Dienste
  zwar wirklich, deckt aber nur Cloud Run, Cloud Run Functions, Gemini API
  und Vertex AI ab – **Maps Platform ist nicht dabei**, und sie ist auf ein
  Projekt und einen Dienst beschränkt.

Bleibt als Ersatz: Budget-Alert (5.3) plus der Testkonto-Deckel aus
Abschnitt 4.

### 5.3 Budget-Alert – Priorität mittel

Abrechnung → Budgets und Benachrichtigungen → Budget erstellen, Variante
**Nur Benachrichtigungen** (nicht die Ausgabenobergrenze, siehe 5.2).
Umfang Projekt `weltenraten`, monatlich **10 CHF**, Schwellen
50 / 90 / 100 %, davon die erste auf Basis *Prognostiziert* als Frühwarnung,
die übrigen auf *Tatsächlich*.

Zielbetrag nicht kleiner ansetzen: Werden im Budget die Bruttokosten vor
Freikontingent gezählt, löst schon normales Spielen aus – 25
Panoramaladungen entsprechen brutto rund 0.35 USD. Ein 1-CHF-Budget
produziert damit Fehlalarme, an die man sich gewöhnt.

### 5.4 Projekt `weltquiz` aufräumen – Priorität niedrig

Erst prüfen, dass wirklich nichts drin ist – APIs mit Traffic,
Firestore-Datenbank. **Vorher sicherstellen, dass es nicht `weltquiz-ebfcd`
ist**, dort liegen alle Spieldaten; im Projektwähler heissen beide
"Weltquiz", nur die ID unterscheidet sie. Danach IAM & Verwaltung →
Einstellungen → Projekt herunterfahren. Google löscht erst nach 30 Tagen
endgültig.

### 5.5 Optional: Maps-Key ins Firebase-Projekt umziehen

Damit alles in einem Projekt liegt. Im Projekt `weltquiz-ebfcd` beide
Maps-APIs aktivieren, neuen Key mit denselben Einschränkungen anlegen, in
`config.js` eintragen, Asset-Version hochzählen, pushen, testen, erst dann
den alten Key löschen.

**Preis dieses Umzugs:** Maps braucht ein verknüpftes Rechnungskonto,
Firebase wechselt damit von Spark auf Blaze und verliert seinen
Nulltarif-Schutz. Kein Muss.

### 5.6 Offen zur Entscheidung: automatischer Not-Aus

Da 5.2 nicht existiert, wäre die einzige harte Bremse selbstgebaut:
Budget-Alert → Pub/Sub → Cloud Function, die die Abrechnung des Projekts
`weltenraten` trennt. Firestore liegt in einem anderen Projekt und bliebe
unberührt. Alternative ohne Cloud Function: ein GitHub-Actions-Workflow mit
Zeitplan, der die Nutzungsmetrik abfragt und im Ernstfall die erlaubten
Referrer des Keys auf einen unmöglichen Wert setzt – reversibel, ohne
Eingriff in die Abrechnung, aber mit der Verzögerung, die Actions-Zeitpläne
nun einmal haben.

Bei null möglichem Geldverlust (Abschnitt 4) ist beides Komfort, nicht
Schutz.

---

## 6. Deployment-Regeln

**Asset-Versionierung nicht vergessen.** GitHub Pages setzt
`cache-control: max-age=600`. Ohne Versionsstempel mischen Browser altes
JavaScript mit neuem HTML – das hat schon zu einer komplett leeren Seite
geführt.

Bei **jeder** Änderung an `script.js`, `style.css`, `locations.json` oder
`country-centroids.json` die Versionsnummer hochzählen:

```bash
sed -i 's/?v=8/?v=9/g' index.html script.js
```

Die Nummer steht in `index.html` (script-/link-Tags) und in `script.js`
(die beiden `fetch`-Aufrufe). Aktueller Stand: **v=8**.

Vor jedem Push prüfen:

```bash
node -c script.js
python3 -c "import json; json.load(open('locations.json'))"
```

Syntaxprüfung allein reicht nicht – ein Fehler wie "Variable vor der
Deklaration verwendet" fällt erst beim Laden auf. Im Zweifel headless mit
jsdom testen.

---

## 7. Firestore-Regeln (aktueller Stand)

Bei Schemaänderungen müssen diese Regeln in der Firebase-Konsole
mitgezogen werden, sonst werden Schreibvorgänge abgelehnt.

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
                    && request.resource.data.createdBy.size() <= 30
                    && request.resource.data.rounds is list
                    && request.resource.data.rounds.size() == 10;
      allow update, delete: if false;

      match /players/{playerId} {
        allow read: if true;
        allow create: if request.resource.data.keys().hasOnly(['name', 'score', 'ts'])
                      && request.resource.data.name is string
                      && request.resource.data.name.size() > 0
                      && request.resource.data.name.size() <= 30
                      && request.resource.data.score is int
                      && request.resource.data.score >= 0
                      && request.resource.data.score <= 50000;
        allow update, delete: if false;
      }
    }
    match /players/{nameKey} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasOnly(['displayName', 'createdAt'])
                    && request.resource.data.displayName is string
                    && request.resource.data.displayName.size() > 0
                    && request.resource.data.displayName.size() <= 30;
      allow update, delete: if false;
    }
    match /flags/{flagId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasOnly(['locationId', 'country', 'place', 'reason', 'ts'])
                    && request.resource.data.locationId is string
                    && request.resource.data.reason in ['too_easy', 'impossible'];
      allow update, delete: if false;
    }
    match /resolved/{locationId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasOnly(['ts']);
      allow update, delete: if false;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Grundprinzip: nur `create`, niemals `update` oder `delete`. Da
Firestore-Regeln den **Inhalt einer Liste** nicht prüfen können, wird das
`rounds`-Array zusätzlich clientseitig in `sanitizeRound()` validiert.

---

## 8. Sicherheit

Abgesichert:

- **XSS:** Alle Daten aus Firestore und aus Nutzereingaben werden beim
  Rendern escaped (`escapeHtml()`), Zahlen zusätzlich per `Number()`
  erzwungen. Runden-Daten aus `games/{code}.rounds` durchlaufen
  `sanitizeRound()`: Koordinaten müssen gültige Zahlen im Bereich ±90/±180
  sein, Land und Ort müssen in den eigenen Datensätzen existieren.
  Ungültige Einträge werden deterministisch ersetzt statt angezeigt.
- **Spielcodes aus der URL** werden gegen `^[A-Z0-9]{4,12}$` geprüft, bevor
  sie irgendwo verwendet werden.
- **Firestore-Regeln:** nur `create`, alles ausserhalb der definierten Pfade
  gesperrt.
- **Google-Maps-Key:** per HTTP-Referrer auf die GitHub-Pages-Domain und auf
  zwei APIs beschränkt. Der Firebase-`apiKey` ist bei Web-Apps bewusst
  öffentlich – die Absicherung erfolgt über die Firestore-Regeln, nicht über
  Geheimhaltung. Firestore wertet Referrer-Beschränkungen ohnehin nicht aus;
  gemessen am 3.9.2026 liefert eine Firestore-REST-Abfrage mit fremdem
  Referrer dieselben Daten wie eine mit dem erlaubten.

Bewusst offen (Abwägung Aufwand vs. Risiko für ein privates Projekt):

- **Punkte sind selbst gemeldet.** Wer die Browser-Konsole bedienen kann,
  schreibt sich bis zu 50'000 Punkte in die Rangliste. Ohne serverseitige
  Rundenauswertung nicht zu verhindern.
- **Die Einmal-Sperre pro Spiel liegt im `localStorage`** und lässt sich
  durch Löschen der Browserdaten umgehen. Sie prüft zwar gegen Firestore,
  hängt aber am frei wählbaren Namen.
- **`?admin=flags` hat keinen Login.** Wer die URL kennt, sieht die
  Meldungen und kann sie als erledigt markieren. Kein Datenleck – es stehen
  nur Ortsnamen drin –, aber jemand könnte Meldungen ausblenden.
- **Kein App Check / Rate Limiting.** Spiele, Meldungen und
  Ranglisteneinträge lassen sich massenhaft anlegen. Kostenrisiko null
  (Spark-Tarif ohne Zahlungsmittel – bei Kontingentende wird abgelehnt,
  nicht abgerechnet), aber die Übersichtsseite liesse sich zumüllen.
  Gegenmittel wäre Firebase App Check mit reCAPTCHA.

---

## 9. Fallstricke

**Multiplayer-Runden sind eingefroren.** Beim Erstellen eines Spiels wird
der komplette Standort-Datensatz inklusive Koordinaten unter `rounds` in
Firestore gespeichert. Änderungen an `locations.json` wirken deshalb nur auf
**neu erstellte** Spiele. Das ist Absicht: Sonst sähen zwei Spieler
desselben offenen Spiels unterschiedliche Panoramen, falls dazwischen ein
gemeldetes Bild korrigiert wurde. Diese Logik nicht auf ID-Referenzen
zurückbauen (`resolveRoundLocations()` in `script.js`). Nur falls eine `id`
komplett wegfallen muss, greift für alte Spiele ein deterministischer
Ersatz-Ort als Fallback.

**Escaping.** `escapeHtml()` escaped bewusst auch Anführungszeichen, weil
die Funktion teils in HTML-Attributen verwendet wird. Nicht durch eine
`textContent`/`innerHTML`-Variante ersetzen, die Quotes stehen lässt.

**Keine Street-View-Bilder herunterladen und speichern.** Verstösst gegen
die Maps-Platform-Nutzungsbedingungen und riskiert die Sperrung des Kontos.
Legitime Alternative wäre Mapillary.

**Zentroide sind Näherungswerte.** Die 58 Einträge in
`country-centroids.json` sind grob geschätzt; für faireres Scoring lohnt
sich ein Ersatz durch einen geprüften offenen Datensatz.

---

## 10. Meldungen abarbeiten

Spieler können ein Panorama als "zu einfach" oder "unmöglich" melden.
Meldungen landen in der Sammlung `flags` mit Orts-ID, Land/Ort und Grund.

1. https://michel86ch-ui.github.io/weltraten/?admin=flags öffnen
   (nicht verlinkt, kein Login)
2. Offene Meldungen stehen oben, meistgemeldete zuerst, erledigte
   ausgegraut darunter
3. Koordinaten des betroffenen Eintrags in `locations.json` anpassen –
   **`id` unverändert lassen**
4. Asset-Version hochzählen, committen, pushen
5. Auf der Admin-Seite "Erledigt" antippen – das legt einen Eintrag in
   `resolved` an. Die rohen `flags`-Einträge bleiben erhalten, sie werden
   nur ausgeblendet.
