# Clip attribution

`clip-1.wav`, `clip-2.wav`, `clip-3.wav` are short utterances (Portuguese, Brazil) from the **FLEURS** dataset
(`google/fleurs`, configuration `pt_br`, split `dev`), released under **CC BY 4.0**
(<https://creativecommons.org/licenses/by/4.0/>; license field of the dataset card on Hugging Face: `cc-by-4.0`).

FLEURS: Alexis Conneau, Min Ma, Simran Khanuja, Yu Zhang, Vera Axelrod, Siddharth Dalmia, Jason Riesa, Clara Rivera,
Ankur Bapna. *FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech*. 2022. arXiv:2205.12446.

Changes: each clip was converted from the dataset's 16 kHz mono float WAV to 16-bit PCM, 16 kHz, mono. Nothing was cut,
filtered or re-recorded.

| file | FLEURS id | sentence (dataset `raw` transcript) |
|---|---|---|
| `clip-1.wav` | 1552 | O resultado da análise do gráfico será disponibilizado no site público. |
| `clip-2.wav` | 1515 | É o quinto CEP do Martelly em quatro anos. |
| `clip-3.wav` | 1554 | Ele montou uma campainha sem fio, disse. |

`noise.wav` is generated (smoothed white noise at low level, seeded), not from FLEURS.
