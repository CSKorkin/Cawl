import numpy as np
from dataclasses import dataclass
from typing import List, Tuple

@dataclass
class Army:
    name: str
    icon: str

@dataclass
class PairingMatrix:
    matrix: np.ndarray
    attackers: List[Army]
    defenders: List[Army]

    @staticmethod
    def random(attackers: List[Army], defenders: List[Army], variance: int = 5) -> 'PairingMatrix':
        size_rows = len(attackers)
        size_cols = len(defenders)
        base = np.random.randint(2, 19, size=(size_rows, size_cols))
        matrix = base
        return PairingMatrix(matrix=matrix, attackers=attackers, defenders=defenders)


def simulate_pairings(armies_a: List[Army], armies_b: List[Army]) -> Tuple[PairingMatrix, PairingMatrix]:
    matrix_a = PairingMatrix.random(armies_a, armies_b)
    matrix_b = PairingMatrix.random(armies_b, armies_a)
    return matrix_a, matrix_b
