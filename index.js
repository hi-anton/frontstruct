#!/usr/bin/env node
/**
 * frontstruct – legt Frontend-Projekte mit Basis-Struktur an.
 *
 * Nutzung:
 *   frontstruct                  Dialog starten
 *   frontstruct my-project       Dialog ohne Namensfrage
 *   frontstruct my-project -y    Ohne Dialog, mit Standardwerten
 *
 * Ablauf im Überblick:
 *   1. Kommandozeilen-Argumente auswerten (--help, --version, -y, Projektname)
 *   2. Dialog: Der Nutzer wählt Vorlage, Sprache und Extras
 *   3. Dateien aus dem Ordner template/ ins neue Projekt kopieren
 *   4. main.css und main.js passend zur Auswahl erzeugen
 *   5. Platzhalter wie {{name}} in allen Dateien ersetzen
 *   6. Optional: Git-Repository anlegen
 */

// Eingebaute Node-Module (müssen nicht installiert werden)
import fs from "node:fs"; // Dateien lesen, schreiben, kopieren
import path from "node:path"; // Pfade plattformunabhängig zusammensetzen
import { spawnSync } from "node:child_process"; // Andere Programme starten (hier: git)
import { fileURLToPath } from "node:url"; // Wandelt "file://..."-URLs in normale Pfade um

// Externe Bibliothek für die Terminal-Dialoge (Auswahllisten, Spinner usw.)
// "p" ist nur eine Kurzform, damit man z. B. p.select() statt prompts.select() schreibt.
import * as p from "@clack/prompts";

// ═════════════════════════════ 1. Grundlagen ═════════════════════════════

// Ordner, in dem DIESE Datei liegt (also das installierte frontstruct-Paket).
// In ES-Modulen gibt es kein __dirname, daher der Umweg über import.meta.url.
// Wichtig: Das ist NICHT der Ordner, in dem der Nutzer den Befehl ausführt.
const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));

// Ordner mit allen Vorlagen-Dateien, die ins neue Projekt kopiert werden
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, "template");

// Eigene package.json einlesen, um die Versionsnummer anzeigen zu können
const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));

// fs.cpSync (rekursives Kopieren) gibt es erst ab Node 16.7, sicherheitshalber 18 verlangen.
// process.versions.node ist z. B. "22.4.1" → wir brauchen nur die erste Zahl.
const [nodeMajorVersion] = process.versions.node.split(".").map(Number);
if (nodeMajorVersion < 18) {
  console.error(`frontstruct requires Node.js 18 or newer (installed: ${process.versions.node}).`);
  process.exit(1); // Exit-Code 1 = Fehler
}

const HELP_TEXT = `
frontstruct v${packageJson.version}

Usage:
  frontstruct [project-name] [options]

Options:
  -y, --yes       Skip all questions and use defaults
  -h, --help      Show this help
  -v, --version   Show version
`;

// process.argv enthält alle Teile des Aufrufs, z. B. bei "frontstruct demo -y":
//   [ "/pfad/zu/node", "/pfad/zu/index.js", "demo", "-y" ]
// Die ersten beiden sind immer Node und das Skript selbst → wegschneiden.
const cliArgs = process.argv.slice(2);

// Alles mit "-" vorne ist ein Schalter (Flag), z. B. "-y" oder "--help".
// Ein Set erlaubt schnelles Nachschauen mit .has().
const cliFlags = new Set(cliArgs.filter((arg) => arg.startsWith("-")));

// Das erste Argument OHNE "-" ist der Projektname (oder undefined, wenn keiner angegeben wurde)
const projectNameArg = cliArgs.find((arg) => !arg.startsWith("-"));

if (cliFlags.has("-h") || cliFlags.has("--help")) {
  console.log(HELP_TEXT);
  process.exit(0); // Exit-Code 0 = alles in Ordnung
}
if (cliFlags.has("-v") || cliFlags.has("--version")) {
  console.log(packageJson.version);
  process.exit(0);
}

