from flask import Blueprint, render_template, current_app
from .simulator import Army, PairingMatrix
import os


def load_armies():
    army_dir = os.path.join(current_app.root_path, 'static', 'armies')
    files = [f for f in os.listdir(army_dir) if f.lower().endswith('.png')]
    armies = []
    for fname in sorted(files):
        name = os.path.splitext(fname)[0].replace('_', ' ').title()
        armies.append(Army(name=name, icon=f'armies/{fname}'))
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

