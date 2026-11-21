# Voughkhabbeauxlaireigh Lhyrnyrr

A static **flashcard + matching** website for studying vocabulary. No build step, no backend, no dependencies: just HTML, CSS, and JavaScript. Everything is saved in your browser.

**Version:** 1.0

## Features

- **Flashcards** with known / still-learning tracking, hints, and text-to-speech reading
- **Match game** with flip and face-up modes and multiple board sizes
- **Library** of lessons you can import, edit, group, and delete
- **Best scores** saved per lesson, group, or selection of lessons
- **Themes** (Pink, Blue, Orange), each with light and dark modes
- **Custom fonts** (Times New Roman, Consolas, 256 Bytes, or add your own)
- **Built-in music player** with your own songs supported
- **Full keyboard control**, with an in-app guide (`?` button)
- Works **offline**

## Getting started

**Option 1: Download the whole directory and open directly.** Double-click `index.html`.

**Option 2: Go the the static website of this repo published by github:** https://nicholassouth.github.io/Voughkhabbeauxlaireigh-Lhyrnyrr/

## Project structure

```
.
├── index.html
├── README.md
├── assets/
│   └── icon.ico
├── audios/
│   ├── playlist.js        # default playlist
│   └── *.mp3
├── css/
│   └── style.css          # all colors live in :root at the top
├── fonts/
│   └── twofiftysixbytes.woff2
└── js/
    ├── app.js
    └── reader.js
```

## Importing lessons

Import files use three columns:

| word | form | definition |
| ---- | ---- | ---------- |

- Merged rows, or a lone row starting with `Trang`, `Page`, `Unit`, or `Lesson`, start a new lesson.
- Re-importing a file with the same lesson names **updates** those lessons (no duplicates).
- The folder `sample_importables` contain 2 sample `.xlsx` files that are ready to imported, you needn't keep the folder if you run the web locally.

## Editing lessons

Go to **Library → Edit** on any lesson to rename it, edit, add, or delete individual words, then click **Save changes**.

> Editing a lesson's words resets its best scores.

## Music

The default playlist is the list of files in `audios/playlist.js`.

To add default songs:

1. Put `.mp3`, `.ogg`, `.wav`, or `.m4a` files in `audios/`.
2. Edit `audios/playlist.js` by hand.

When served over HTTP, files in `audios/` are also auto-detected.

The **+** button in the player lets you add your own songs from your device (saved in the browser). Remove them with **x** in the track list.

## Appearance

Click the gear icon (top right) to open settings.

- **Themes:** Pink, Blue, Orange, each with a Light / Dark switch.
- **Fonts:** Times New Roman (default on first open), Consolas, and 256 Bytes.
- **Add font...** accepts `.woff2`, `.woff`, `.ttf`, and `.otf`. Added fonts are saved in the browser and can be removed.

To change colors in the code, edit the tokens in `:root` at the top of `css/style.css` (theme tokens, swatches, shadows, overlays). Change them there only.

## Best scores

Scores are saved in the browser per lesson, and per group or selection of lessons.

- **Flashcards:** accuracy = known cards / all cards after a full run. "Review still learning" runs don't count.
- **Match:** highest accuracy (pairs / moves), then fastest time. Kept separately for each mode (flip / face-up) and board size.

Scores show as tags in the Library, in the Match bar ("best"), and on the finish screens.

## Keyboard shortcuts

Shortcuts are ignored while typing in a text box. Press `?` in the app to see this list.

**Flashcards**

| Key | Action |
| --- | ------ |
| `↑` | I know it |
| `↓` | Still learning |
| `←` / `→` | Previous / next |
| `F` | Flip |
| `Shift` | Read the word |
| `/` | Hint (first letter) |
| `'` | Word-first / definition-first |
| `Space` | Go to Match |

**Match**

| Key | Action |
| --- | ------ |
| Arrow keys | Move between cards |
| `D` | Choose |
| `R` | New board |
| `'` | Flip / face-up |
| `Space` | Go to Flashcards |

**Music**

| Key | Action |
| --- | ------ |
| `M` | Mute |
| `K` | Play / pause |
| `N` | Repeat mode |
| `B` | Shuffle |
| `,` / `.` | Previous / next song |
| `H` | Hide / show player |
| `L` | Track list |

**Anywhere**

| Key | Action |
| --- | ------ |
| `S` | Settings |
| `\` | Back to library |
| `Esc` | Close a popup |

## Data and privacy

Lessons, groups, scores, settings, custom fonts, and added songs are stored in your browser's `localStorage`. Nothing is sent to a server. Use the **Remove** and **Clear all** buttons in the Library to delete lessons.

## Credits

Click the website name (top left) in the app to open the credits popup. Its markup is in `index.html` (`id="credit"`).

- **Music:** "Classic" by [Joakim Karud](https://www.joakimkarud.com/use-my-music/), licensed under [CC BY](https://creativecommons.org/licenses/by/3.0/). "Dreams" by Dj Quads.
- **Font:** Two Fifty Six Bytes by [Ray Larabie](https://www.typodermicfonts.com), CC0 (public domain).
- **Icon:** `assets/icon.ico` "Under flaticon.com's lisence - allowed for personal and commercial usage"