// Dialog überspringen, wenn -y gesetzt ist ODER kein interaktives Terminal vorhanden ist.
// process.stdin.isTTY ist false, wenn das Skript z. B. aus einem anderen Skript oder
// einer CI-Pipeline gestartet wird – dort könnte niemand die Fragen beantworten.
const useDefaults = cliFlags.has("-y") || cliFlags.has("--yes") || !process.stdin.isTTY;

// ═════════════════════════════ 2. Optionen ═════════════════════════════
// Jede Option hat:
//   value → interner Name; entspricht dem Ordner template/extras/<value>/
//   label → Text, der im Dialog angezeigt wird
//   hint  → (optional) graue Zusatzinfo hinter dem Label
// Wird eine Option gewählt, wird der Inhalt von template/extras/<value>/ 1:1
// ins Projekt kopiert. Beispiel: extras/reset/styles/reset.css → <projekt>/styles/reset.css

// Seitenvorlagen: Inhalt kommt aus template/layouts/<value>.html und wird in {{content}} eingesetzt
const LAYOUT_OPTIONS = [
  { value: "blank", label: "Blank page" },
  { value: "landing", label: "Landing page", hint: "Hero, features, call to action" },
  { value: "portfolio", label: "Portfolio", hint: "Intro, projects, contact" },
];

const CSS_OPTIONS = [
  { value: "reset", label: "CSS reset", hint: "recommended" },
  { value: "layout", label: "Layout primitives", hint: ".stack, .cluster, .grid-auto …" },
  { value: "components", label: "Components", hint: "Buttons, cards, forms" },
  { value: "darkmode", label: "Dark mode variables" },
  { value: "animations", label: "Animations", hint: "Fade in, slide up" },
  { value: "print", label: "Print styles" },
];

// "requires" listet CSS-Optionen, ohne die das JS-Modul nicht funktioniert.
// Diese werden später automatisch mit ausgewählt (siehe Abschnitt "Abhängigkeiten").
const JS_OPTIONS = [
  { value: "theme-toggle", label: "Theme toggle", hint: "needs dark mode", requires: ["darkmode"] },
  { value: "mobile-nav", label: "Mobile navigation", hint: "Burger menu" },
  { value: "scroll-animations", label: "Scroll animations", hint: "needs animations", requires: ["animations"] },
  { value: "utils", label: "Helper functions", hint: "$, $$, debounce, throttle, fetch" },
  { value: "form-validation", label: "Form validation" },
];

const PAGE_OPTIONS = [
  { value: "legal", label: "Legal notice & privacy policy", hint: "Impressum & Datenschutz" },
  { value: "404", label: "404 page" },
  { value: "robots", label: "robots.txt" },
];

const LANGUAGE_OPTIONS = [
  { value: "de", label: "German" },
  { value: "en", label: "English" },
];

// Standardwerte: Werden bei -y direkt verwendet und sind im Dialog vorausgewählt
const DEFAULTS = {
  layout: "blank",
  lang: "de",
  css: ["reset", "layout", "darkmode"],
  js: ["theme-toggle", "mobile-nav"],
  pages: ["404"],
  git: true,
};

// ─── CSS-Reihenfolge ───
// Alle CSS-Dateien werden über eine einzige styles/main.css eingebunden.
// Jede Datei kommt dabei in einen "Cascade Layer" (@layer). Der Vorteil:
// Regeln aus späteren Layern gewinnen IMMER gegen frühere – egal wie spezifisch
// die Selektoren sind. Eine Utility-Klasse wie .mt-2 schlägt so z. B. immer
// die Komponenten-Styles, ohne dass man !important braucht.
const CSS_LAYER_ORDER = "reset, base, layout, components, utilities"; // von schwach nach stark

