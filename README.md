# 40k Pairings Simulator

This repository contains the starting point for a 40k pairings simulator. The goal is to allow competitive play by simulating the defender/attacker pairing process for Warhammer 40k team tournaments.

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

## Tasks

Below is a high‑level task breakdown for building the simulator:

1. **User Interface**
   - Display home screen with options for singleplayer or multiplayer.
   - Render a colour‑coded matrix of pairing scores.
   - Provide controls for selecting defenders and attackers.
2. **Pairing Logic**
   - Implement data models for armies and pairing matrices.
   - Create logic for defenders/attackers selection and table choice token.
   - Generate semi‑randomised matrices with small variance between teams.
3. **Singleplayer Mode**
   - Implement an opponent algorithm that makes pairing choices.
4. **Multiplayer Mode**
   - Allow two users to connect and perform the pairing steps.
5. **Game Logging**
   - Record the chosen pairings and tables for later review.
6. **Styling and UX**
   - Improve the visual presentation and colour‑coding.
