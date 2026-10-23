# Fullscreen lyrics on big screens: a better layout

Status: Cinema layout (video behind the lyrics, Windows) built; the other presets are still plan. Written 2026-10-24 from the owner's screenshot (1918 x 1198, Spotify music video behind the lyrics).

Goal: on a large screen the lyrics should feel like a cinema experience: the music video is the hero, the current line is unmistakable and always readable, everything else gets out of the way. Today the lyric column fills the right half with seven big lines, and the text fights with the picture.

---

## 1. What the screenshot shows (what works, what does not)

Works
- The video as the background is the right idea; the left-bottom glass player card is tidy; the current line is large and white.

Does not work
1. **Too much text.** About seven lines of 45-55 px text are visible; the lines above and below the current one are almost as big and bright as it, so nothing leads the eye. The right half of the screen is a wall of words.
2. **Legibility on a busy picture.** White text over bright faces, a chandelier and gold decor: the dim lines (about 40% white) fall below readable contrast. Only a flat dark veil is used; nothing is specific to where the text is.
3. **The video is not full bleed.** A solid black bar (about 83 px) runs along the top for the title and buttons, so the picture starts below it and looks letterboxed.
4. **Everything is always visible.** Header, buttons, player card, sync controls and the provider note all stay on screen while you watch; there is no "just watch and sing" state.
5. **Column placement is fixed.** Lyrics always start at the same x (about 43% of the width) and left-align, whatever is in the picture: they often sit on top of the faces and dancers.
6. **Tiny, low-contrast footer** ("LRCLIB - words estimated - Wrong lyrics? - sync") crowds the bottom edge and the last lyric line is cut ("Play on").
7. **Two reading languages compete.** Hindi/Punjabi lines with Roman letters (new setting) will double the amount of text unless the hierarchy is clearer.
8. **No variation by screen.** The same layout is used on a 13-inch laptop, a 27-inch monitor, a TV or an ultra-wide.

## 2. Design principles

- **One hero line.** The current line is 1.0; the next line 0.55 size/opacity; the rest fade out quickly. Maximum **three** lines on screen by default (previous, current, next); more only on request.
- **Cinema first.** The picture is full bleed; interface elements appear on mouse movement and fade after about 3 seconds.
- **Legibility is guaranteed, not hoped for.** Text always sits on a local scrim (a soft gradient or frosted band) plus a gentle shadow; the dim lines still meet WCAG large-text contrast (3:1) against the worst-case bright frame.
- **Space follows the screen.** Layout presets chosen from the window's shape and size, user-overridable.
- **Calm motion.** Lines glide, the word fill is the only fast element; reduced-motion keeps working.

## 3. The new layouts (presets)

```
 CINEMA (default on wide screens)                 SPLIT (current look, improved)
 +----------------------------------------+       +----------------------------------------+
 |                                        |       |                                        |
 |        full-bleed music video         |       |   video            |  prev (dim)       |
 |                                        |       |                    |  CURRENT LINE     |
 |                                        |       |   [card]           |  next (dim)       |
 |   Previous line, small and dim         |       +----------------------------------------+
 |   CURRENT LINE, BIG, CENTERED/LOWER    |
 |   Next line, medium                    |       POSTER (square windows, TVs far away)
 |   [ ♪ Song · Artist  ----o------ 1:04 ]|       +----------------------------------------+
 +----------------------------------------+       |            CURRENT LINE                |
                                                  |       huge, centered, 2 lines max      |
 FOCUS (subtitle style, any screen)               |         small song pill below          |
 +----------------------------------------+       +----------------------------------------+
 |        full-bleed video                |
 |                                        |
 |        CURRENT LINE (one line)         |
 +----------------------------------------+
```

- **Cinema:** lyrics centred in the lower third on a soft bottom gradient (like film subtitles but large); the left/right thirds stay clear for the picture. Default for widths above 1100 px and landscape.
- **Split:** today's layout (video left, lyrics right) with the improvements below, for people who like it and for very wide screens (21:9), where the lyric column is placed on the side with the least action (left or right toggle).
- **Poster:** one huge line, centred, for TVs/party mode and portrait or small windows.
- **Focus:** a single line at the bottom for people who want the video most.
- The existing "cinema/mini" modes stay; presets are an extra setting "Fullscreen layout: Auto / Cinema / Split / Poster / Focus".

## 4. Specific changes