// [Dateiname ohne .css, Layer] – in dieser Reihenfolge landen die Imports in main.css.
// Nur Dateien, die im Projekt tatsächlich existieren, werden importiert.
const CSS_FILES = [
  ["reset", "reset"],
  ["variables", "base"],
  ["darkmode", "base"],
  ["global", "base"],
  ["layout", "layout"],
  ["components", "components"],
  ["nav", "components"], // kommt mit der Option "mobile-nav"
  ["animations", "components"],
  ["utilities", "utilities"],
];

// ─── JS-Module ───
// Welche Datei unter scripts/modules/ zu welcher Option gehört und welche Funktion
// sie exportiert. main.js importiert diese Funktion und ruft sie einmal auf.
// Beispiel für "mobile-nav" ergibt in main.js:
//   import { initMobileNav } from "./modules/mobile-nav.js";
//   initMobileNav();
const JS_MODULES = {
  "theme-toggle": { file: "theme-toggle.js", init: "initThemeToggle" },
  "mobile-nav": { file: "mobile-nav.js", init: "initMobileNav" },
  "scroll-animations": { file: "scroll-animations.js", init: "initScrollAnimations" },
  "form-validation": { file: "form-validation.js", init: "initFormValidation" },
  utils: { file: "utils.js" }, // reine Helfer ohne init-Funktion → wird nicht automatisch importiert
};

// npm löscht Dateien wie ".gitignore" beim Veröffentlichen eines Pakets.
// Deshalb liegen sie im Template OHNE Punkt ("gitignore") und werden nach dem
// Kopieren umbenannt. Hier stehen alle Dateien, bei denen das passieren soll.
const DOTFILES = ["gitignore"];

// Nur in diesen Dateitypen werden Platzhalter ersetzt.
// Bilder o. Ä. würden durch Lesen/Schreiben als Text kaputtgehen.
const TEXT_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".md", ".txt", ".svg", ".webmanifest"]);

// Texte, die in die erzeugte Webseite geschrieben werden – abhängig von der
// gewählten Seitensprache (nicht zu verwechseln mit der Sprache des Dialogs).
const PAGE_TEXTS = {
  de: {
    themeToggle: "Farbschema wechseln",
    menuToggle: "Menü öffnen",
    legalNav: "Rechtliches",
    imprint: "Impressum",
    privacy: "Datenschutz",
  },
  en: {
    themeToggle: "Toggle color scheme",
    menuToggle: "Open menu",
    legalNav: "Legal",
    imprint: "Legal notice",
    privacy: "Privacy",
  },
};

// Findet Platzhalter wie {{name}} oder {{header_actions}}.
// \w+ = ein oder mehr Buchstaben/Ziffern/Unterstriche; die Klammern merken sich den
// Namen, damit wir ihn im Ersetzen-Callback als "key" bekommen. g = alle Treffer.
const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

// ═════════════════════════════ Hilfsfunktionen ═════════════════════════════

/**
 * Prüft, ob der Nutzer eine Frage mit Strg+C abgebrochen hat.
 * clack gibt in dem Fall kein normales Ergebnis, sondern ein spezielles
 * "Cancel"-Symbol zurück. Darum wird JEDE Antwort durch diese Funktion geschickt.
 */
function getAnswer(answer) {
  if (p.isCancel(answer)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return answer;
}

/**
 * Prüft einen Projektnamen.
 * Gibt einen Fehlertext zurück, wenn der Name ungültig ist, sonst undefined.
 * (clack zeigt bei p.text() den zurückgegebenen Text automatisch als Fehler an.)
 */
function validateProjectName(value) {
  const name = (value ?? "").trim();
  if (!name) return "Please enter a name.";

  // ^ … $ = der GANZE Name muss passen; erlaubt sind nur a–z, A–Z, 0–9, Punkt, Unterstrich, Bindestrich.
  // Das verhindert Leerzeichen und Zeichen wie "/" , die Probleme bei Ordnernamen machen.
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return "Only letters, numbers, dots, hyphens and underscores.";

  // path.resolve macht aus "demo" einen absoluten Pfad im aktuellen Ordner
  const targetDir = path.resolve(name);
  // Ein vorhandener, aber LEERER Ordner ist okay – ein gefüllter würde überschrieben werden
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    return `Folder "${name}" already exists and is not empty.`;
  }
  return undefined;
}

