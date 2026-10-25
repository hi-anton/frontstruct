#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, "template");
const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));

const [nodeMajorVersion] = process.versions.node.split(".").map(Number);
if (nodeMajorVersion < 18) {
  console.error(`frontstruct requires Node.js 18 or newer (installed: ${process.versions.node}).`);
  process.exit(1);
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

const cliArgs = process.argv.slice(2);
const cliFlags = new Set(cliArgs.filter((arg) => arg.startsWith("-")));
const projectNameArg = cliArgs.find((arg) => !arg.startsWith("-"));

if (cliFlags.has("-h") || cliFlags.has("--help")) {
  console.log(HELP_TEXT);
  process.exit(0);
}
if (cliFlags.has("-v") || cliFlags.has("--version")) {
  console.log(packageJson.version);
  process.exit(0);
}

const useDefaults = cliFlags.has("-y") || cliFlags.has("--yes") || !process.stdin.isTTY;

const CSS_OPTIONS = [
  { value: "reset", label: "CSS reset", hint: "recommended" },
  { value: "layout", label: "Layout primitives", hint: ".stack, .cluster, .grid-auto …" },
  { value: "components", label: "Components", hint: "Buttons, cards, forms" },
  { value: "darkmode", label: "Dark mode variables" },
  { value: "animations", label: "Animations", hint: "Fade in, slide up" },
];

const JS_OPTIONS = [
  { value: "theme-toggle", label: "Theme toggle", hint: "needs dark mode", requires: ["darkmode"] },
  { value: "mobile-nav", label: "Mobile navigation", hint: "Burger menu" },
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

const DEFAULTS = {
  lang: "en",
  css: ["reset", "layout", "darkmode"],
  js: ["theme-toggle", "mobile-nav"],
  pages: ["404"],
  git: true,
};

const CSS_LAYER_ORDER = "reset, base, layout, components, utilities";
const CSS_FILES = [
  ["reset", "reset"],
  ["variables", "base"],
  ["darkmode", "base"],
  ["global", "base"],
  ["layout", "layout"],
  ["components", "components"],
  ["nav", "components"],
  ["animations", "components"],
  ["utilities", "utilities"],
];

const JS_MODULES = {
  "theme-toggle": { file: "theme-toggle.js", init: "initThemeToggle" },
  "mobile-nav": { file: "mobile-nav.js", init: "initMobileNav" },
};

const DOTFILES = ["gitignore"];
const TEXT_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".md", ".txt", ".svg", ".webmanifest"]);

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

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

function getAnswer(answer) {
  if (p.isCancel(answer)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return answer;
}

function validateProjectName(value) {
  const name = (value ?? "").trim();
  if (!name) return "Please enter a name.";
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return "Only letters, numbers, dots, hyphens and underscores.";

  const targetDir = path.resolve(name);
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    return `Folder "${name}" already exists and is not empty.`;
  }
  return undefined;
}

function copyFromTemplate(templateSubpath, targetDir) {
  const sourceDir = path.join(TEMPLATE_DIR, templateSubpath);
  if (!fs.existsSync(sourceDir)) return false;
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  return true;
}

function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      yield* walkFiles(fullPath);
    } else {
      yield fullPath;
    }
  }
}

function renameDotfiles(projectDir) {
  for (const fileName of DOTFILES) {
    const from = path.join(projectDir, fileName);
    const to = path.join(projectDir, `.${fileName}`);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
  }
}

function replacePlaceholders(text, values) {
  return text.replace(PLACEHOLDER_PATTERN, (fullMatch, key) => (key in values ? values[key] : fullMatch));
}

function fillPlaceholders(projectDir, values) {
  for (const file of walkFiles(projectDir)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file))) continue;
    const original = fs.readFileSync(file, "utf8");
    const filled = replacePlaceholders(original, values);
    if (filled !== original) fs.writeFileSync(file, filled);
  }
}

function writeMainCss(projectDir) {
  const stylesDir = path.join(projectDir, "styles");
  fs.mkdirSync(stylesDir, { recursive: true });
  const cssFileExists = (name) => fs.existsSync(path.join(stylesDir, `${name}.css`));

  const lines = [
    "/* Generated by frontstruct. Later layers always win, regardless of specificity. */",
    `@layer ${CSS_LAYER_ORDER};`,
    "",
  ];
  for (const [fileName, layer] of CSS_FILES) {
    if (cssFileExists(fileName)) lines.push(`@import url("${fileName}.css") layer(${layer});`);
  }

  fs.writeFileSync(path.join(stylesDir, "main.css"), lines.join("\n") + "\n");
}

function writeMainJs(projectDir, selectedOptions) {
  const scriptsDir = path.join(projectDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });

  const importLines = [];
  const initCalls = [];

  for (const [optionValue, module] of Object.entries(JS_MODULES)) {
    if (!selectedOptions.has(optionValue)) continue;
    if (!fs.existsSync(path.join(scriptsDir, "modules", module.file))) continue;
    importLines.push(`import { ${module.init} } from "./modules/${module.file}";`);
    initCalls.push(`${module.init}();`);
  }

  const lines = ['// Entry point – loaded as type="module".', ""];
  if (importLines.length) lines.push(...importLines, "", ...initCalls, "");

  fs.writeFileSync(path.join(scriptsDir, "main.js"), lines.join("\n"));
}

