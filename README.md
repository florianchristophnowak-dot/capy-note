# Capy-note 🦫📝

**Korrektur leicht gemacht - Effiziente Bewertung gescannter Schülerarbeiten**

![Version](https://img.shields.io/badge/version-1.2.2-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)

<p align="center">
  <img src="public/mascot.png" alt="Capy-note Maskottchen" width="400">
</p>

---

## ✨ Features

### Kernfunktionen
- 📄 **PDF-Import**: Laden Sie gescannte Klassenarbeiten als PDF
- 👥 **Automatische Segmentierung**: Erkennt einzelne Schülerarbeiten automatisch
- 📋 **Aufgaben-Template**: Definieren Sie Aufgaben mit Punktzahlen und Ausschnitten
- ✏️ **Annotationswerkzeuge**: Stift, Textmarker, Stempel, Formen und mehr
- 🔴🟢 **Erst-/Zweitkorrektur**: Getrennte Ebenen für zwei Korrekturdurchgänge
- 📘 **Musterlösung**: Eigene Ebene (editierbar bei Schüler 1) als transparentes Overlay für alle Schüler

### Korrekturzeichen-System
- 📝 **Anpassbare Symbole**: Bis zu 12 Zeichen pro Symbol
- 🎨 **Farbcodierung**: Individuelle Farben für jeden Fehlertyp
- 📍 **Rand-Platzierung**: Links oder rechts wählbar
- 〰️ **Unterstreichungsstile**: Durchgezogen, gepunktet, wellig, gestrichelt, doppelt
- 📚 **Stapel-Anzeige**: Bei vielen Fehlern pro Zeile werden Symbole gestapelt

### Bewertung & Statistik
- ⚡ **Schnellbewertung**: Buttons für **0** und **volle Punktzahl** (andere Werte per Eingabe)
- ⌨️ **Tastenkürzel**: Ziffern 0-9 für direkte Punktevergabe
- 📊 **Statistik-Dashboard**: Durchschnitt, Median, Standardabweichung
- 📈 **Fehleranalyse**: Übersicht der häufigsten Fehlertypen

### Benutzerfreundlichkeit
- 🌓 **Dark/Light Mode**: Augenfreundlich für lange Korrektursitzungen
- ↩️ **Undo/Redo**: Unbegrenzte Rückgängig-Funktion
- 💾 **Auto-Speicherung**: Ihre Arbeit wird automatisch gesichert
- 🖥️ **Vollbildmodus**: Maximale Arbeitsfläche zum Annotieren
- 🦫 **Freundliches Design**: Mit unserem Capybara-Maskottchen

---

## 🔒 Datenschutz & Offline-Nutzung

- Capy-note ist als **lokale/offline** Anwendung konzipiert (keine Cloud, kein Login, kein Sync).
- Projektdaten werden lokal gespeichert und nur über **Exportdateien** weitergegeben.
- Die Schriftarten **Indie Flower** und **Gloria Hallelujah** werden **lokal** über `@fontsource/*` eingebunden (keine Google-Fonts-Requests).

## 🚀 Installation

### Fertige Downloads

Laden Sie die passende Version für Ihr Betriebssystem von der [Releases-Seite](../../releases) herunter:

| Betriebssystem | Datei |
|----------------|-------|
| Windows | `Capy-note-x.x.x-Windows-x64.exe` |
| Windows (Portable) | `Capy-note-x.x.x-Windows-x64.portable.exe` |
| macOS (Intel) | `Capy-note-x.x.x-macOS-x64.dmg` |
| macOS (Apple Silicon) | `Capy-note-x.x.x-macOS-arm64.dmg` |
| Linux | `Capy-note-x.x.x-Linux-x64.AppImage` |
| Linux (Debian/Ubuntu) | `Capy-note-x.x.x-Linux-x64.deb` |

### Aus dem Quellcode

```bash
# Repository klonen
git clone https://github.com/IhrUsername/capy-note.git
cd capy-note

# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npm run dev

# Oder mit Electron
npm run electron:dev
```

---

## 🛠️ Selbst bauen

### Voraussetzungen
- Node.js 20 oder höher
- npm 9 oder höher

### Lokal bauen

```bash
# Für Windows
npm run electron:build:win

# Für macOS
npm run electron:build:mac

# Für Linux
npm run electron:build:linux
```

> Hinweis: Builds sind pro Betriebssystem getrennt (Windows/macOS/Linux).

Die fertigen Installer finden Sie im `release/`-Ordner.

### Mit GitHub Actions

1. Forken Sie dieses Repository
2. Pushen Sie einen Tag:
   ```bash
   git tag v1.2.2
   git push origin v1.2.2
   ```
3. GitHub Actions baut automatisch für alle Plattformen
4. Downloads erscheinen unter **Releases**

---

## 📖 Benutzerhandbuch

### Workflow

1. **Projekt erstellen**
   - Klicken Sie auf "Neues Projekt"
   - Laden Sie das gescannte Klassen-PDF hoch
   - Die App segmentiert automatisch die einzelnen Arbeiten

2. **Segmentierung prüfen**
   - Überprüfen Sie die erkannten Schülerblöcke
   - Korrigieren Sie bei Bedarf: Seiten drehen, verschieben, zusammenfügen

3. **Aufgaben-Template erstellen**
   - Legen Sie Aufgaben mit Namen und maximaler Punktzahl an
   - Markieren Sie die relevanten Bereiche auf den Seiten

4. **Korrigieren**
   - Arbeiten Sie aufgabenweise durch alle Schüler
   - Nutzen Sie Korrekturzeichen für einheitliche Markierungen
   - Vergeben Sie Punkte per Schnelltasten oder Eingabe

5. **Review & Export**
   - Überprüfen Sie Ihre Bewertungen in der Review-Ansicht
   - Exportieren Sie als Sammel-PDF oder Einzel-PDFs

### Tastenkürzel

| Taste | Funktion |
|-------|----------|
| `0-9` | Punkte vergeben |
| `←` `→` | Vorheriger/Nächster Schüler |
| `Ctrl+Z` | Rückgängig |
| `Ctrl+Y` | Wiederholen |
| `Ctrl+S` | Speichern |
| `F11` | Vollbild |
| `Esc` | Vollbild beenden |

---

## 🦫 Warum "Capy-note"?

Capybaras sind bekannt für ihre ruhige, gelassene Art - genau das, was man beim Korrigieren von Klassenarbeiten braucht! Unser freundliches Capybara-Maskottchen begleitet Sie durch den Korrekturprozess und sorgt für gute Laune. 🦫✨

---

## 🤝 Beitragen

Beiträge sind willkommen! 

1. Forken Sie das Repository
2. Erstellen Sie einen Feature-Branch (`git checkout -b feature/NeuesFeature`)
3. Committen Sie Ihre Änderungen (`git commit -m 'Neues Feature hinzugefügt'`)
4. Pushen Sie den Branch (`git push origin feature/NeuesFeature`)
5. Öffnen Sie einen Pull Request

---

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert. Siehe [LICENSE](LICENSE) für Details.

---

## 🙏 Danksagungen

- [React](https://react.dev/) - UI Framework
- [Electron](https://www.electronjs.org/) - Desktop-Anwendung
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Lucide](https://lucide.dev/) - Icons
- [Vite](https://vite.dev/) - Build Tool

---

<p align="center">
  <b>Made with ❤️ und 🦫 für Lehrkräfte</b>
</p>