/**
 * Kopiert einen Ordner aus template/ (inklusive aller Unterordner) ins Projekt.
 * Gibt false zurück, wenn es den Ordner im Template (noch) nicht gibt.
 * So bricht das Skript nicht ab, wenn ein Baustein noch fehlt.
 */
function copyFromTemplate(templateSubpath, targetDir) {
  const sourceDir = path.join(TEMPLATE_DIR, templateSubpath);
  if (!fs.existsSync(sourceDir)) return false;
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  return true;
}

/**
 * Liefert nacheinander ALLE Dateipfade in einem Ordner und seinen Unterordnern.
 * Das "*" macht die Funktion zu einem Generator: Sie gibt mit "yield" einen Pfad
 * nach dem anderen heraus, statt erst eine riesige Liste zu bauen.
 * Nutzung: for (const file of walkFiles(dir)) { … }
 */
function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Diese Ordner können riesig sein und enthalten nie unsere Platzhalter
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      yield* walkFiles(fullPath); // Unterordner rekursiv durchlaufen
    } else {
      yield fullPath;
    }
  }
}

/** Benennt z. B. "gitignore" in ".gitignore" um (Grund: siehe DOTFILES oben). */
function renameDotfiles(projectDir) {
  for (const fileName of DOTFILES) {
    const from = path.join(projectDir, fileName);
    const to = path.join(projectDir, `.${fileName}`);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
  }
}

/**
 * Ersetzt in einem Text alle {{platzhalter}} durch die Werte aus "values".
 * Unbekannte Platzhalter bleiben unverändert stehen, statt einfach zu verschwinden –
 * so fällt ein Tippfehler im Template sofort auf.
 */
function replacePlaceholders(text, values) {
  return text.replace(PLACEHOLDER_PATTERN, (fullMatch, key) => (key in values ? values[key] : fullMatch));
}

/** Ersetzt Platzhalter in allen Textdateien des Projekts. */
function fillPlaceholders(projectDir, values) {
  for (const file of walkFiles(projectDir)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file))) continue;
    const original = fs.readFileSync(file, "utf8");
    const filled = replacePlaceholders(original, values);
    if (filled !== original) fs.writeFileSync(file, filled); // nur schreiben, wenn sich etwas geändert hat
  }
}

/**
 * Erzeugt styles/main.css, die alle vorhandenen CSS-Dateien in der richtigen
 * Reihenfolge und im richtigen Layer importiert. Ergebnis z. B.:
 *
 *   @layer reset, base, layout, components, utilities;
 *   @import url("reset.css") layer(reset);
 *   @import url("variables.css") layer(base);
 *   …
 *
 * In index.html muss dadurch nur noch EINE Datei verlinkt werden: styles/main.css
 */
function writeMainCss(projectDir) {
  const stylesDir = path.join(projectDir, "styles");
  fs.mkdirSync(stylesDir, { recursive: true });
  const cssFileExists = (name) => fs.existsSync(path.join(stylesDir, `${name}.css`));

  const lines = [
    "/* Generated by frontstruct. Later layers always win, regardless of specificity. */",
    `@layer ${CSS_LAYER_ORDER};`, // legt die Rangfolge der Layer fest, bevor irgendetwas importiert wird
    "",
  ];
  for (const [fileName, layer] of CSS_FILES) {
    if (cssFileExists(fileName)) lines.push(`@import url("${fileName}.css") layer(${layer});`);
  }
  // Print-Styles gelten nur beim Drucken – dafür sorgt das "print" am Ende der Zeile
  if (cssFileExists("print")) lines.push(`@import url("print.css") layer(utilities) print;`);

  fs.writeFileSync(path.join(stylesDir, "main.css"), lines.join("\n") + "\n");
}

