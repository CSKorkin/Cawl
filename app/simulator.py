from dataclasses import dataclass
from typing import List

import numpy as np

@dataclass
class Army:
    name: str
    icon: str

def simulate_pairings(armies_a: List[Army], armies_b: List[Army]) -> np.ndarray:
    size_rows = len(armies_a)
    size_cols = len(armies_b)
    return np.random.randint(2, 19, size=(size_rows, size_cols))
