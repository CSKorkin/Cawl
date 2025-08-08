import math
import random
from functools import lru_cache
from typing import Dict, Iterable, Sequence, Mapping, Optional, Tuple, List
from itertools import combinations
import numpy as np

# --------------------------------------------------------------------------- #
# 0.  Utility – attacker tuples                                               #
# --------------------------------------------------------------------------- #
def _attacker_sets(players: Iterable[int]) -> list[Tuple[int, ...]]:
    """All legal 'offers' that a captain can hand over."""
    players = tuple(players)
    return list(combinations(players, 2))


# --------------------------------------------------------------------------- #
# 1.  Proper matrix generation (no degenerate constant rows)                  #
# --------------------------------------------------------------------------- #
def generate_matrices(size: int = 8,
                      variance: int = 2,
                      rng: Optional[random.Random] = None
                      ) -> Tuple[np.ndarray, np.ndarray]:
    """
    mat_a[rA, cB]  – expected score for Team A when its list rA plays B’s list cB
    mat_b[rB, cA]  – expected score for Team B when its list rB plays A’s list cA
                     (score_A + score_B ≈ 20)
    """
    rng = rng or random.Random()

    # A’s values – completely free to vary
    mat_a = np.array([[rng.randint(2, 18) for _ in range(size)]
                      for _ in range(size)],
                     dtype=int)

    # B’s values – transpose first, then take the complement and add a bit of noise
    mat_b = 20 - mat_a.T               # transpose gives B-rows/A-cols orientation
    noise  = np.vectorize(lambda _: rng.randint(-variance, variance))
    mat_b  = mat_b + noise(mat_b)
    np.clip(mat_b, 2, 18, out=mat_b)   # keep inside [2, 18]

    return mat_a, mat_b

ScoreMatrix = Mapping[str, Mapping[str, int]]

def scrum_minimax(
    scores: ScoreMatrix,
    your_armies: Sequence[str],
    opp_armies: Sequence[str],
) -> Dict[str, int]:
    """
    Compute the minimax value (your-side perspective) for every possible
    defender you can put forward in the scrum

    Parameters
    ----------
    scores
        Nested mapping such that `scores[your_army][their_army] -> int`
        represents the predicted game score when those two armies meet
        (positive is good for you, negative good for them).
    your_armies
        The four armies you still have available in this stage.
    opp_armies
        The four armies your opponent still has available.

    Returns
    -------
    dict
        `{defender_name: minimax_score}` – the final score you can force
        (assuming perfect play by both teams) if you declare that army as
        your defender.
    """
    def s(your: str, theirs: str) -> int:
        return scores[your][theirs]

    results: Dict[str, int] = {}

    for your_def in your_armies:
        worst_vs_any_opp_def = int("inf")

        for opp_def in opp_armies:
            yours_left   = [a for a in your_armies if a != your_def]
            opps_left    = [a for a in opp_armies  if a != opp_def]

            best_you_can_force = float("-inf")

            for your_atks in combinations(yours_left, 2):
                your_forgot = next(a for a in yours_left if a not in your_atks)

                worst_given_your_atks = float("inf")

                for opp_atks in combinations(opps_left, 2):
                    opp_forgot = next(a for a in opps_left if a not in opp_atks)

                    # -------- defenders simultaneously accept one attacker -
                    max_if_you_pick_well = float("-inf")

                    for your_accept in opp_atks:                              
                        min_if_they_pick_well = float("inf")

                        for opp_accept in your_atks:                          
                            # Identify refused attackers
                            your_refused = next(a for a in your_atks if a != opp_accept)
                            opp_refused  = next(a for a in opp_atks  if a != your_accept)

                            # Four tables are now fixed – score them
                            total = (
                                  s(your_def,  your_accept)   # defender table A
                                + s(opp_accept, opp_def)      # defender table B
                                + s(your_refused, opp_refused)  # refused v refused
                                + s(your_forgot, opp_forgot)    # forgotten v forgotten
                            )

                            min_if_they_pick_well = min(min_if_they_pick_well, total)
                        max_if_you_pick_well = max(max_if_you_pick_well, min_if_they_pick_well)
                    worst_given_your_atks = min(worst_given_your_atks, max_if_you_pick_well)
                best_you_can_force = max(best_you_can_force, worst_given_your_atks)
            worst_vs_any_opp_def = min(worst_vs_any_opp_def, best_you_can_force)
        results[your_def] = worst_vs_any_opp_def
    return results