/**
 * Erzeugt scripts/main.js, die alle gewählten JS-Module importiert und startet.
 * Ein Modul wird nur eingebunden, wenn seine Datei wirklich kopiert wurde –
 * ein Import einer fehlenden Datei würde das ganze Skript im Browser abbrechen.
 */
function writeMainJs(projectDir, selectedOptions) {
  const scriptsDir = path.join(projectDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });

  const importLines = []; // z. B. import { initMobileNav } from "./modules/mobile-nav.js";
  const initCalls = []; // z. B. initMobileNav();

  for (const [optionValue, module] of Object.entries(JS_MODULES)) {
    if (!selectedOptions.has(optionValue) || !module.init) continue;
    if (!fs.existsSync(path.join(scriptsDir, "modules", module.file))) continue;
    importLines.push(`import { ${module.init} } from "./modules/${module.file}";`);
    initCalls.push(`${module.init}();`);
  }

  const lines = [
    '// Entry point – loaded as type="module", so it runs after the HTML has been parsed.',
  ];
  if (selectedOptions.has("utils")) {
    lines.push('// Import helpers where needed: import { $, $$, debounce } from "./modules/utils.js";');
  }
  lines.push("");
  if (importLines.length) lines.push(...importLines, "", ...initCalls, "");

  fs.writeFileSync(path.join(scriptsDir, "main.js"), lines.join("\n"));
}

/**
 * Baut alle Werte für die Platzhalter in den HTML-Dateien zusammen.
 * Manche Platzhalter sind einfache Texte ({{name}}), andere enthalten ganze
 * HTML-Schnipsel, die nur eingefügt werden, wenn die passende Option gewählt wurde.
 */
function buildPlaceholderValues({ projectName, lang, layout, selectedOptions }) {
  // Texte in der gewählten Seitensprache; Deutsch als Rückfall
  const texts = PAGE_TEXTS[lang] ?? PAGE_TEXTS.de;

  // Inhalt der gewählten Seitenvorlage (z. B. template/layouts/landing.html)
  const layoutFile = path.join(TEMPLATE_DIR, "layouts", `${layout}.html`);
  const layoutContent = fs.existsSync(layoutFile) ? fs.readFileSync(layoutFile, "utf8").trim() : "";

  // Kleines Skript im <head>: Liest das gespeicherte Farbschema, BEVOR die Seite
  // gezeichnet wird. Ohne das würde die Seite beim Laden kurz hell aufblitzen,
  // obwohl der Nutzer Dark Mode gewählt hat. try/catch, weil localStorage in
  // manchen Situationen (z. B. privater Modus) einen Fehler werfen kann.
  const headScripts = selectedOptions.has("theme-toggle")
    ? `<script>
      try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
    </script>`
    : "";

  // Buttons im Header. Trick: "bedingung && text" ergibt entweder den Text oder false.
  // .filter(Boolean) entfernt danach alle false-Einträge, .join() fügt den Rest zusammen.
  const headerActions = [
    selectedOptions.has("theme-toggle") &&
      `<button class="theme-toggle" type="button" data-theme-toggle aria-label="${texts.themeToggle}">◐</button>`,
    // aria-controls verweist auf die Navigation mit id="site-nav", aria-expanded sagt
    // Screenreadern, ob das Menü gerade offen ist (wird vom JS umgeschaltet).
    selectedOptions.has("mobile-nav") &&
      `<button class="nav-toggle" type="button" aria-controls="site-nav" aria-expanded="false" aria-label="${texts.menuToggle}">
          <span class="nav-toggle__bar"></span>
        </button>`,
  ]
    .filter(Boolean)
    .join("\n        ");

  // Links zu Impressum und Datenschutz im Footer, nur wenn diese Seiten mitkopiert werden
  const footerLinks = selectedOptions.has("legal")
    ? `<nav aria-label="${texts.legalNav}"><a href="impressum.html">${texts.imprint}</a> · <a href="datenschutz.html">${texts.privacy}</a></nav>`
    : "";

  const values = {
    name: projectName,
    title: projectName,
    lang,
    year: String(new Date().getFullYear()),
    head_scripts: headScripts,
    header_actions: headerActions,
    footer_links: footerLinks,
  };

  // Die Layout-Vorlage kann selbst Platzhalter enthalten (z. B. <h1>{{name}}</h1>).
  // Weil {{content}} nur in EINEM Durchgang ersetzt wird, würden diese sonst
  // stehen bleiben – deshalb werden sie hier vorab ersetzt.
  values.content = replacePlaceholders(layoutContent, values);
  return values;
}

