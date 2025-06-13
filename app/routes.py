from flask import Blueprint, render_template
from .simulator import Army, PairingMatrix

main = Blueprint('main', __name__)

@main.route('/')
def index():
    return render_template('index.html')

@main.route('/singleplayer')
def singleplayer():
    team_a = [Army(f'Army {i+1}') for i in range(8)]
    team_b = [Army(f'Opponent {i+1}') for i in range(8)]
    matrix = PairingMatrix.random(team_a)
    return render_template('pairings.html', team_a=team_a, team_b=team_b, matrix=matrix.matrix)

