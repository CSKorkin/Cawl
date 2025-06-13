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
    armies: List[Army]

    @staticmethod
    def random(armies: List[Army], variance: int = 5) -> 'PairingMatrix':
        size = len(armies)
        base = np.random.randint(2, 19, size=(size, size))
        matrix = base
        return PairingMatrix(matrix=matrix, armies=armies)


def simulate_pairings(armies_a: List[Army], armies_b: List[Army]) -> Tuple[PairingMatrix, PairingMatrix]:
    matrix_a = PairingMatrix.random(armies_a)
    matrix_b = PairingMatrix.random(armies_b)
    return matrix_a, matrix_b