/**
 * Startet ein anderes Programm (z. B. git) im angegebenen Ordner und wartet, bis es fertig ist.
 * Gibt true zurück, wenn es erfolgreich war (Exit-Code 0).
 * stdio "ignore" = Ausgaben des Programms nicht im Terminal anzeigen.
 * shell nur unter Windows, weil Befehle dort sonst teilweise nicht gefunden werden.
 */
function runCommand(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "ignore", shell: process.platform === "win32" });
  return !result.error && result.status === 0;
}

// ═════════════════════════════ 3. Dialog ═════════════════════════════
// Hinweis: "await" funktioniert hier direkt auf oberster Ebene, weil die Datei
// ein ES-Modul ist ("type": "module" in der package.json).

p.intro(`frontstruct v${packageJson.version}`);

const DEFAULT_PROJECT_NAME = "my-project";

// Projektname: aus dem Aufruf übernehmen, Standardwert nehmen oder abfragen
let projectName = projectNameArg?.trim(); // ?. = nur trim() aufrufen, wenn nicht undefined

if (!projectName && useDefaults) {
  projectName = DEFAULT_PROJECT_NAME;
}

if (projectName) {
  // Name kam aus dem Aufruf oder ist der Standard → nur prüfen, nicht fragen
  const error = validateProjectName(projectName);
  if (error) {
    p.cancel(error);
    process.exit(1);
  }
} else {
  projectName = getAnswer(
    await p.text({
      message: "Project name?",
      placeholder: DEFAULT_PROJECT_NAME, // grauer Text im leeren Feld
      defaultValue: DEFAULT_PROJECT_NAME, // wird genommen, wenn man nur Enter drückt
      // Leere Eingabe wie den Standardnamen prüfen (sonst käme "Please enter a name")
      validate: (input) => validateProjectName(input || DEFAULT_PROJECT_NAME),
    })
  ).trim();
}

// Alle Antworten landen in diesem Objekt
let answers;

if (useDefaults) {
  answers = { ...DEFAULTS }; // Kopie der Standardwerte (... = alle Felder übernehmen)
  p.log.info("Using default settings.");
} else {
  // p.select = eine Option wählen, p.multiselect = mehrere (Leertaste), p.confirm = Ja/Nein
  answers = {
    layout: getAnswer(
      await p.select({ message: "Template?", options: LAYOUT_OPTIONS, initialValue: DEFAULTS.layout })
    ),

    lang: getAnswer(
      await p.select({ message: "Page language?", options: LANGUAGE_OPTIONS, initialValue: DEFAULTS.lang })
    ),

    css: getAnswer(
      await p.multiselect({
        message: "CSS extras? (Space: select, Enter: confirm)",
        options: CSS_OPTIONS,
        initialValues: DEFAULTS.css, // vorausgewählte Häkchen
        required: false, // auch "nichts auswählen" ist erlaubt
      })
    ),

    js: getAnswer(
      await p.multiselect({
        message: "JavaScript extras?",
        // "requires" ist nur für uns intern – vor der Übergabe an clack entfernen.
        // ({ requires, ...rest }) => rest  heißt: alles außer "requires" behalten.
        options: JS_OPTIONS.map(({ requires, ...option }) => option),
        initialValues: DEFAULTS.js,
        required: false,
      })
    ),

    pages: getAnswer(
      await p.multiselect({
        message: "Additional pages & files?",
        options: PAGE_OPTIONS,
        initialValues: DEFAULTS.pages,
        required: false,
      })
    ),

    git: getAnswer(await p.confirm({ message: "Initialize a Git repository?", initialValue: DEFAULTS.git })),
  };
}

