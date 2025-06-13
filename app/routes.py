from flask import Blueprint, render_template, current_app, request
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
    row_avgs = matrix.matrix.mean(axis=1).round(1).tolist()
    col_avgs = matrix.matrix.mean(axis=0).round(1).tolist()
    return render_template(
        'pairings.html',
        team_a=team_a,
        team_b=team_b,
        matrix=matrix.matrix.tolist(),
        row_avgs=row_avgs,
        col_avgs=col_avgs,
    )


@main.route('/custom', methods=['GET', 'POST'])
def custom_setup():
    armies = load_armies(count=None)
    if request.method == 'POST':
        team_a_idxs = [int(request.form.get(f'team_a_{i}', 0)) for i in range(8)]
        team_b_idxs = [int(request.form.get(f'team_b_{i}', 0)) for i in range(8)]
        team_a = [armies[idx % len(armies)] for idx in team_a_idxs]
        team_b = [armies[idx % len(armies)] for idx in team_b_idxs]
        matrix = []
        for i in range(8):
            row = []
            for j in range(8):
                val = request.form.get(f'cell_{i}_{j}', '10')
                try:
                    row.append(int(val))
                except ValueError:
                    row.append(10)
            matrix.append(row)
        import numpy as np
        row_avgs = np.array(matrix).mean(axis=1).round(1).tolist()
        col_avgs = np.array(matrix).mean(axis=0).round(1).tolist()
        return render_template(
            'pairings.html',
            team_a=team_a,
            team_b=team_b,
            matrix=matrix,
            row_avgs=row_avgs,
            col_avgs=col_avgs,
        )

    return render_template('custom.html', armies=armies)

