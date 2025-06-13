from flask import Blueprint, render_template
from .simulator import Army, PairingMatrix

main = Blueprint('main', __name__)

@main.route('/')
def index():
    return render_template('index.html')

@main.route('/singleplayer')
def singleplayer():
    armies = [Army(f'Army {i+1}') for i in range(8)]
    matrix = PairingMatrix.random(armies)
    return render_template('singleplayer.html', matrix=matrix.matrix)