function buildPlaceholderValues({ projectName, lang, selectedOptions }) {
  const texts = PAGE_TEXTS[lang] ?? PAGE_TEXTS.de;
  const headScripts = selectedOptions.has("theme-toggle")
    ? `<script>
      try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
    </script>`
    : "";

  const headerActions = [
    selectedOptions.has("theme-toggle") &&
      `<button class="theme-toggle" type="button" data-theme-toggle aria-label="${texts.themeToggle}">◐</button>`,
    selectedOptions.has("mobile-nav") &&
      `<button class="nav-toggle" type="button" aria-controls="site-nav" aria-expanded="false" aria-label="${texts.menuToggle}">
          <span class="nav-toggle__bar"></span>
        </button>`,
  ]
    .filter(Boolean)
    .join("\n        ");

  const footerLinks = selectedOptions.has("legal")
    ? `<nav aria-label="${texts.legalNav}"><a href="impressum.html">${texts.imprint}</a> · <a href="security.html">${texts.privacy}</a></nav>`
    : "";

  return {
    name: projectName,
    title: projectName,
    lang,
    year: String(new Date().getFullYear()),
    head_scripts: headScripts,
    header_actions: headerActions,
    footer_links: footerLinks,
  };
}

function runCommand(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: "ignore", shell: process.platform === "win32" });
  return !result.error && result.status === 0;
}

p.intro(`frontstruct v${packageJson.version}`);

const DEFAULT_PROJECT_NAME = "my-project";
let projectName = projectNameArg?.trim();

if (!projectName && useDefaults) {
  projectName = DEFAULT_PROJECT_NAME;
}

if (projectName) {
  const error = validateProjectName(projectName);
  if (error) {
    p.cancel(error);
    process.exit(1);
  }
} else {
  projectName = getAnswer(
    await p.text({
      message: "Project name?",
      placeholder: DEFAULT_PROJECT_NAME,
      defaultValue: DEFAULT_PROJECT_NAME,
      validate: (input) => validateProjectName(input || DEFAULT_PROJECT_NAME),
    })
  ).trim();
}

let answers;

if (useDefaults) {
  answers = { ...DEFAULTS };
  p.log.info("Using default settings.");
} else {
  answers = {
    lang: getAnswer(
      await p.select({ message: "Page language?", options: LANGUAGE_OPTIONS, initialValue: DEFAULTS.lang })
    ),

    css: getAnswer(
      await p.multiselect({
        message: "CSS extras? (Space: select, Enter: confirm)",
        options: CSS_OPTIONS,
        initialValues: DEFAULTS.css,
        required: false,
      })
    ),

    js: getAnswer(
      await p.multiselect({
        message: "JavaScript extras?",
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

const selectedOptions = new Set([...answers.css, ...answers.js, ...answers.pages]);

for (const jsOption of JS_OPTIONS) {
  if (!selectedOptions.has(jsOption.value) || !jsOption.requires) continue;

  for (const requiredValue of jsOption.requires) {
    if (selectedOptions.has(requiredValue)) continue;
    selectedOptions.add(requiredValue);
    const requiredLabel = CSS_OPTIONS.find((option) => option.value === requiredValue)?.label ?? requiredValue;
    p.log.info(`Added "${requiredLabel}" because "${jsOption.label}" needs it.`);
  }
}

const projectDir = path.resolve(projectName);
const missingTemplateParts = [];

const spinner = p.spinner();
spinner.start("Creating project");

try {
  if (!copyFromTemplate("base", projectDir)) {
    throw new Error(`Template not found: ${path.join(TEMPLATE_DIR, "base")}`);
  }

  for (const optionValue of selectedOptions) {
    if (!copyFromTemplate(path.join("extras", optionValue), projectDir)) {
      missingTemplateParts.push(optionValue);
    }
  }

  writeMainCss(projectDir);
  writeMainJs(projectDir, selectedOptions);
  renameDotfiles(projectDir);

  const placeholderValues = buildPlaceholderValues({
    projectName,
    lang: answers.lang,
    selectedOptions,
  });
  fillPlaceholders(projectDir, placeholderValues);

  spinner.stop("Project created");
} catch (error) {
  spinner.stop("Failed to create project");
  p.cancel(error.message);
  process.exit(1);
}

if (missingTemplateParts.length) {
  p.log.warn(`These parts are not in the template yet and were skipped: ${missingTemplateParts.join(", ")}`);
}

if (answers.git) {
  if (runCommand("git", ["init", "-q"], projectDir)) {
    p.log.success("Git repository initialized");
  } else {
    p.log.warn("Could not initialize Git (is Git installed?).");
  }
}

const nextSteps = [`cd ${projectName}`, "Open index.html in your browser or with Live Server"];
p.note(nextSteps.join("\n"), "Next steps");
p.outro("Happy building!");