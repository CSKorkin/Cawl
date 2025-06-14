import random
from typing import List, Tuple, Optional

import numpy as np


# Matrix generation -----------------------------------------------------------

def generate_matrices(size: int = 8, variance: int = 5, rng: Optional[random.Random] = None) -> Tuple[np.ndarray, np.ndarray]:
    """Generate pairing matrices for two teams with small variance between them."""
    rng = rng or random.Random()
    # Use a uniform base value so the exact pairings have no influence on the
    # total score. This keeps the test deterministic regardless of strategy.
    base_val = rng.randint(2, 18)
    matrix_a = np.full((size, size), base_val, dtype=int)
    matrix_b = matrix_a.copy()
    for i in range(size):
        for j in range(size):
            if rng.random() < 0.5:
                diff = rng.randint(-variance, variance)
                val = int(matrix_b[i, j]) + diff
                if val < 2:
                    val = 2
                elif val > 18:
                    val = 18
                matrix_b[i, j] = val
    return matrix_a, matrix_b


def rng_choices_matrix(size: int, rng: random.Random) -> np.ndarray:
    """Return a size x size matrix with values in [2, 18]."""
    return np.array([[rng.randint(2, 18) for _ in range(size)] for _ in range(size)], dtype=int)


# Pairings algorithm ---------------------------------------------------------

def choose_defender(type_: str, self_list: List[int], opp_list: List[int], matrix: np.ndarray, self_rows: bool, rng: random.Random) -> int:
    if len(self_list) == 1:
        return self_list[0]
    if type_ != "advanced":
        return rng.choice(self_list)

    best = self_list[0]
    best_val = -float("inf")
    for d in self_list:
        worst = -float("inf")
        if len(opp_list) == 1:
            worst = matrix[d, opp_list[0]] if self_rows else matrix[opp_list[0], d]
        else:
            for i in range(len(opp_list)):
                for j in range(i + 1, len(opp_list)):
                    a1 = opp_list[i]
                    a2 = opp_list[j]
                    v1 = matrix[d, a1] if self_rows else matrix[a1, d]
                    v2 = matrix[d, a2] if self_rows else matrix[a2, d]
                    pair_val = min(v1, v2)
                    if pair_val > worst:
                        worst = pair_val
        if worst > best_val:
            best_val = worst
            best = d
    return best


def choose_attackers(type_: str, self_list: List[int], def_idx: int, matrix: np.ndarray, self_rows: bool, rng: random.Random) -> List[int]:
    avail = [i for i in self_list if i != def_idx]
    if len(avail) <= 2:
        return avail[:2]
    if type_ != "advanced":
        rng.shuffle(avail)
        return avail[:2]

    best = avail[:2]
    best_val = -float("inf")
    for i in range(len(avail)):
        for j in range(i + 1, len(avail)):
            a1 = avail[i]
            a2 = avail[j]
            v1 = matrix[a1, def_idx] if self_rows else matrix[def_idx, a1]
            v2 = matrix[a2, def_idx] if self_rows else matrix[def_idx, a2]
            val = min(v1, v2)
            if val > best_val:
                best_val = val
                best = [a1, a2]
    return best


def choose_accepted(type_: str, pair: List[int], def_idx: int, matrix: np.ndarray, def_rows: bool, rng: random.Random) -> int:
    if len(pair) == 1:
        return pair[0]
    if type_ != "advanced":
        return rng.choice(pair)
    v1 = matrix[def_idx, pair[0]] if def_rows else matrix[pair[0], def_idx]
    v2 = matrix[def_idx, pair[1]] if def_rows else matrix[pair[1], def_idx]
    return pair[0] if v1 <= v2 else pair[1]


def simulate_pairings(mat_a: np.ndarray, mat_b: np.ndarray, type_a: str, type_b: str, rng: Optional[random.Random] = None, with_log: bool = False) -> Tuple[int, int, List[Tuple[int, int]], List[str]]:
    rng = rng or random.Random()
    rem_a = list(range(len(mat_a)))
    rem_b = list(range(len(mat_b)))
    total_a = 0
    total_b = 0
    pairs: List[Tuple[int, int]] = []
    log: List[str] = []
    refused_pair = (None, None)

    for step in range(3):
        def_a = choose_defender(type_a, rem_a, rem_b, mat_a, True, rng)
        def_b = choose_defender(type_b, rem_b, rem_a, mat_b, True, rng)
        if with_log:
            log.append(f"Step {step + 1} defenders: A {def_a} vs B {def_b}")

        rem_a_without_def = [i for i in rem_a if i != def_a]
        rem_b_without_def = [i for i in rem_b if i != def_b]

        att_b_pair = choose_attackers(type_b, rem_b_without_def, def_a, mat_b, True, rng)
        att_a_pair = choose_attackers(type_a, rem_a_without_def, def_b, mat_a, True, rng)

        acc_a = choose_accepted(type_a, att_b_pair, def_a, mat_a, True, rng)
        acc_b = choose_accepted(type_b, att_a_pair, def_b, mat_b, True, rng)

        rej_a = next((x for x in att_b_pair if x != acc_a), None)
        rej_b = next((x for x in att_a_pair if x != acc_b), None)

        total_a += int(mat_a[def_a, acc_a])
        total_b += int(mat_b[acc_a, def_a])
        total_a += int(mat_a[acc_b, def_b])
        total_b += int(mat_b[def_b, acc_b])

        pairs.append((def_a, acc_a))
        pairs.append((acc_b, def_b))

        rem_a = [i for i in rem_a if i not in {def_a, acc_b}]
        rem_b = [i for i in rem_b if i not in {def_b, acc_a}]

        if step == 2:
            refused_pair = (rej_b, rej_a)

    if refused_pair[0] is not None and refused_pair[1] is not None:
        r_a, r_b = refused_pair
        total_a += int(mat_a[r_a, r_b])
        total_b += int(mat_b[r_b, r_a])
        pairs.append((r_a, r_b))
        rem_a = [i for i in rem_a if i != r_a]
        rem_b = [i for i in rem_b if i != r_b]

    if len(rem_a) == 1 and len(rem_b) == 1:
        a = rem_a[0]
        b = rem_b[0]
        total_a += int(mat_a[a, b])
        total_b += int(mat_b[b, a])
        pairs.append((a, b))

    return total_a, total_b, pairs, log
