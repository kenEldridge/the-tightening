import numpy as np
import matplotlib.pyplot as plt

def roughness(delta_f, cbw=100):
    x = delta_f / cbw
    return np.exp(-3.5 * x) - np.exp(-5.75 * x)

f0 = 200.0
ratios = np.linspace(1.0, 2.0, 800)

partials = np.arange(1, 61)

fA = partials[:, None] * f0
dissonance = []

for r in ratios:
    fB = partials[None, :] * f0 * r
    delta_f = np.abs(fA - fB)
    dissonance.append(np.sum(roughness(delta_f)))

plt.figure()
plt.plot(ratios, dissonance)
plt.xlabel("Frequency ratio (f₂ / f₁)")
plt.ylabel("Total dissonance")
plt.title("Dissonance vs Ratio (30 partials)")
plt.show()