def pairings_minimax_8(
    scores: ScoreMatrix,
    my_armies: Sequence[str],
    opp_armies: Sequence[str],
) -> float:
    """
    Brute-force minimax of the full three-stage 8-man pairing sequence.

    Parameters
    ----------
    scores
        Nested mapping: scores[my_army][their_army] → predicted game score
        (positive is good for *us*).
    my_armies
        Eight distinct army identifiers on our team.
    opp_armies
        Eight distinct army identifiers on the opponent’s team.

    Returns
    -------
    float
        The score Team A can guarantee (and Team B can hold us to)
        under perfect play.
    """
    # Put the army sets in a canonical order so that every state has a
    # unique, hashable key for memoisation.
    start_a = tuple(sorted(my_armies))
    start_b = tuple(sorted(opp_armies))

    # ------------------------------------------------------------------
    #  The recursive solver – memoised to keep the brute-force tractable
    # ------------------------------------------------------------------
    @lru_cache(maxsize=None)
    def solve(a_state: Tuple[str, ...], b_state: Tuple[str, ...]) -> float:
        n = len(a_state)           # 8 → 6 → 4
        if n == 4:
            # Hand off to the third-stage routine supplied earlier.
            return scrum_minimax(scores, list(a_state), list(b_state))

        # ----------------------- 1) defenders -------------------------
        #
        # Team A picks a defender first (maximise),
        # Team B responds (minimise our eventual score).
        #
        best_for_a = float("-inf")
        for i, a_def in enumerate(a_state):
            a_rest = a_state[:i] + a_state[i + 1:]

            worst_vs_b_def = float("inf")
            for j, b_def in enumerate(b_state):
                b_rest = b_state[:j] + b_state[j + 1:]

                # ---------------- 2) attacker pairs ------------------
                #
                # Team A presents two attackers to *minimise* the result
                # Team B will get after it accepts one of them
                # (equivalent to *maximising* the minimum of the pair);
                # Team B does the symmetric optimisation.
                #
                def value_with_pairs() -> float:
                    best_a_pair_score = float("-inf")

                    for a_pair in combinations(a_rest, 2):
                        a_pool_after_pair = tuple(x for x in a_rest if x not in a_pair)

                        worst_b_pair_score = float("inf")
                        for b_pair in combinations(b_rest, 2):
                            b_pool_after_pair = tuple(
                                x for x in b_rest if x not in b_pair
                            )

                            # ------------ 3) defenders accept --------
                            #
                            # Our defender (a_def) chooses which of the
                            # two *enemy* attackers to accept, trying to
                            # maximise the overall score; their defender
                            # does the opposite.
                            #
                            best_accept_for_a = float("-inf")
                            for accept_for_a in b_pair:  # our pick
                                refuse_b = (
                                    b_pair[1] if b_pair[0] == accept_for_a else b_pair[0]
                                )

                                worst_accept_for_b = float("inf")
                                for accept_for_b in a_pair:  # their pick
                                    refuse_a = (
                                        a_pair[1]
                                        if a_pair[0] == accept_for_b
                                        else a_pair[0]
                                    )

                                    # Remaining pools for the next stage
                                    next_a = tuple(
                                        sorted(a_pool_after_pair + (refuse_a,))
                                    )
                                    next_b = tuple(
                                        sorted(b_pool_after_pair + (refuse_b,))
                                    )

                                    subtotal = (
                                        scores[a_def][accept_for_a]  # defender table A
                                        + scores[accept_for_b][b_def]  # defender table B
                                        + solve(next_a, next_b)  # recurse
                                    )
                                    worst_accept_for_b = min(
                                        worst_accept_for_b, subtotal
                                    )

                                best_accept_for_a = max(
                                    best_accept_for_a, worst_accept_for_b
                                )

                            worst_b_pair_score = min(
                                worst_b_pair_score, best_accept_for_a
                            )

                        best_a_pair_score = max(best_a_pair_score, worst_b_pair_score)
                    return best_a_pair_score

                worst_vs_b_def = min(worst_vs_b_def, value_with_pairs())

            best_for_a = max(best_for_a, worst_vs_b_def)

        return best_for_a

    # Kick off the recursion
    return solve(start_a, start_b)

def optimal_difference(mat_a: np.ndarray,
                       mat_b: np.ndarray) -> int:
    """Return the delta (A − B) under perfect play, tables ignored."""
    return _minimax(tuple(range(mat_a.shape[0])),
                    tuple(range(mat_a.shape[0])),
                    tuple(map(tuple, mat_a)),
                    tuple(map(tuple, mat_b)),
                    token_owner=0)


