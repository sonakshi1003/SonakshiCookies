# Sonakshi's Cookies — Full-Stack Website

Flask + SQLite backend, vanilla JS frontend, Three.js 3D cookie hero.

## Setup

```bash
cd sonakshis-cookies-web
python3 -m pip install -r requirements.txt
python3 app.py
```

Then open **http://127.0.0.1:5000** in your browser.

The database (`cookies.db`) and any owner-uploaded images (`static/uploads/`)
are created automatically on first run.

## Owner dashboard

Go to **http://127.0.0.1:5000/owner** — default PIN is `1234`
(change `OWNER_PIN` near the top of `app.py`).

## Notes

- The 3D cookie hero is a real Three.js object — a slightly extruded disc
  textured with your actual cookie photo (`static/images/cookie_hero.png`,
  which has a transparent background) on the top face, with a warm baked
  brown on the sides/underside for thickness. It has genuine idle rotation,
  mouse parallax, scroll interaction, floating animation, and a transition
  into the shop section on click — not a static image, an actual 3D mesh.
- Search uses **linear search** and sorting uses **bubble sort**, both
  implemented by hand in `static/js/main.js` rather than using the
  browser's built-in `.sort()`.
- Cart state lives in the browser (`localStorage`) so it survives a page
  refresh; orders themselves are stored server-side in SQLite.
