import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import random

import numpy as np

from app.pairings_ai import generate_matrices, simulate_pairings


def test_advanced_vs_random_never_better():
    rng = random.Random(123)
    matrix_a, matrix_b = generate_matrices(rng=rng)
    adv_total, _, adv_pairs, _ = simulate_pairings(matrix_a, matrix_b, 'advanced', 'advanced', rng=rng)

    for i in range(50000):
        r_rng = random.Random(12345 + i)
        rand_total, _, rand_pairs, _ = simulate_pairings(matrix_a, matrix_b, 'random', 'advanced', rng=r_rng)
        if rand_total > adv_total:
            raise AssertionError(
                f"Random vs Advanced outperformed Advanced vs Advanced on iteration {i}.\n"
                f"Advanced vs Advanced score: {adv_total}\n"
                f"Random vs Advanced score: {rand_total}\n"
                f"Advanced pairings: {adv_pairs}\n"
                f"Random pairings: {rand_pairs}"
            )

