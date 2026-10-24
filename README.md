# frontstruct

frontstruct is a CLI tool, that automatically generates an advanced frontend skeleton, because who likes writing boilerplate code?

## Features:

### Folder structure

```text
my-project/
├─ index.html
├─ legal.html
├─ 404.html
├─ robots.txt
├─ .gitignore
├─ styles/
│  ├─ main.css
│  ├─ reset.css
│  ├─ layout.css
│  ├─ variables.css
│  ├─ components.css
│  ├─ darkmode.css
│  ├─ animations.css
│  └─ utilities.css
├─ scripts/
│  ├─ main.js
│  └─ modules/
│     ├─ theme-toggle.js
│     └─ mobile-nav.js
└─ .git/
```

### CSS

- reset, resets all default margins, paddings and other values
- layout primitives, adds layout classes such as .flex and .grid
- variables, automatically sets colors, margins, paddings, etc.
- basic components, primitive buttons, cards and forms
- darkmode, adds darkmode variables
- animations, defines small animations like fade-ins

### JavaScript

- theme toggle, adds a button for toggling between light and darkmode, requires CSS darkmode
- mobile navigation, adds a Hamburger menu

### Pages

- index.html, page index
- legal.html, legal notice and privacy policy
- 404.html, error page
- robots.txt, for agents, bots and crawlers

### Languages

- English
- German

### Other

- .gitignore
- .git

## Usage:

To install, run `npm install -g frontstruct`
Note: this installs fronstruct globally on your device. To install in the current directory, run `npm install frontstruct` in the directory of your choice.

To start a new project, run `frontstruct`. Alternatively, you can also run `fst` as an alias for `frontstruct` in all following commands.

After this, you will be presented with the setup dialog. Firstly, you will be asked to name your project. Choose a name of your choice that contains only letters, numbers and the symbols "_", "-" and ".". 

To skip this step you can run `frontstruct <your-project-name>`. This will add a new directory with your project name into your current directory. 

To select options in the following dialog, press `[space]`, to confirm, press`[Enter]`. You can also select multiple options. Just hitting `[Enter]` will select none of the options.

Once you're finished, the setup is complete and you can start coding!

### Flags

```bash
  -h, --help      #lists all flags and command syntax
  -y, --yes       #skips the setup dialog and creates a project with no extra options selected
  -v, --version   #shows the current frontstruct version installed on your system
```

## AI usage:

frontstruct uses no AI in the generation of the frontend skeleton, all the files already exist and are copied into your directory. This is to ensure consistancy in file generation.