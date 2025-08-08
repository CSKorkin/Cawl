"""
tests/test_pairings_ai.py
~~~~~~~~~~~~~~~~~~~~~~~~~

Regression-tests for the 40 k pairing AI.

* ``optimal_difference`` is the new ground-truth evaluator (full-depth minimax).
* ``simulate_pairings`` is still used to check the heuristic “advanced”
  strategy against a purely random one.

The test asserts two things:

1)  The heuristic ‘advanced’ strategy for Team A is **never worse** than a
    random strategy when the opponent also uses ‘advanced’.

2)  The heuristic result can never beat the *true* optimum returned by
    ``optimal_difference``.
"""

import os
import sys
import random

import numpy as np
import pytest

# --------------------------------------------------------------------------- #
#  Make the package importable when the test is executed with `pytest -q`     #
# --------------------------------------------------------------------------- #
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from app.pairings_ai import (
    generate_matrices,
    simulate_pairings,
    optimal_difference,
)

# --------------------------------------------------------------------------- #
#  Tweaks                                                                     #
# --------------------------------------------------------------------------- #
N_ITERATIONS = 5_000           # feel free to increase – test is cheap
MAIN_SEED    = 123             # reproducible matrices
DEBUG        = True           # set True for a running commentary


# --------------------------------------------------------------------------- #
#  Helpers                                                                    #
# --------------------------------------------------------------------------- #
def _adv_vs_adv(matrix_a: np.ndarray, matrix_b: np.ndarray, rng: random.Random):
    """Team A advanced – Team B advanced  ➜  (points_A, points_B)."""
    return simulate_pairings(
        matrix_a,
        matrix_b,
        "advanced",
        "advanced",
        rng=rng,
    )[:2]                       # just (total_a, total_b)


def _rand_vs_adv(matrix_a: np.ndarray, matrix_b: np.ndarray, rng: random.Random):
    """Team A random – Team B advanced  ➜  (points_A, points_B)."""
    return simulate_pairings(
        matrix_a,
        matrix_b,
        "random",
        "advanced",
        rng=rng,
    )[:2]


# --------------------------------------------------------------------------- #
#  The single regression-test                                                 #
# --------------------------------------------------------------------------- #
def test_random_never_beats_advanced_or_optimal():
    """Random (A) vs Advanced (B) must never outperform the other variants."""
    rng_matrices = random.Random(MAIN_SEED)
    matrix_a, matrix_b = generate_matrices(rng=rng_matrices)

    # ► 1) reference scores
    adv_a, adv_b = _adv_vs_adv(matrix_a, matrix_b, rng=random.Random(MAIN_SEED))
    adv_delta    = adv_a - adv_b

    opt_delta = optimal_difference(matrix_a, matrix_b)

    # safety check – the heuristic should never exceed the mathematical optimum
    assert adv_delta <= opt_delta, (
        f"Heuristic advanced vs advanced ({adv_delta}) "
        f"surpassed optimal play ({opt_delta})."
    )

    # ► 2) 5 000 random attempts
    for i in range(N_ITERATIONS):
        rand_a, rand_b = _rand_vs_adv(
            matrix_a,
            matrix_b,
            rng=random.Random(12345 + i),
        )
        rand_delta = rand_a - rand_b

        if rand_delta > adv_delta:        # failure – random did better for A
            pytest.fail(
                f"Random vs Advanced out-performed Advanced vs Advanced "
                f"on iteration {i}.\n"
                f"Matrix seed: {MAIN_SEED}\n"
                f"Adv. ΔA-B : {adv_delta}\n"
                f"Rand ΔA-B: {rand_delta}",
                pytrace=False,
            )

        if DEBUG and i % 500 == 0:
            print(
                f"[{i:>5}/{N_ITERATIONS}]  Rand Δ {rand_delta:>3}  "
                f"≤  Adv Δ {adv_delta:>3}  ≤  Opt Δ {opt_delta:>3}",
            )

if __name__ == "__main__":
    test_random_never_beats_advanced_or_optimal()