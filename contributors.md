## System structure

- The backend is provided in /app. /static contains the necessary assets for the pairings algorithm to run as well as css stylings.
- /app/templates contains the baseline HTML pages
- The majority of logic used is present in /app/routes.py and /app/simulator.py, with the specific logic for handling pairings in /app/static/js/pairings.js