**Legibility**
1. Per-layout scrim: a gradient from the text side (for example `rgba(0,0,0,.55)` to transparent over 45% of the width, or a bottom gradient for Cinema) that sits under the text only; remove the flat full-screen dim.
2. Text shadow: two layers (a tight 1-2 px dark edge and a soft 24 px blur) on every lyric line.
3. Minimum opacity for non-current lines raised to **0.55** for the next line and **0.3** for the rest, but only two of them are shown, and they get a slight blur (2 px) and scale (0.85) so depth, not dimness, signals "not now".
4. Optional **frosted lyric panel** (backdrop blur 18 px, 12% black) when the setting "Lyrics panel" is on.
5. We cannot read the pixels of a YouTube video (it is a cross-origin player), so the scrim strength is fixed and strong enough for bright footage; for video files Lyra owns (Apple clip, own file) the existing luminance sampler can lift/lower the scrim automatically.

**Hierarchy and typography**
6. Current line: `clamp(34px, 4.6vw, 84px)`, weight 800, tight tracking; maximum two wrapped rows (long lines shrink slightly to fit).
7. Previous line 0.42x, next line 0.62x of the current size; no more than three lines by default.
8. Word-by-word fill with a soft glow in the cover's accent colour (not a hard white/grey wipe); the already-sung part of the line stays bright, the rest 55%.
9. Hindi/Punjabi: dedicated font fallbacks (Noto Sans Devanagari/Gurmukhi) with a taller line height (1.35) so the matras are never clipped; the Roman line is 0.5x size, 70% opacity, directly under its line.
10. Text block width capped at about 60 characters and about 56% of the width in Cinema, so lines do not run edge to edge on ultra-wide screens.

**Chrome and controls**
11. **Full-bleed video:** the top bar becomes a translucent overlay (gradient from `rgba(0,0,0,.6)` to transparent), never a solid band.
12. **Idle hiding:** header, buttons, player card and footer fade out after 3 s without mouse movement and return on movement or any key; the cursor hides too.
13. **Player card: keep today's design** (owner likes it). It stays as is, bottom-left; it only joins the idle fade (change 12). The slim dock in the mockups is dropped.
14. **Footer controls** (provider, "Wrong lyrics?", sync) move into a small "..." popover; the sync nudge also works with `[` and `]`.
15. **Never cut a line:** the lyric area is clipped with a soft mask (fade over the last 12%), not by hard cropping.

**Adaptive behaviour**
16. Breakpoints: below 700 px wide or portrait = Poster; 700-1100 = Split; above 1100 landscape = Cinema; 21:9 = Split with the lyric side chosen from where the video's subject usually is (default right, one-key flip `L`).
17. Font sizes scale with the window height as well as width so a short, wide window (a laptop at 1366x768) does not overflow.
18. TV mode and the Android fullscreen reuse the Poster/Focus presets.

## 5. Accessibility and quality gates

- Contrast: current line 7:1, next line 4.5:1, others at least 3:1 against a worst-case white frame behind the scrim (checked with a script that composites the scrim over white and over the brightest YouTube frames we have).
- No text clipped at 1366x768, 1920x1080, 2560x1440, 3440x1440 (screenshot test at each size with Latin, Devanagari and Gurmukhi lyrics, with and without the Roman line).
- Reduced motion: no glides or blur transitions, instant line change.
- Keyboard: `F` fullscreen, `Space` play/pause, arrows seek by line, `[` `]` sync, `L` flip side, `1-5` presets.
- Performance: the layout must not drop below 60 fps on the owner's laptop with the video playing (measured with the browser's frame timing).

## 6. Rollout

| Step | Content | Done when |
|---|---|---|
| U0 (1 day) | Screenshot harness at five sizes with fixed lyrics and a bright test frame; contrast script | Baseline numbers recorded |
| U1 (1-2 days) | Scrim + shadow + opacity/blur hierarchy + three-line cap + full-bleed top bar (the quick wins, no new layouts) | The same screenshot reads clearly on the bright frame |
| U2 (2 days) | Idle hiding of chrome, slim dock, footer popover, keyboard shortcuts | Watching fullscreen shows only video and lyrics |
| U3 (2-3 days) | Cinema, Split, Poster, Focus presets + Auto breakpoints + setting | Each preset passes the size matrix |
| U4 (1 day) | Hindi/Punjabi font fallbacks and Roman line styling; ultra-wide side flip | Indic lyrics never clip |
| U5 | Polish: glow on the word fill, per-cover accent, animation timing | Owner sign-off on screenshots |

## 7. Risks and open questions
- A fixed scrim darkens bright videos a little: keep it a gradient limited to the text side and let the owner choose "Lyrics panel: off / scrim / frosted".
- Changing the default layout will surprise people who like today's: keep Split available and mention it in the release notes.
- Roman letters double the text: Cinema shows them only for the current line unless "Roman letters: all lines" is on.
- Questions: Do you prefer **Cinema (lyrics lower and centred)** or keep **Split (lyrics right)** as the default? Should chrome auto-hide by default, or only in fullscreen?