def simulate_pairings(
    mat_a: np.ndarray,
    mat_b: np.ndarray,
    style_a: str = "advanced",
    style_b: str = "advanced",
    rng: Optional[random.Random] = None,
    with_log: bool = False,
) -> Tuple[int, int, List[Tuple[int, int]], List[str]]:
    """
    Run the full 8-list pairing dance (tables ignored) and return:

        (total_points_A, total_points_B, [(A_idx, B_idx), ...], log_lines)
    """
    rng = rng or random.Random()

    rem_a: List[int] = list(range(mat_a.shape[0]))  # 8 → 6 → 4 → 2 → 1
    rem_b: List[int] = list(range(mat_b.shape[0]))

    total_a = total_b = 0
    pairings: List[Tuple[int, int]] = []
    log: List[str] = []

    refused_a = refused_b = None  # keep track after step 3

    for step in range(3):
        # defenders
        def_a = choose_best_defender(mat_a)
        def_b = choose_best_defender(mat_b)

        if with_log:
            log.append(f"Step {step+1}: defenders  A{def_a}  vs  B{def_b}")

        # attackers they receive
        att_pair_b = choose_best_attacker_pair(mat_b, def_a)
        att_pair_a = choose_best_attacker_pair(mat_a, def_b)

        # defenders accept one
        acc_a = _choose_accepted(style_a, att_pair_b, def_a, mat_a, True, rng)
        acc_b = _choose_accepted(style_b, att_pair_a, def_b, mat_b, True, rng)

        # refused go back to pool (step 1 & 2) or into match-7 (step 3)
        rej_a = next(x for x in att_pair_b if x != acc_a)
        rej_b = next(x for x in att_pair_a if x != acc_b)

        # two games fixed
        total_a += int(mat_a[def_a, acc_a])
        total_b += int(mat_b[acc_a, def_a])
        pairings.append((def_a, acc_a))

        total_a += int(mat_a[acc_b, def_b])
        total_b += int(mat_b[def_b, acc_b])
        pairings.append((acc_b, def_b))

        # remove played lists
        rem_a = [x for x in rem_a if x not in {def_a, acc_b}]
        rem_b = [x for x in rem_b if x not in {def_b, acc_a}]

        # keep refused for later
        if step == 2:
            refused_a, refused_b = rej_a, rej_b
        else:
            # put them back into the pools
            pass  # already still in `rem_*` lists

    # game 7 – refused attackers face each other
    if refused_a is not None and refused_b is not None:
        total_a += int(mat_a[refused_b, refused_a])  # note orientation!
        total_b += int(mat_b[refused_a, refused_b])
        pairings.append((refused_b, refused_a))
        rem_a.remove(refused_b)
        rem_b.remove(refused_a)

    # game 8 – the two remaining unpaired lists
    if len(rem_a) == len(rem_b) == 1:
        a_last, b_last = rem_a[0], rem_b[0]
        total_a += int(mat_a[a_last, b_last])
        total_b += int(mat_b[b_last, a_last])
        pairings.append((a_last, b_last))

    return total_a, total_b, pairings, log

def choose_best_defender(matrix: np.ndarray) -> int:
    """
    Pick the defender (row index) that *maximises its own worst possible score*
    after the opponent hands over two attackers and the defender keeps the
    better one.

    Works on any square matrix: 8×8 for the first step, 6×6 for the second,
    4×4 for the third, etc.
    """
    n = matrix.shape[0]
    best_row, best_val = 0, -math.inf
    for d in range(n):
        worst = math.inf
        for pair in _attacker_sets(range(n)):          # opponent’s offer
            if len(pair) == 2:
                keep = pair[0] if matrix[d, pair[0]] >= matrix[d, pair[1]] else pair[1]
            elif pair:
                keep = pair[0]
            else:
                continue
            worst = min(worst, matrix[d, keep])
        if worst > best_val:
            best_row, best_val = d, worst
    return best_row


def choose_best_attacker_pair(matrix: np.ndarray,
                              defender_col: int
                              ) -> Tuple[int, ...]:
    """
    Given the *opponent’s* defender (column index), return the pair of rows
    (your own lists) that should be offered.  The defender will keep whichever
    of the two match-ups is better for *them* (worse for you), so we maximise
    the minimum.

    When only one attacker is available, a 1-tuple is returned.
    """
    attackers = [r for r in range(matrix.shape[0]) if r != defender_col]
    if len(attackers) <= 2:
        return tuple(attackers)

    best_pair, best_val = (attackers[0],), -math.inf
    for a1, a2 in combinations(attackers, 2):
        val = min(matrix[a1, defender_col], matrix[a2, defender_col])
        if val > best_val:
            best_pair, best_val = (a1, a2), val
    return best_pair


if __name__ == "__main__":
    rng = random.Random(43)

    mat_a, mat_b = generate_matrices(rng=rng, variance=0)
    print("Matrix A\n", mat_a)
    print("Matrix B\n", mat_b)
    print("Optimal delta A–B:", optimal_difference(mat_a, mat_b), "pts")

    # Demonstration of the helpers on the same 8×8 and on the 6×6 remainder
    d0 = choose_best_defender(mat_a)
    print(f"\n‣ Best first defender for A: row {d0}")
    d1 = choose_best_defender(mat_b)
    print(f"‣ Best first defender for B: row {d1}")

    pair0 = choose_best_attacker_pair(mat_a, defender_col=d1)
    print(f"‣ Best attackers to hand to enemy defender {d1}: {pair0}")
    pair1 = choose_best_attacker_pair(mat_b, defender_col=d0)
    print(f"‣ Best attackers for enemy to hand to our defender {d0}: {pair1}")
    
    # Pretend those four players are now fixed and look at the 6×6 sub-matrix
    keep_a = pair0[0] if mat_a[pair0[0], 0] >= mat_a[pair0[1], 0] else pair0[1]
    sub = np.delete(np.delete(mat_a, [d0, keep_a], axis=0),
                    [0, d0], axis=1)       # rows = A remaining, cols = B remaining
    print("\n6×6 remainder:\n", sub)
    print("‣ Best second defender (in 6×6):", choose_best_defender(sub))