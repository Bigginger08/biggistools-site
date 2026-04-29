# Project ∆E Matcher

Static browser tool using plain HTML, CSS, and JavaScript.

## Files

- `index.html`
- `styles.css`
- `app.js`

## How to use

1. Open `index.html` in a browser.
2. Enter the API host as `IP:port`, for example `10.211.55.9:8080`.
3. Click **Connect & Load Projects**.
4. Filter projects.
5. Select one or more projects.
6. Enter one requested color per line.
7. Click **Run ∆E Lookup for Selected Projects**.

## Current API assumptions

Project list endpoint:

```text
http://IP:port/api/projects
```

Project detail endpoint:

```text
http://IP:port/project/%7BPROJECT_ID%7D
```

The app expects project detail colors under:

```text
projectSeparationRules > projectSeparationRule > ink
```

Each color should contain:

```xml
<name>PANTONE 186 C</name>
<deltaE>1.73804</deltaE>
```

## Notes

- No external libraries are used.
- The last used host and project endpoint are stored in localStorage.
- Fuzzy matching ignores case, spaces, and punctuation.
- Row status is based on "all colors must pass":
  - Green: every requested color is green
  - Orange: at least one is orange, none are red/missing
  - Red: any requested color is red or missing


## Enterprise-style theme update

This version uses a hybrid styling approach inspired by the provided CSS:

- gray application background
- light panel/header surfaces
- blue action buttons and hover states
- magenta header/table accent line
- tighter enterprise-style table spacing
- no external dependencies
