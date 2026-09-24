# s4nyam.github.io

Personal academic site of **Sanyam Jain** — PhD fellow, Department of Dentistry and Oral Health,
Aarhus University. Live at **<https://s4nyam.github.io>**.

Static HTML, CSS and vanilla JavaScript. No build step, no framework, no package manager.
Push to `main` and GitHub Pages serves it.

---

## Layout

```
.
├── index.html            the site itself — about, news, publications, experience,
│                         teaching, projects, education. One file.
├── stylesheet.css        styles for index.html only
├── README.md             this file
│
├── panodiff/             project page — PanoDiff-SR (arXiv:2507.09227)
├── brain2vlm/            project page — Brain2VLM
├── deepseanet/           project page — DeepSeaNet (ICAPAI 2024)
├── sonca/                project page — Self-Replicating Neural Cellular Automata
│                         (Journal of Imaging, accepted)
│
├── CV.pdf  CL.pdf        curriculum vitae, cover letter
├── my.jpg  logo.jpg      portrait and site logo
├── hiof.png  iitj.png  oslomet.png   institution marks
└── brain2vlm.jpg  deepseanet.jpg  sonca.jpg  lenia.png  table.jpg   publication thumbnails
```

Some project pages live in other repositories and are linked from `index.html` rather than
stored here, including [EvoLenia](https://s4nyam.github.io/evolenia/) and the
[MNCA portal](https://s4nyam.github.io/mncaportal/).

---

## Project pages

Each directory under the root is one self-contained project page, and the four in this repo are
built to the same recipe so they read as a set:

```
<project>/
├── index.html            the page, section by section
├── style.css             its own stylesheet — scoped to the page, never shared
├── app.js                every interaction on the page, one IIFE, no dependencies
└── assets/
    ├── data/data.js      one global (window.<PAGE>_DATA) holding every number the page draws
    └── img/ …            figures and images, already downscaled for the web
```

Conventions worth keeping if you add a fourth:

- **All numbers live in `assets/data/data.js`**, never inline in the markup, and each block names
  the table or log it came from. The page then has one place to audit.
- **Charts are drawn as inline SVG** from that data at runtime — no chart library. They redraw on
  `themechange` so colours follow the theme.
- **Colour is semantic and fixed per page.** Each role (a model, a class, a stage) keeps one hue
  everywhere it appears, defined once as a CSS custom property.
- **The theme is shared.** All pages read and write the same `theme` key in `localStorage` and
  resolve it in a blocking script before first paint, so switching the theme on one page and
  navigating to another does not flash.
- **Every claim is labelled.** A `.badge` marks whether a panel shows results from the paper,
  output from the repository, or an illustration built for the page.
- **Assets are committed already sized.** Nothing is resized in the browser; figures are
  pre-rendered to the width they are displayed at.

### PanoDiff-SR — `panodiff/`

Companion page to *PanoDiff-SR: Synthesizing Dental Panoramic Radiographs using Diffusion and
Super-resolution* ([arXiv:2507.09227](https://arxiv.org/abs/2507.09227),
[code](https://github.com/s4nyam/PanoDiff)).

It opens with the real-versus-synthetic test the six dentists in the observer study actually sat,
on the same images at the same resolution, and scores you against their per-image answers. The rest
walks the pipeline: a draggable forward-diffusion schedule on a real radiograph, the training
progression decoded from a fixed seed at six checkpoints, a seed-to-super-resolution comparison
slider, every FID and Inception score in the paper as live charts, the observer study with ROC, PR
and inter-observer agreement, an attention-map viewer, and the direct high-resolution baselines that
test whether splitting generation from upscaling was the right call.

The observer data in `panodiff/assets/data/data.js` is computed from the study's raw submission log
(6 observers × 200 images); its response tallies reproduce the paper's Table 5 and its AUC and AP
values match the published figures.

### Brain2VLM — `brain2vlm/`

Clickable cortex explorer contrasting linear and nonlinear decoding, a step-through of the
reconstruction pipeline, drag-to-compare reconstructions, and ablation and latent-space plots.

### DeepSeaNet — `deepseanet/`

Water-conditions playground, a feature-pyramid explorer (FPN, PANet, BiFPN, BiSkFPN), per-class
results for EfficientDet-Lite0, YOLOv5, YOLOv8 and Detectron2 on the Brackish dataset, class
activation maps, and reproducibility notes.

### Self-Replicating Neural Cellular Automata — `sonca/`

Companion page to *Self-Replicating Neural Cellular Automata: Quantifying Emergent Phenotypic and
Genotypic Diversity in an Open-Ended Substrate* (Journal of Imaging, accepted;
[code](https://github.com/s4nyam/Self-Replicating-NCA)).

This one departs from the pattern in one respect: the subject of the paper is a simulator, so the
page runs it. `app.js` contains a port of the repository's `update_ca` — the same liveness gate,
the same birth-only mutation, the same post-scan squash, threshold and budget order, and the same
GHC and RWSP colourings — over typed arrays rather than one PyTorch module per pixel. The hero
shows one live grid in three views at once; section 3 is a full lab with parameter sliders, live
diversity metrics and a draggable annihilation kernel. Panels that run the substrate carry a
`Live` badge rather than `Paper`, and a callout names the two behaviours the port does not
reproduce and why.

The published results are still data, not simulation. `sonca/assets/data/runs.js` holds all 24 long
runs — GEP, GCVP, CLOGV, the GHC and RWSP unique-colour counts with their five-fold min–max
envelopes, and the CTFP series per cell type — recovered from the vector figures released with the
paper and resampled onto a common 5-generation grid. The recovery checks out against a quantity the
plots never state: every run's GHC count at generation 1 equals `init_prob × 40,000`, which is the
founder count by construction. The 200 × 200 grids under `sonca/assets/runs/` are the rasters
extracted from those same figures, at their native lattice resolution.

`sonca/fli.html` is a side project, not part of the paper: *Food-Led Intelligence*, which swaps
SONCA's fixed life budget for an energy budget and gives each cell a 44-weight attention head over
the food it smells. It is a single self-contained file with its own inline CSS and JS. The SONCA page
links to it from a panel at the end of section 9, badged `Extension — not in the paper`, and
from the footer.

---

## Working on it locally

There is nothing to install. The pages load their data with `<script src>`, so open them over HTTP
rather than as `file://`:

```bash
git clone https://github.com/s4nyam/s4nyam.github.io.git
cd s4nyam.github.io
python3 -m http.server 8000
```

Then <http://localhost:8000> for the site and <http://localhost:8000/panodiff/> for a project page.
`sonca/` is the heaviest page (about 8 MB of grids, figures and animations, all lazy-loaded).

When you change a project's `style.css`, `app.js` or `assets/data/data.js`, bump the `?v=` query
string on its `<link>` and `<script>` tags in that page's `index.html` so returning visitors are not
served a stale cached copy.

Check both themes and a narrow viewport before pushing — every page is responsive down to about
400 px and the theme toggle sits in the top bar.

---

## Licence and content

Code on these pages is free to reuse. **The research figures, radiographs and results are not** —
they belong to their papers and, for the dental radiographs, to the public datasets they came from
(ADLD, DENTEX, TSXK, TUFTS and USPFORP). None of those datasets is redistributed here. Every
radiograph shown as *synthetic* was generated by a model and depicts no patient.

If you use the work rather than the page, cite the paper. BibTeX is at the foot of each project page.
