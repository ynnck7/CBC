# Kronland

Ein Wirtschafts- und Aufbau-Strategiespiel für den Browser. Jede Partie spielt auf einer zufällig erzeugten Karte im Stil einer alten Pergamentkarte. Du gründest eine Stadt in einer Provinz deiner Wahl, baust sie Gebäude für Gebäude auf und handelst mit bis zu 19 KI-Städten, die sich parallel entwickeln.

Läuft als einzelner Docker-Container (Node.js, keine weiteren Abhängigkeiten). Jeder Benutzer hat ein eigenes Konto mit **5 Speicherslots** (fortsetzen, neu beginnen, löschen).

## Inhalt

- **Karte:** zufällig per Seed, 5–20 Städte (Kartengröße wächst mit), Kartentypen Küstenland, Halbinsel, Insel, Buchten & Inseln. Biome Flachland, Wald, Hochland, Sumpf, Wüste, dazu unbewohnbares Gebirge mit Bergpässen, Küsten und bis zu zwei Flüsse, die sich nie schneiden. Außerhalb der Karte liegt Entfernungsnebel.
- **Provinzen:** unregelmäßige Formen mit eigenen Werten (Bäume, Fruchtbarkeit, Lagerstätten, Boni). Mischprovinzen erhalten die Boni beider Biome je zur Hälfte. Provinzen lassen sich umbenennen; die Stadt wächst nur in angrenzende Provinzen.
- **Städtebau:** Gebäude frei platzieren (Ostriv-artig), Bauzeit mit Bau-Animation und Timer, Straßen optional (Produktions-, Prestige- und Reinheitsbonus, schnellere Händler), sonst entstehen Trampelpfade. Bis zu 100 Gebäude pro Stadt.
- **Bevölkerung:** keine Geburten. Einwohner ziehen zu, wenn es Wohnraum, Arbeit und Zufriedenheit gibt. Vier Wohnstufen (Einfamilienhaus bis Patrizierhaus) mit eigenen Bedürfnissen. Fehlende Arbeiter senken die Produktion anteilig.
- **Wirtschaft:** über 30 Waren, Produktionsketten (z. B. Getreide → Mehl → Brot, Erz + Kohle → Eisen → Werkzeug), Standortfaktor nach Umgebung, Manufakturen mit Qualitätsstufen (einfach, gut, edel).
- **Markt & Handel:** Preise je Stadt nach Angebot und Nachfrage. Händler zu Fuß, Karren (mehr Ladung, bis 3 Waren) und Boote über Flüsse und Meer (Hafen nötig, auch Fernhandel mit Städten außerhalb der Karte). Automatischer Handel über Kauf- und Verkaufsgrenzen sowie feste Handelsrouten.
- **Forschung:** 5 Zeitalter (Siedlungszeit bis Frühe Industrie), Wissen aus Kapelle, Schule, Bibliothek, Universität.
- **KI-Städte:** gründen sich zeitversetzt an guten Standorten, bauen, forschen, expandieren und handeln selbst.
- **Diplomatie:** Beziehungen, Zölle, Handelsabkommen, Geschenke.
- **Endlosspiel:** Im Jahr 1500 gibt es eine Bilanz mit Rangliste, danach geht es weiter.

## Installation mit Portainer (Stack aus Git-Repository)

1. In Portainer **Stacks → Add stack → Repository** wählen.
2. Repository-URL dieses Repos eintragen (bei privatem Repo mit Zugangsdaten bzw. Token), Referenz `refs/heads/main`, Compose-Pfad `docker-compose.yml`.
3. Unter **Environment variables** bei Bedarf die Werte aus der Tabelle unten überschreiben.
4. **Deploy the stack.** Portainer baut das Image direkt aus dem Repo. Der Container lauscht auf Port `8080`.

Ohne Portainer genügt:

```bash
docker compose up -d --build
```

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `8080` | Port im Container |
| `DATA_DIR` | `/data` | Speicherort für Konten und Spielstände (Volume) |
| `ALLOW_REGISTRATION` | `true` | Neue Konten erlauben. Nach dem Anlegen der eigenen Konten auf `false` setzen. |
| `SECURE_COOKIE` | `false` | Auf `true` setzen, sobald das Spiel nur noch per HTTPS erreichbar ist |
| `SESSION_DAYS` | `30` | Gültigkeit einer Anmeldung in Tagen |

Alle Daten liegen im Volume `kronland-data` (`/data`): `users.json`, `sessions.json` und `saves/<benutzer>/slotN.json.gz`. Für ein Backup genügt eine Kopie dieses Volumes.

## nginx als Reverse Proxy

Beispiel für `spiel.example.de` mit vorhandenem Zertifikat:

```nginx
server {
    listen 443 ssl http2;
    server_name spiel.example.de;

    ssl_certificate     /etc/nginx/ssl/spiel.example.de/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/spiel.example.de/privkey.pem;

    # Spielstände können ein paar hundert KB groß sein
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name spiel.example.de;
    return 301 https://$host$request_uri;
}
```

Läuft nginx selbst als Container im selben Docker-Netzwerk, statt `127.0.0.1:8080` den Containernamen verwenden (`http://kronland:8080`) und den Port-Eintrag in der Compose-Datei weglassen. Bei HTTPS anschließend `SECURE_COOKIE=true` setzen.

## Steuerung

| Aktion | Eingabe |
|---|---|
| Karte bewegen | Ziehen mit der Maus, WASD oder Pfeiltasten, Klick auf die Minikarte |
| Zoomen | Mausrad, `+` / `-` |
| Pause / Tempo | Leertaste / `1`–`5` |
| Werkzeug abbrechen | Rechtsklick oder `Esc` |
| Straße / Abriss | `R` / `X` |
| Fenster | `C` Stadt, `M` Lager & Markt, `T` Handel, `F` Forschung |
| Forschung einreihen | Umschalt + Klick |

Kartenansichten (unten links): Gelände, Politisch, Lagerstätten.

## Erste Schritte im Spiel

1. Provinz wählen: Beim Überfahren zeigt jede Provinz Landschaft, Bäume, Fruchtbarkeit, Lagerstätten und Boni. Die Zeit läuft erst nach der Gründung.
2. Holzfäller nah am Wald und eine Sammler- oder Fischerhütte bauen, dann Einfamilienhäuser.
3. Forschung wählen (`F`), z. B. Ackerbau und Handwerk.
4. Marktplatz bauen, um mit den Nachbarn zu handeln. Unter **Lager & Markt** Grenzen für automatischen Kauf und Verkauf setzen.
5. Mit wachsender Einwohnerzahl weitere Provinzen beanspruchen (Wege-Menü → Provinz).

## Entwicklung

```bash
npm run dev     # startet den Server auf Port 8080 mit Daten in ./data
```

Der Code ist reines JavaScript ohne Build-Schritt:

| Datei | Inhalt |
|---|---|
| `server/server.js` | HTTP-Server, Konten, Speicherslots |
| `public/js/data.js` | Biome, Waren, Gebäude, Forschung (hier lässt sich das Balancing anpassen) |
| `public/js/mapgen.js` | Kartengenerator |
| `public/js/sim.js` | Simulation: Wirtschaft, Markt, Handel, Bevölkerung |
| `public/js/ai.js` | KI-Städte |
| `public/js/path.js` | Wegfindung für Händler |
| `public/js/render.js` | Kartengrafik |
| `public/js/ui.js`, `main.js` | Oberfläche |

Die Simulation läuft im Browser. Der Server speichert nur Konten und Spielstände; die Karte wird beim Laden aus dem Seed neu erzeugt.
