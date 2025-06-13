# Pairings Logic Algorithm

This document describes an algorithm for selecting optimal pairings using the 40k matrix and the three-step pairing process from `spec.md`.

## 1. Overview

- Each team brings eight armies and the matrix records expected scores (2–18) for every A vs B matchup.
- Pairings occur in three sequential steps with a "table choice" token alternating between teams.
- At each step, both sides secretly choose a defender and propose two attackers. The defender refuses one attacker, locking in the other.
- After attackers are accepted, the defender with the table choice token selects a table followed by the opposing defender.
- Steps 1 and 2 identify four games. Step 3 assigns the last four games (including a match between the refused attackers and the two remaining armies).

The goal of the algorithm is to maximize the expected score for our team assuming the opponent also chooses optimally.

## 2. Data Structures

```
MatrixA[i][j]  # expected score when Team A army i faces Team B army j
MatrixB[j][i]  # Team B view of the same matchup (may vary by 1–5 points)
AvailableA     # list of remaining armies for Team A
AvailableB     # list of remaining armies for Team B
Pairings       # locked pairings with assigned tables
TokenHolder    # which team currently chooses tables first
```

## 3. Attacker Pair Evaluation

For a given defender `D` and an attacker pair `(A1, A2)` chosen by the opponent, the defender will refuse the attacker that yields the worst result for them (highest score for us). The value of the pair is therefore:

```
PairValue(D, A1, A2) = min(Matrix[D][A1], Matrix[D][A2])
```

When selecting a pair of attackers for an opposing defender, we evaluate every `(A1, A2)` from our remaining armies and pick the pair that *maximizes* this minimum value.

## 4. Defender Selection

When choosing a defender, we assume the opponent will counter with their own optimal attacker pair. For each candidate defender `D` in our available pool:

1. Evaluate the opponent’s best attacker pair against `D` using the method above.
2. Record the resulting score as `DefenderScore(D)`.

We select the defender with the highest `DefenderScore`. This value represents the best expected score we can guarantee once the attacker/refusal step resolves.

## 5. Step Resolution

A single pairing step proceeds as follows:

1. **Defender Choice** – Both teams evaluate all candidates using section 4 and simultaneously commit to a defender.
2. **Attacker Choice** – For the revealed enemy defender, use section 3 to choose the best attacker pair from the remaining armies.
3. **Refusal** – Each defender refuses the worst attacker, locking in one pairing.
4. **Table Choice** – The team holding the token picks a table for their defender first. If table effects exist, select the table that maximizes the expected score for the finalized matchup.
5. Remove used armies from `AvailableA` and `AvailableB`. Pass the token according to the spec and repeat for the next step.

Steps 1 and 2 each create two pairings. Step 3 repeats the same logic and additionally pairs the last two armies and the refused attackers to produce the final four games.

## 6. Search and Optimization

The procedure above assumes a greedy approach at each decision point. For a more exact solution, we can search the entire game tree using minimax with alpha–beta pruning:

1. A state consists of the remaining armies for both teams, token holder, and current step.
2. Recursively explore all possible defender and attacker choices, evaluating the final total score when all armies are paired.
3. Use alpha–beta pruning to discard branches that cannot improve the current best outcome.

Because each step drastically reduces the number of remaining armies, the search tree remains manageable for eight armies per side.

## 7. Summary

This algorithm uses the pairing matrix to evaluate every possible defender and attacker choice. By selecting attackers through a max–min calculation and resolving the three pairing steps sequentially, we can determine a set of pairings that maximizes expected points for our team. For perfect play, the search can expand into a full minimax analysis of all remaining choices, but the greedy method provides a fast approximation well suited to a 40k pairings simulator.

