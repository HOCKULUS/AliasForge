# AliasForge für Firefox

## Temporär laden (zum Testen)

1. Firefox öffnen und `about:debugging` aufrufen.
2. Links auf „Dieser Firefox“ klicken.
3. Bei „Temporäres Add-on laden …“ die Datei `manifest.json` aus diesem Ordner auswählen.
4. Das Toolbar-Icon „AliasForge“ erscheint; ggf. über den Werkzeugkasten (Stift-Symbol) anpinnen.

Hinweis: Temporär geladene Erweiterungen werden beim Beenden von Firefox entfernt.

## Dauerhaft installieren

Dauerhafte Installationen benötigen eine signierte XPI:

```bash
# mit installiertem Node.js:
npx web-ext build --source-dir . --artifacts-dir ..
# dann bei addons.mozilla.org einreichen (self-distribution) und die signierte XPI installieren
```

## Berechtigungen

- **tabs / activeTab:** ermittelt die Adresse des aktiven Tabs.
- **Host-Zugriff:** für Inline-Button und Autofill den Website-Zugriff über die
  Erweiterungs-Einstellungen oder den Debug-Tab erlauben und die Website neu laden.
- **clipboardWrite:** erlaubt das Kopieren erzeugter Adressen.
- **storage:** speichert Einstellungen und Verlauf lokal. Browser Sync dient als
  optionale Sicherung und zur Wiederherstellung auf neuen Installationen.

## Unterschiede zur Safari-Version

- Lokale Speicherung funktioniert unabhängig vom Firefox-Sync-Konto.
- Kein nativer Clipboard-Fallback nötig; das Kopieren läuft über die Standard-Clipboard-API.
- Der Debug-Tab im Popup zeigt dieselben Diagnosen an.
