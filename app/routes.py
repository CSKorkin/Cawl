from flask import Blueprint, render_template, current_app
from .simulator import Army, PairingMatrix
import os
import random


def prettify_name(filename: str) -> str:
    """Convert an image filename to a human readable army name."""
    base = os.path.splitext(filename)[0].replace('_', ' ')
    words = [w[0].upper() + w[1:].lower() if len(w) > 1 else w.upper() for w in base.split(' ')]
    return ' '.join(words)


def load_armies(count: int = 8):
    """Return a random selection of armies loaded from icon files."""
    army_dir = os.path.join(current_app.root_path, 'static', 'armies')
    files = [f for f in os.listdir(army_dir) if f.lower().endswith('.png')]
    armies = [Army(name=prettify_name(f), icon=f'armies/{f}') for f in files]
    if count is not None:
        if len(armies) > count:
            armies = random.sample(armies, count)
        else:
            random.shuffle(armies)
    return armies

main = Blueprint('main', __name__)

@main.route('/')
def index():
    return render_template('index.html')

@main.route('/singleplayer')
def singleplayer():
    team_a = load_armies()
    team_b = load_armies()
    matrix = PairingMatrix.random(team_a)
    return render_template('pairings.html', team_a=team_a, team_b=team_b, matrix=matrix.matrix)

