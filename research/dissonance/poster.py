import numpy as np
import matplotlib.pyplot as plt
from scipy.stats import gaussian_kde

# ============================================================
# Poster-scale settings
# ============================================================
FIG_W, FIG_H = 48, 36        # inches (landscape poster)
BASE_W = 14                 # reference width used earlier
SCALE = FIG_W / BASE_W      # ≈ 3.4

plt.rcParams.update({
    "font.size": 12 * SCALE,
    "axes.titlesize": 14 * SCALE,
    "axes.labelsize": 11 * SCALE,
    "xtick.labelsize": 10 * SCALE,
    "ytick.labelsize": 10 * SCALE,
    "legend.fontsize": 9 * SCALE,
})

# ============================================================
# Roughness kernel (Plomp–Levelt / Sethares-style)
# ============================================================
def roughness(delta_f, cbw=100):
    x = delta_f / cbw
    return np.exp(-3.5 * x) - np.exp(-5.75 * x)

# ============================================================
# Parameters
# ============================================================
f0 = 200.0
partials = np.arange(1, 31)

intervals_AB = [
    ("Major third (5:4)", 5/4),
    ("Perfect fourth (4:3)", 4/3),
    ("Perfect fifth (3:2)", 3/2),
    ("Octave (2:1)", 2.0),
]

# C panels in causal order
intervals_C = list(reversed(intervals_AB))

# ============================================================
# Panel B: Total dissonance curve
# ============================================================
ratios = np.linspace(1.0, 2.0, 600)
fA = partials[:, None] * f0

dissonance = []
for r in ratios:
    fB = partials[None, :] * f0 * r
    dissonance.append(np.sum(roughness(np.abs(fA - fB))))
dissonance = np.array(dissonance)

# ============================================================
# Figure layout
# ============================================================
fig = plt.figure(figsize=(FIG_W, FIG_H), facecolor="white")
gs = fig.add_gridspec(
    2 + len(intervals_C), 1,
    height_ratios=[1.5, 1.5] + [0.5] * len(intervals_C)
)

# ------------------------------------------------------------
# Panel A: Ear-level roughness
# ------------------------------------------------------------
ax1 = fig.add_subplot(gs[0])
delta_f_ratio = f0 * (ratios - 1)

ax1.plot(ratios, roughness(delta_f_ratio), linewidth=2 * SCALE)
ax1.set_title("A. Ear-level roughness for a single frequency difference")
ax1.set_ylabel("Sensory roughness")
ax1.set_xlabel("Frequency ratio (interval)")

for name, r in intervals_AB:
    ax1.axvline(r, linestyle=":", alpha=0.4)

ax1.grid(alpha=0.2)

# Add interval labels after axes limits are set
interval_labels = {
    "Major third (5:4)": "Major 3rd\n(5:4)",
    "Perfect fourth (4:3)": "Perfect 4th\n(4:3)",
    "Perfect fifth (3:2)": "Perfect 5th\n(3:2)",
    "Octave (2:1)": "Octave\n(2:1)",
}
for name, r in intervals_AB:
    ax1.text(r, 0.95, interval_labels[name],
             ha='center', va='top', fontsize=8 * SCALE, alpha=0.7,
             transform=ax1.get_xaxis_transform())

# ------------------------------------------------------------
# Panel B: Total dissonance
# ------------------------------------------------------------
ax2 = fig.add_subplot(gs[1], sharex=ax1)

ax2.plot(ratios, dissonance, linewidth=2 * SCALE)
ax2.set_title("B. Total dissonance from all harmonic partial interactions")
ax2.set_ylabel("Summed dissonance")
ax2.set_xlabel("Frequency ratio (interval)")

for name, r in intervals_AB:
    ax2.axvline(r, linestyle=":", alpha=0.4)

ax2.grid(alpha=0.2)

# Add interval labels after axes limits are set
for name, r in intervals_AB:
    ax2.text(r, 0.95, interval_labels[name],
             ha='center', va='top', fontsize=8 * SCALE, alpha=0.7,
             transform=ax2.get_xaxis_transform())

# ------------------------------------------------------------
# Panel C: Overlaid interaction densities (KDE)
# ------------------------------------------------------------
axC = fig.add_subplot(gs[2:])  # use remaining vertical space

colors = {
    "Octave (2:1)": "#1f77b4",         # blue
    "Perfect fifth (3:2)": "#2ca02c",  # green
    "Perfect fourth (4:3)": "#ff7f0e", # orange
    "Major third (5:4)": "#d62728",    # red
}