// ─── Abhängigkeiten auflösen ───
// Alle gewählten Optionen in EIN Set packen. Ab hier ist egal, aus welcher
// Frage eine Option kam – z. B. selectedOptions.has("reset") oder .has("404").
const selectedOptions = new Set([...answers.css, ...answers.js, ...answers.pages]);

// Wenn ein JS-Modul eine CSS-Option braucht (siehe "requires"), diese automatisch
// ergänzen und den Nutzer darüber informieren.
for (const jsOption of JS_OPTIONS) {
  if (!selectedOptions.has(jsOption.value) || !jsOption.requires) continue;

  for (const requiredValue of jsOption.requires) {
    if (selectedOptions.has(requiredValue)) continue; // schon ausgewählt → nichts zu tun
    selectedOptions.add(requiredValue);
    const requiredLabel = CSS_OPTIONS.find((option) => option.value === requiredValue)?.label ?? requiredValue;
    p.log.info(`Added "${requiredLabel}" because "${jsOption.label}" needs it.`);
  }
}

// ═════════════════════════════ 4. Projekt erzeugen ═════════════════════════════

const projectDir = path.resolve(projectName); // absoluter Pfad des neuen Projektordners
const missingTemplateParts = []; // Optionen, für die es im Template noch keinen Ordner gibt

const spinner = p.spinner(); // drehendes Symbol, solange gearbeitet wird
spinner.start("Creating project");

try {
  // 1. Basis kopieren – ohne die geht nichts, deshalb hier ein echter Fehler
  if (!copyFromTemplate("base", projectDir)) {
    throw new Error(`Template not found: ${path.join(TEMPLATE_DIR, "base")}`);
  }

  // 2. Gewählte Extras kopieren; fehlende merken statt abzubrechen
  for (const optionValue of selectedOptions) {
    if (!copyFromTemplate(path.join("extras", optionValue), projectDir)) {
      missingTemplateParts.push(optionValue);
    }
  }

  // 3. Dateien erzeugen, die von der Auswahl abhängen
  //    (müssen NACH dem Kopieren laufen, weil sie prüfen, welche Dateien vorhanden sind)
  writeMainCss(projectDir);
  writeMainJs(projectDir, selectedOptions);

  // 4. "gitignore" → ".gitignore" usw.
  renameDotfiles(projectDir);

  // 5. Platzhalter wie {{name}} in allen Dateien ersetzen
  const placeholderValues = buildPlaceholderValues({
    projectName,
    lang: answers.lang,
    layout: answers.layout,
    selectedOptions,
  });
  fillPlaceholders(projectDir, placeholderValues);

  spinner.stop("Project created");
} catch (error) {
  // Irgendein Schritt ist fehlgeschlagen (z. B. fehlende Schreibrechte)
  spinner.stop("Failed to create project");
  p.cancel(error.message);
  process.exit(1);
}

if (missingTemplateParts.length) {
  p.log.warn(`These parts are not in the template yet and were skipped: ${missingTemplateParts.join(", ")}`);
}

// Git-Repository anlegen ("-q" = quiet, keine Ausgabe von git selbst)
if (answers.git) {
  if (runCommand("git", ["init", "-q"], projectDir)) {
    p.log.success("Git repository initialized");
  } else {
    p.log.warn("Could not initialize Git (is Git installed?).");
  }
}

// ═════════════════════════════ 5. Abschluss ═════════════════════════════

const nextSteps = [`cd ${projectName}`, "Open index.html in your browser or with Live Server"];
p.note(nextSteps.join("\n"), "Next steps"); // Kasten mit Überschrift
p.outro("Happy building!");