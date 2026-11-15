"""Regenerate tests/reference.json (needs numpy, scipy, pymannkendall)."""

import json
from pathlib import Path

import numpy as np
import pymannkendall as mk
from scipy import stats

rng = np.random.default_rng(7)
n = 45
x1 = np.arange(1981, 1981 + n)
noise = np.zeros(n)
for i in range(1, n):
    noise[i] = 0.6 * noise[i - 1] + rng.normal(0, 0.3)
series = [
    (x1, 0.02 * (x1 - x1[0]) + noise),               # trend with AR(1) noise
    (np.arange(1990, 2020), rng.normal(0, 1, 30)),    # no trend
    (np.arange(2000, 2025), np.round(rng.normal(0, 1, 25), 0)),  # heavy ties
]

cases = []
for x, y in series:
    classic = mk.original_test(y)
    hamed = mk.hamed_rao_modification_test(y)
    sen = stats.theilslopes(y, x, alpha=0.95)
    cases.append({
        "x": x.tolist(), "y": [float(v) for v in y],
        "slope": float(sen.slope), "lo": float(sen.low_slope), "hi": float(sen.high_slope),
        "s": float(classic.s), "varS": float(classic.var_s), "tau": float(classic.Tau),
        "zClassic": float(classic.z), "pClassic": float(classic.p),
        "zHR": float(hamed.z), "pHR": float(hamed.p),
    })

Path(__file__).with_name("reference.json").write_text(json.dumps(cases))