x = np.linspace(0, 200, 600)
r_curve = roughness(x)

ys = []  # store curves to get global max cleanly

for name, ratio in intervals_C:
    fB = partials[None, :] * f0 * ratio
    delta_vals = np.abs(fA - fB).flatten()
    delta_vals = delta_vals[delta_vals <= 200]

    kde = gaussian_kde(delta_vals, bw_method=0.035)
    y = kde(x) * len(delta_vals)
    ys.append(y)

    axC.plot(
        x, y,
        linewidth=2 * SCALE,
        color=colors[name],
        label=name
    )

    # Fundamental Δf marker
    delta_f_fund = abs(f0 - ratio * f0)
    axC.axvline(
        delta_f_fund,
        linestyle=":",
        linewidth=1.0 * SCALE,
        color=colors[name],
        alpha=0.5
    )

# Roughness reference (scaled once, correctly)
y_max = max(np.max(y) for y in ys)
axC.plot(
    x,
    r_curve / r_curve.max() * y_max,
    "--",
    color="black",
    linewidth=1.5 * SCALE,
    label="Ear roughness sensitivity"
)

axC.set_title("C. Partial–partial frequency differences (interaction density)")
axC.set_xlabel("Frequency difference Δf (Hz, within one octave)")
axC.set_ylabel("Interaction density")
axC.legend(loc='upper left', bbox_to_anchor=(0.82, 0.55))
axC.grid(alpha=0.2)


# ============================================================
# Save + show (light version)
# ============================================================
plt.tight_layout(h_pad=2.0)
plt.savefig("dissonance_poster.pdf", bbox_inches="tight")
plt.savefig("dissonance_poster.png", dpi=300, bbox_inches="tight")

# ============================================================
# Create dark version
# ============================================================
# Define brighter color palette for dark background
dark_colors_map = {
    "#1f77b4": "#64b5f6",  # blue -> bright blue
    "#2ca02c": "#81c784",  # green -> bright green
    "#ff7f0e": "#ffb74d",  # orange -> bright orange
    "#d62728": "#ff6b6b",  # red -> bright red
}

# Update colors for dark theme
fig.set_facecolor("#000000")
for ax in [ax1, ax2, axC]:
    ax.set_facecolor("#000000")
    ax.spines['bottom'].set_color('white')
    ax.spines['top'].set_color('white')
    ax.spines['left'].set_color('white')
    ax.spines['right'].set_color('white')
    ax.xaxis.label.set_color('white')
    ax.yaxis.label.set_color('white')
    ax.title.set_color('white')
    ax.tick_params(axis='x', colors='white')
    ax.tick_params(axis='y', colors='white')

# Update grids with white color
ax1.grid(True, alpha=0.3, color='white', linestyle='-', linewidth=0.5)
ax2.grid(True, alpha=0.3, color='white', linestyle='-', linewidth=0.5)
axC.grid(True, alpha=0.3, color='white', linestyle='-', linewidth=0.5)

# Update Panel A and B line colors (main curves and vertical lines)
for ax in [ax1, ax2]:
    lines = ax.get_lines()
    for line in lines:
        if line.get_linestyle() == ':':  # vertical dotted lines
            line.set_color('white')
            line.set_alpha(0.6)
        else:  # main curve
            line.set_color('#64b5f6')  # bright blue

# Update Panel C lines - store original colors first, then update
lines_c = axC.get_lines()
line_colors_original = [line.get_color() for line in lines_c]

for i, line in enumerate(lines_c):
    original_color = line_colors_original[i]

    # Update to bright colors for dark background
    if original_color in dark_colors_map:
        line.set_color(dark_colors_map[original_color])
        if line.get_linestyle() == ':':  # vertical dotted lines
            line.set_alpha(0.6)
    elif original_color == 'black' or line.get_label() == "Ear roughness sensitivity":
        line.set_color('white')
        line.set_alpha(0.8)

# Update legend colors
legend = axC.get_legend()
if legend:
    legend.get_frame().set_facecolor('#1a1a1a')
    legend.get_frame().set_edgecolor('white')
    legend.get_frame().set_alpha(0.9)
    for text in legend.get_texts():
        text.set_color('white')

# Update text labels (interval labels)
for ax in [ax1, ax2]:
    for txt in ax.texts:
        txt.set_color('white')
        txt.set_alpha(0.9)

plt.savefig("dissonance_poster_dark.pdf", bbox_inches="tight", facecolor='#000000')
plt.savefig("dissonance_poster_dark.png", dpi=300, bbox_inches="tight", facecolor='#000000')

plt.show()
