# Cawl

This repository contains the code for Cawl, a 40k pairings simulator. The goal is to allow competitive play by simulating the defender/attacker pairing process for Warhammer 40k team tournaments.

## Frameworks

- **Python 3** – main programming language
- **Flask** – lightweight web framework used for the web interface
- **NumPy** – used to generate random pairing matrices and other calculations

## Setup

```bash
pip install -r requirements.txt
python run.py
```

The application will start a local development server.

## Assets

The home page styling expects two images under `app/static/`:

- **noise.png** – a subtle monochrome noise texture roughly 600x600px used to hide gradient banding.
- **cog.png** – a transparent PNG of a gear about 600x600px for the parallax effect.

Place these files in the `app/static` directory so the references in `home.css` work correctly.

The `home.js` script adjusts CSS variables based on the browser height so the radial gradient covers the screen without banding.
