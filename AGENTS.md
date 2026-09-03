# Agent-Briefing: Weltraten

Kontext für einen Coding-Agenten (VS Code o. ä.). Ziel dieses Dokuments:
die Google-Cloud-Konfiguration vom PC aus abschliessen, ohne dass jemand
sich erst durch den Chatverlauf arbeiten muss.

---

## 1. Was das Projekt ist

Statisches Browserspiel im Stil von GeoGuessr. Der Spieler bekommt ein
Street-View-Panorama und rät das Land – bei Schweizer Standorten den
konkreten Ort. Kein Build-Step, kein Framework, kein Server.

- **Hosting:** GitHub Pages, Repo `michel86ch-ui/weltraten`, Branch `main`
- **Live:** https://michel86ch-ui.github.io/weltraten/
- **Panoramen:** Google Maps JavaScript API (`StreetViewPanorama`)
- **Datenbank:** Firebase Firestore (Ranglisten, Spiele, Meldungen, Profile)

Dateien:

| Datei | Zweck |
|---|---|
| `index.html` | alle Screens als `<section class="screen">` |
| `script.js` | gesamte Spiellogik |
| `style.css` | Styling |
| `locations.json` | 248 Standorte (`id`, `lat`, `lng`, `country`, optional `place`) |
| `country-centroids.json` | Länder-Zentroide fürs Distanz-Scoring |
| `config.js` | Google-Maps-API-Key |
| `firebase-config.js` | Firebase-Konfiguration |

Ausführliche Funktionsbeschreibung steht im `README.md`.

---

## 2. Cloud-Landschaft (Stand 3. September 2026)

Es gibt **drei** Google-Cloud-Projekte. Das ist historisch gewachsen und
soll aufgeräumt werden.

| Projekt | Rolle | Aktion |
|---|---|---|
| `weltenraten` | Maps JavaScript API + API-Key (endet auf `…LsW0Pg`) | behalten |
| `weltquiz-ebfcd` | Firebase/Firestore – **alle Spieldaten** | behalten, niemals löschen |
| `weltquiz` | vermutlich leer, Namensrest | prüfen, dann löschen |

Abrechnung: Google-Cloud-Testguthaben (300 USD / 241 CHF, 90 Tage ab
Anfang September 2026). Firebase läuft auf dem Spark-Tarif ohne
Zahlungsmittel und kann daher keine Kosten verursachen.

Verbrauch bisher: rund 30 Panorama-Ladungen. Gratis-Kontingent für
Dynamic Street View sind 5'000 Events pro Monat, danach 14 USD pro 1'000.

---

## 3. Offene Aufgaben

### 3.1 API-Key einschränken (Priorität hoch)

Der Key steht im öffentlichen Repo in `config.js`. Ohne Einschränkung
kann ihn jeder in eine eigene Seite einbauen und auf fremde Rechnung
Panoramen laden. Zwei Einschränkungen sind nötig:

1. **Anwendungseinschränkung:** HTTP-Referrer `https://michel86ch-ui.github.io/*`
2. **API-Einschränkung:** nur **Maps JavaScript API**

**Weg über die Konsole:**
Cloud Console → Projekt `weltenraten` → APIs und Dienste → Anmeldedaten →
Key öffnen → beide Abschnitte setzen → Speichern.

**Weg über gcloud** (Syntax vor dem Ausführen verifizieren, die
`api-keys`-Befehle sind noch relativ neu):

```bash
gcloud config set project weltenraten
gcloud services api-keys list
# KEY_ID aus der Ausgabe übernehmen:
gcloud services api-keys update KEY_ID \
  --allowed-referrers="https://michel86ch-ui.github.io/*" \
  --api-target=service=maps-backend.googleapis.com
```

`maps-backend.googleapis.com` ist der Dienstname der Maps JavaScript API.

### 3.2 Hartes Tageslimit setzen (Priorität hoch)

Ein Budget-Alert schickt nur eine E-Mail, während die Kosten weiterlaufen.
Ein Kontingent stoppt tatsächlich.

Cloud Console → APIs und Dienste → Maps JavaScript API → **Kontingente** →
Tageslimit setzen. Für einen Freundeskreis reichen 200–500 Anfragen/Tag
bequem.

### 3.3 Budget-Alert (Priorität mittel)

Abrechnung → Budgets und Benachrichtigungen → Budget über z. B. 10 CHF mit
E-Mail-Benachrichtigung.

### 3.4 Projekt `weltquiz` aufräumen (Priorität niedrig)

Erst prüfen, dass wirklich nichts drin ist:

```bash
gcloud services list --enabled --project=weltquiz
```

Wenn leer bzw. nur Standarddienste: löschen. **Vorher sicherstellen, dass
es nicht `weltquiz-ebfcd` ist** – dort liegen alle Spieldaten.

### 3.5 Optional: Maps-Key ins Firebase-Projekt umziehen

Damit alles in einem Projekt liegt. Aufwand: im Projekt `weltquiz-ebfcd`
die Maps JavaScript API aktivieren, neuen Key anlegen, Referrer- und
API-Einschränkung setzen, Key in `config.js` eintragen, Asset-Version
hochzählen, pushen, testen, alten Key löschen. Kein Muss.

---

## 4. Deployment-Regeln

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

Syntaxprüfung allein reicht nicht – ein Fehler wie „Variable vor der
Deklaration verwendet" fällt erst beim Laden auf. Im Zweifel headless mit
jsdom testen.

---

## 5. Firestore-Regeln (aktueller Stand)

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

## 6. Fallstricke

**Multiplayer-Runden sind eingefroren.** Beim Erstellen eines Spiels wird
der komplette Standort-Datensatz inklusive Koordinaten unter `rounds` in
Firestore gespeichert. Änderungen an `locations.json` wirken deshalb nur
auf **neu erstellte** Spiele. Das ist Absicht: sonst sähen zwei Spieler
desselben Spiels unterschiedliche Panoramen. Diese Logik nicht auf
ID-Referenzen zurückbauen.

**Escaping.** `escapeHtml()` escaped bewusst auch Anführungszeichen, weil
die Funktion teils in HTML-Attributen verwendet wird. Nicht durch eine
`textContent`/`innerHTML`-Variante ersetzen, die Quotes stehen lässt.

**Keine Street-View-Bilder herunterladen und speichern.** Verstösst gegen
die Maps-Platform-Nutzungsbedingungen und riskiert die Sperrung des
Kontos. Legitime Alternative wäre Mapillary.

**Punkte sind selbst gemeldet.** Wer die Browser-Konsole bedienen kann,
schreibt beliebige Werte in die Rangliste. Ohne serverseitige Auswertung
nicht zu verhindern und für den privaten Rahmen bewusst akzeptiert.
Dasselbe gilt für die Einmal-Sperre pro Spiel: Sie prüft gegen Firestore,
hängt aber am frei wählbaren Namen.

---

## 7. Meldungen abarbeiten

Spieler können ein Panorama als „zu einfach" oder „unmöglich" melden.

1. https://michel86ch-ui.github.io/weltraten/?admin=flags öffnen
   (nicht verlinkt, kein Login)
2. Offene Meldungen stehen oben, erledigte ausgegraut darunter
3. Koordinaten des betroffenen Eintrags in `locations.json` anpassen –
   **`id` unverändert lassen**
4. Asset-Version hochzählen, committen, pushen
5. Auf der Admin-Seite „Erledigt" antippen
